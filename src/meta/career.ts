/**
 * The manager layer: a league of divisions, a 3-day rhythm (matchday → training → training),
 * money, transfers, injuries, levelling and aging. Pure data + functions; the UI calls these
 * and persists the `Career` object.
 */
import type { ClassId, Difficulty, GameConfig, TimeoutPolicy } from '../config';
import { deleteSave, readSave, writeSave } from './storage';
import { classLevel, perkDef, pickPerk, type PerkId } from '../engine/abilities';
import { createRng, type Rng } from '../rng';
import type { Club, Player, TeamSide } from '../types';
import { generatePlayer } from '../world/generate';
import { DEFAULT_NATION, NATION_IDS, NATIONS, pickNationality, shortCode, type NationId } from '../world/nations';
import { leagueName } from '../world/leagues';
import {
    STADIUM_SIZES,
    customStadium,
    defaultGroundLook,
    generateStadium,
    sizeLabel,
    type GroundLook,
    type Stadium,
    type StadiumSize,
} from '../world/stadium';
import {
    CUP_NAME,
    INTL_CUP_NAME,
    advanceCup,
    createCup,
    cupKeyOf,
    cupWinner,
    fixtureForClub,
    isCupFixture,
    penaltyScore,
    recordCupScore,
    type Cup,
    type CupRound,
} from './cup';
import { ageOneSeason, autoLevel, fitFor, gainXp, levelUp, money, ovr, playerValue, wage } from './player';
import {
    afterMatchday,
    afterTraining,
    answerLetter,
    bumpQuest,
    deliverBid,
    initStory,
    resetSeason,
    seasonAwards,
    simLines,
    story,
    type PlayerMatchLine,
    type Trainee,
} from './story';
import { DEFAULT_DRILLS, DRILL_IDS, DRILLS, drillStats, drillsLabel, trainingGain, type Drills } from './training';

export type Fixture = { id: string; round: number; home: string; away: string; result?: [number, number] };
export type Division = { tier: number; clubs: string[]; fixtures: Fixture[] };
export type TableRow = { club: string; p: number; w: number; d: number; l: number; gf: number; ga: number; pts: number };
export type News = { season: number; day: number; text: string; tone: 'good' | 'bad' | 'info' };
export type Ledger = { season: number; day: number; label: string; amount: number };
export type CareerSettings = { timerSeconds: number; rounds: number; difficulty: Difficulty; timeoutPolicy: TimeoutPolicy };

export type CareerClub = Club & {
    /** The nation whose pyramid the club plays in. */
    nation: NationId;
    /** The home ground: built on first use for AI clubs, chosen by the manager for theirs. */
    stadium?: Stadium;
    tier: number;
    budget: number;
    /** Player ids in formation-slot order (11). */
    lineup: string[];
};

/**
 * Save format version. Breaking changes bump it; an older save is simply not loaded (no
 * migrations: the manager starts a new career).
 */
export const SAVE_VERSION = 6;

export type Career = {
    version: typeof SAVE_VERSION;
    seed: number;
    /** The nation whose pyramid the career is played in (saves from before nations → Highmarch). */
    nation: NationId;
    rngState: number;
    season: number;
    /** 1-based day within the season. */
    day: number;
    userClubId: string;
    clubs: Record<string, CareerClub>;
    /** The manager's pyramid (top division first). */
    divisions: Division[];
    /** Every other nation's pyramid, simulated alongside (same shape as `divisions`). */
    world: Partial<Record<NationId, Division[]>>;
    /** The domestic cup ({@link CUP_NAME}). */
    cup?: Cup;
    /** The international cup ({@link INTL_CUP_NAME}): the best two of every top flight. */
    intl?: Cup;
    /** Free agents: players without a club (released, or this season's youth crop). */
    market: Player[];
    /** The transfer list: players clubs are willing to sell (day = absolute day it was listed). */
    listed: Array<{ id: string; club: string; day: number }>;
    news: News[];
    ledger: Ledger[];
    /** Squad drill to run each training day until the manager changes it. */
    /** The two drills the squad runs on training days. */
    drills: Drills;
    settings: CareerSettings;
    history: Array<{ season: number; tier: number; position: number }>;
    nextId: number;
};

type ScheduledRound = { day: number; round: number; cup?: CupRound };
export type Today =
    | { kind: 'match'; fixture: Fixture; round: number; cup?: CupRound }
    | { kind: 'training'; cup?: CupRound }
    | { kind: 'seasonEnd' };

// ------------------------------------------------------------------ names & kits

const outfieldKit = (cfg: GameConfig, i: number) => cfg.kits.outfield[i % cfg.kits.outfield.length]!;
const keeperKit = (cfg: GameConfig, i: number) => cfg.kits.keepers[i % cfg.kits.keepers.length]!;

/** Two kits too alike to share a pitch: the same, or a pair listed in config.kits.clashes. */
export const kitsClash = (cfg: GameConfig, a: string, b: string) =>
    a === b || cfg.kits.clashes.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
/** A second strip for a club: the first kit (from `start`) that doesn't clash with its home kit. */
export const awayKitFor = (cfg: GameConfig, home: string, start = 0, avoid?: string) => {
    const kits = cfg.kits.outfield;
    for (let i = 0; i < kits.length; i++) {
        const k = kits[(start + i) % kits.length]!;
        if (!kitsClash(cfg, k, home) && (!avoid || !kitsClash(cfg, k, avoid))) return k;
    }
    return kits.find((k) => k !== home)!;
};

export const careerRng = (c: Career): Rng => createRng(c.rngState);
const saveRng = (c: Career, rng: Rng) => {
    c.rngState = rng.state();
};

// ------------------------------------------------------------------ creation

/** A new player for the career; mostly from the career's nation unless `nation` says otherwise. */
const newPlayer = (
    cfg: GameConfig,
    rng: Rng,
    c: Career,
    cls: ClassId,
    tier: number,
    number: number,
    ageR?: [number, number],
    nation: NationId = pickNationality(rng, c.nation, cfg.world.foreignShare),
) => {
    const p = generatePlayer(cfg, rng, cls, '', number, `p${c.nextId++}`, {
        levelRange: cfg.career.tierLevels[tier],
        talentShift: cfg.career.tierTalent[tier],
        age: ageR,
        nation,
    });
    return p;
};

/** A player for a club: mostly from the club's own nation. */
const clubPlayer = (
    cfg: GameConfig,
    rng: Rng,
    c: Career,
    club: { nation: NationId; tier: number },
    cls: ClassId,
    number: number,
    ageR?: [number, number],
) => newPlayer(cfg, rng, c, cls, club.tier, number, ageR, pickNationality(rng, club.nation, cfg.world.foreignShare));

const buildSquad = (cfg: GameConfig, rng: Rng, c: Career, tier: number, nation: NationId): Player[] => {
    const squad: Player[] = [];
    let n = 1;
    for (const [cls, count] of Object.entries(cfg.career.squadMake) as Array<[ClassId, number]>)
        for (let i = 0; i < count; i++) squad.push(clubPlayer(cfg, rng, c, { nation, tier }, cls, n++));
    return squad;
};

/** A full pyramid of clubs for one nation (ids from `prefix`); returns its divisions, top first. */
const buildPyramid = (cfg: GameConfig, rng: Rng, c: Career, nationId: NationId, prefix: string, kitStart: number): Division[] => {
    const nation = NATIONS[nationId];
    const places = nation.places(rng);
    const divisions: Division[] = [];
    let ci = 0;
    for (let tier = 0; tier < cfg.career.divisions; tier++) {
        const ids: string[] = [];
        for (let k = 0; k < cfg.career.clubsPerDivision; k++, ci++) {
            const id = `${prefix}${ci}`;
            const kit = kitStart + ci;
            const club: CareerClub = {
                id,
                nation: nationId,
                name: nation.clubName(rng, places[ci % places.length]!),
                short: shortCode(places[ci % places.length]!),
                kit: outfieldKit(cfg, kit),
                awayKit: awayKitFor(cfg, outfieldKit(cfg, kit), kit + 3),
                keeperKit: keeperKit(cfg, kit),
                formationId: cfg.formations[0]!.id,
                squad: buildSquad(cfg, rng, c, tier, nationId),
                tier,
                budget: cfg.career.startingBudget[tier]!,
                lineup: [],
            };
            club.formationId = pickFormation(cfg, rng, club);
            club.lineup = autoLineup(cfg, club);
            c.clubs[id] = club;
            ids.push(id);
        }
        divisions.push({ tier, clubs: ids, fixtures: [] });
    }
    return divisions;
};

/** Round robin (circle method): every club plays every other once. */
const roundRobin = (clubs: string[], rng: Rng, prefix: string): Fixture[] => {
    const ids = [...clubs].sort(() => rng() - 0.5);
    if (ids.length % 2) ids.push('BYE');
    const n = ids.length;
    const out: Fixture[] = [];
    for (let r = 0; r < n - 1; r++) {
        for (let i = 0; i < n / 2; i++) {
            const a = ids[i]!;
            const b = ids[n - 1 - i]!;
            if (a === 'BYE' || b === 'BYE') continue;
            const [home, away] = (r + i) % 2 ? [a, b] : [b, a];
            out.push({ id: `${prefix}-r${r}-${i}`, round: r, home, away });
        }
        ids.splice(1, 0, ids.pop()!);
    }
    return [...out, ...out.map(({ id, round, home, away }) => ({ id: `${id}-return`, round: round + n - 1, home: away, away: home }))];
};

export const roundsPerSeason = (c: Career) => (c.divisions[0]?.fixtures.at(-1)?.round ?? -1) + 1;
const cupsOf = (c: Career) => [c.cup, c.intl].filter((x): x is Cup => !!x);
const cupRounds = (c: Career) => cupsOf(c).reduce((n, cup) => n + cup.rounds.length, 0);
export const seasonDays = (cfg: GameConfig, c: Career) => (roundsPerSeason(c) + cupRounds(c)) * cfg.career.daysPerMatchday;

/** The cup a round belongs to (the domestic or the international one). */
export const cupOf = (c: Career, round: CupRound): Cup => cupsOf(c).find((cup) => cup.rounds.includes(round))!;
/** The cup a fixture belongs to. */
export const cupOfFixture = (c: Career, f: Fixture): Cup | undefined => (cupKeyOf(f) === 'intl' ? c.intl : c.cup);

/** Every pyramid: the manager's and the other nations'. */
export const allDivisions = (c: Career): Division[] => [...c.divisions, ...Object.values(c.world).flat()];
/** The pyramid a club plays in. */
export const pyramidOf = (c: Career, clubId: string): Division[] =>
    c.divisions.some((d) => d.clubs.includes(clubId))
        ? c.divisions
        : (Object.values(c.world).find((p) => p.some((d) => d.clubs.includes(clubId))) ?? c.divisions);

/**
 * Cup dates between league matchdays: the domestic rounds spread evenly to the last matchday,
 * the international rounds in between. Sets every round's day.
 */
const scheduleCups = (cfg: GameConfig, c: Career) => {
    const L = roundsPerSeason(c);
    const dom = c.cup?.rounds ?? [];
    const intl = c.intl?.rounds ?? [];
    const slots: Array<CupRound | null> = [];
    for (let k = 1; k <= L; k++) {
        slots.push(null);
        dom.forEach((r, i) => {
            if (Math.ceil(((i + 1) * L) / dom.length) === k) slots.push(r);
        });
        intl.forEach((r, j) => {
            if (Math.max(1, Math.round(((j + 1) * L) / (intl.length + 1))) === k) slots.push(r);
        });
    }
    slots.forEach((r, index) => {
        if (r) r.day = index * cfg.career.daysPerMatchday + 1;
    });
};

export const seasonSchedule = (cfg: GameConfig, c: Career): ScheduledRound[] => {
    const cupDates = new Map(
        cupsOf(c).flatMap((cup) => cup.rounds.map((round, index) => [round.day, { cup: round, round: index }] as const)),
    );
    let leagueRound = 0;
    return Array.from({ length: roundsPerSeason(c) + cupDates.size }, (_, index) => {
        const day = index * cfg.career.daysPerMatchday + 1;
        return { day, ...(cupDates.get(day) ?? { round: leagueRound++ }) };
    });
};

export const scheduledFixture = (c: Career, date: ScheduledRound) =>
    fixtureForClub(date.cup ? date.cup.fixtures : divisionOf(c, c.userClubId).fixtures.filter((f) => f.round === date.round), c.userClubId);

/** The best `per` clubs of every top flight: by last season's table, or by squad strength before any. */
const intlQualifiers = (cfg: GameConfig, c: Career, byTable: boolean): string[] =>
    [c.divisions, ...Object.values(c.world)].flatMap((pyramid) => {
        const top = pyramid[0]!;
        const order = byTable
            ? table(top).map((r) => r.club)
            : [...top.clubs].sort((a, b) => squadOvr(cfg, c.clubs[b]!) - squadOvr(cfg, c.clubs[a]!));
        return order.slice(0, cfg.career.intlPerNation);
    });

const buildSeason = (cfg: GameConfig, c: Career, rng: Rng, qualifiers: string[]) => {
    for (const d of c.divisions) d.fixtures = roundRobin(d.clubs, rng, `s${c.season}-t${d.tier}`);
    for (const [nation, pyramid] of Object.entries(c.world))
        for (const d of pyramid) d.fixtures = roundRobin(d.clubs, rng, `s${c.season}-${nation}-t${d.tier}`);
    c.cup = createCup(
        'cup',
        CUP_NAME,
        rng,
        c.season,
        c.divisions.flatMap((d) => d.clubs),
    );
    c.intl = qualifiers.length >= 2 ? createCup('intl', INTL_CUP_NAME, rng, c.season, qualifiers) : undefined;
    scheduleCups(cfg, c);
};

export const newCareer = (
    cfg: GameConfig,
    seed: number,
    settings: CareerSettings,
    opts: {
        name?: string;
        short?: string;
        kit?: string;
        awayKit?: string;
        keeperKit?: string;
        nation?: NationId;
        /** Starting division (0 = top flight … 4 = bottom); the default is the bottom. */
        tier?: number;
        /** The manager's ground: its look and a size the starting division allows. */
        ground?: { look: GroundLook; size: StadiumSize };
    } = {},
): Career => {
    const rng = createRng(seed);
    const nation = NATIONS[opts.nation ?? DEFAULT_NATION];
    const c: Career = {
        version: SAVE_VERSION,
        seed,
        nation: nation.id,
        rngState: 0,
        season: 1,
        day: 1,
        userClubId: '',
        clubs: {},
        divisions: [],
        world: {},
        market: [],
        listed: [],
        news: [],
        ledger: [],
        drills: [...DEFAULT_DRILLS],
        settings,
        history: [],
        nextId: 1,
    };
    c.divisions = buildPyramid(cfg, rng, c, nation.id, 'c', 0);
    // every other nation plays its own full pyramid alongside
    let kitStart = cfg.career.divisions * cfg.career.clubsPerDivision;
    for (const other of NATION_IDS) {
        if (other === nation.id) continue;
        c.world[other] = buildPyramid(cfg, rng, c, other, `${other}-c`, kitStart);
        kitStart += 7;
    }
    // the manager takes over a club in the chosen division (the bottom one by default)
    const startTier = Math.max(0, Math.min(cfg.career.divisions - 1, opts.tier ?? cfg.career.divisions - 1));
    const user = c.clubs[c.divisions[startTier]!.clubs[0]!]!;
    if (opts.name) {
        user.name = opts.name;
        user.short =
            opts.name
                .replace(/[^A-Za-z]/g, '')
                .slice(0, 3)
                .toUpperCase() || user.short;
    }
    if (opts.short?.trim()) user.short = opts.short.trim().slice(0, 3).toUpperCase();
    if (opts.kit) user.kit = opts.kit;
    if (opts.awayKit && !kitsClash(cfg, opts.awayKit, user.kit)) user.awayKit = opts.awayKit;
    else if (opts.kit) user.awayKit = awayKitFor(cfg, user.kit);
    if (opts.keeperKit) user.keeperKit = opts.keeperKit;
    // the ground: the chosen look, at a size the starting division has unlocked
    const size = opts.ground && groundAllowed(cfg, opts.ground.size, startTier) ? opts.ground.size : startingGroundSize(cfg, startTier);
    const place = user.name.split(' ')[0]!;
    const look = opts.ground?.look ?? defaultGroundLook(place);
    const named = look.name.trim() || `${place} ${({ village: '초원구장', town: '파크', city: '스타디움', grand: '아레나' } as const)[size]}`;
    user.stadium = customStadium({ ...look, name: named }, size, cfg.career.ground[size].capacity);
    c.userClubId = user.id;
    buildSeason(cfg, c, rng, intlQualifiers(cfg, c, false));
    c.market = buildMarket(cfg, rng, c);
    initStory(c, rng);
    c.news.push({
        season: 1,
        day: 1,
        tone: 'info',
        text:
            startTier === cfg.career.divisions - 1
                ? `${user.name}의 지휘봉을 잡았습니다. 피라미드의 맨 아래입니다. 목표는 승격입니다.`
                : startTier === 0
                  ? `${user.name}의 지휘봉을 잡았습니다. 1부 리그입니다. 먼저 잔류하고, 그다음 챔피언스컵을 노리세요.`
                  : `${user.name}의 지휘봉을 잡았습니다. ${leagueName(nation.id, startTier)}입니다. 목표는 승격입니다.`,
    });
    saveRng(c, rng);
    return c;
};

const ordinal = (n: number) => `${n}위`;

// ------------------------------------------------------------------ queries

export const userClub = (c: Career) => c.clubs[c.userClubId]!;
export const divisionOf = (c: Career, clubId: string) => c.divisions.find((d) => d.clubs.includes(clubId))!;

export const today = (cfg: GameConfig, c: Career): Today => {
    if (c.day > seasonDays(cfg, c)) return { kind: 'seasonEnd' };
    const index = (c.day - 1) / cfg.career.daysPerMatchday;
    if (!Number.isInteger(index)) return { kind: 'training' };
    const date = seasonSchedule(cfg, c)[index]!;
    const fixture = scheduledFixture(c, date);
    return fixture ? { kind: 'match', fixture, round: date.round, cup: date.cup } : { kind: 'training', cup: date.cup };
};

export const table = (d: Division): TableRow[] => {
    const rows = new Map<string, TableRow>(d.clubs.map((id) => [id, { club: id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
    for (const f of d.fixtures) {
        if (!f.result) continue;
        const [h, a] = f.result;
        const H = rows.get(f.home)!;
        const A = rows.get(f.away)!;
        H.p++;
        A.p++;
        H.gf += h;
        H.ga += a;
        A.gf += a;
        A.ga += h;
        if (h > a) {
            H.w++;
            A.l++;
            H.pts += 3;
        } else if (h < a) {
            A.w++;
            H.l++;
            A.pts += 3;
        } else {
            H.d++;
            A.d++;
            H.pts++;
            A.pts++;
        }
    }
    return [...rows.values()].sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf);
};

export const squadOvr = (cfg: GameConfig, club: CareerClub) => {
    const xi = club.lineup.map((id) => club.squad.find((p) => p.id === id)).filter(Boolean) as Player[];
    return xi.length ? xi.reduce((a, p) => a + ovr(cfg, p), 0) / xi.length : 0;
};

export const wageBill = (cfg: GameConfig, club: CareerClub) => club.squad.reduce((a, p) => a + wage(cfg, p), 0);

// ------------------------------------------------------------------ lineups & match clubs

/** Strength of a club's best XI in a formation (sum of slot fits). */
/** Every player's fit for every class, computed once (the lineup picks reuse it a lot). */
type FitTable = (p: Player, cls: ClassId) => number;
const fitTable = (cfg: GameConfig): FitTable => {
    const memo = new Map<string, number>();
    return (p, cls) => {
        const k = `${p.id}:${cls}`;
        let v = memo.get(k);
        if (v === undefined) memo.set(k, (v = fitFor(cfg, p, cls)));
        return v;
    };
};

const lineupFit = (cfg: GameConfig, club: Club, formationId: string, fit: FitTable) => {
    const lineup = autoLineup(cfg, { ...club, formationId }, fit);
    const formation = cfg.formations.find((f) => f.id === formationId)!;
    return lineup.reduce((sum, id, i) => {
        const p = club.squad.find((q) => q.id === id);
        return sum + (p ? fit(p, formation.slots[i]!.cls) : 0);
    }, 0);
};

/**
 * An AI club's formation: a random pick among the shapes its squad fills nearly as well as its
 * best one, so clubs play to their players without every club converging on the same shape.
 */
export const pickFormation = (cfg: GameConfig, rng: Rng, club: Club, tolerance = 0.02): string => {
    const fits0 = fitTable(cfg);
    const fits = cfg.formations.map((f) => ({ id: f.id, fit: lineupFit(cfg, club, f.id, fits0) }));
    const best = Math.max(...fits.map((f) => f.fit));
    return rng.pick(fits.filter((f) => f.fit >= best * (1 - tolerance))).id;
};

/** Best fit for each formation slot, injured players excluded. */
export const autoLineup = (cfg: GameConfig, club: Club, fit: FitTable = fitTable(cfg)): string[] => {
    const formation = cfg.formations.find((f) => f.id === club.formationId) ?? cfg.formations[0]!;
    const used = new Set<string>();
    // fill the most specialised slots (keeper) first
    const order = formation.slots
        .map((s, i) => ({ s, i }))
        .sort((a, b) => (a.s.cls === 'keeper' ? -1 : 0) - (b.s.cls === 'keeper' ? -1 : 0));
    const out: string[] = Array.from({ length: formation.slots.length }, () => '');
    for (const { s, i } of order) {
        const best = club.squad.filter((p) => !used.has(p.id)).sort((a, b) => fit(b, s.cls) - fit(a, s.cls))[0];
        if (best) {
            used.add(best.id);
            out[i] = best.id;
        }
    }
    return out;
};

/** Make sure a lineup is complete and has no injured or departed players. */
export const validLineup = (cfg: GameConfig, club: CareerClub) => {
    const ids = new Set(club.squad.map((p) => p.id));
    const formation = cfg.formations.find((f) => f.id === club.formationId) ?? cfg.formations[0]!;
    const bad =
        club.lineup.length !== formation.slots.length ||
        club.lineup.some((id) => !ids.has(id) || club.squad.find((p) => p.id === id)!.injury);
    if (bad) club.lineup = autoLineup(cfg, club);
    return club.lineup;
};

/** A `Club` ready for the match engine: the XI in slot order, sprites from the kit. */
export const matchClub = (cfg: GameConfig, club: CareerClub, kitOverride?: string): Club => {
    validLineup(cfg, club);
    const kit = kitOverride ?? club.kit;
    const squad = club.lineup.map((id, i) => {
        const p = club.squad.find((q) => q.id === id)!;
        const formation = cfg.formations.find((f) => f.id === club.formationId) ?? cfg.formations[0]!;
        const isKeeper = formation.slots[i]?.cls === 'keeper';
        p.sprite = isKeeper ? club.keeperKit : `${kit}_player_${p.look ?? 1}`;
        return p;
    });
    // bench: the best fit players not starting, always a keeper if there is one
    const fresh = club.squad.filter((p) => !club.lineup.includes(p.id) && !p.injury);
    const gk = fresh.filter((p) => p.cls === 'keeper').sort((a, b) => ovr(cfg, b) - ovr(cfg, a))[0];
    const rest = fresh.filter((p) => p !== gk).sort((a, b) => ovr(cfg, b) - ovr(cfg, a));
    const bench = [...(gk ? [gk] : []), ...rest].slice(0, cfg.subs.bench).map((p) => {
        p.sprite = p.cls === 'keeper' ? club.keeperKit : `${kit}_player_${p.look ?? 1}`;
        return p;
    });
    return {
        id: club.id,
        name: club.name,
        short: club.short,
        kit,
        keeperKit: club.keeperKit,
        formationId: club.formationId,
        squad,
        bench,
        tier: club.tier,
        morale: club.morale,
        style: club.style,
    };
};

/** Clubs for the engine, home first; away swaps to a different kit on a clash. */
export const fixtureClubs = (cfg: GameConfig, c: Career, f: Fixture): [Club, Club] => {
    const home = c.clubs[f.home]!;
    const away = c.clubs[f.away]!;
    for (const cl of [home, away]) cl.morale = cl.id === c.userClubId ? story(c).morale : 60;
    // the away side changes strip only on a clash; older saves without an away kit get one that fits
    const awayKit = !kitsClash(cfg, away.kit, home.kit)
        ? away.kit
        : away.awayKit && !kitsClash(cfg, away.awayKit, home.kit)
          ? away.awayKit
          : awayKitFor(cfg, away.kit, 0, home.kit);
    return [matchClub(cfg, home), matchClub(cfg, away, awayKit)];
};

// ------------------------------------------------------------------ simulation

const poisson = (rng: Rng, lambda: number) => {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
        k++;
        p *= rng();
    } while (p > L);
    return k - 1;
};

const fixtureGoalRates = (cfg: GameConfig, c: Career, f: Fixture, fraction: number, userEdge: number): [number, number] => {
    const s = cfg.career.sim;
    const h = squadOvr(cfg, c.clubs[f.home]!);
    const a = squadOvr(cfg, c.clubs[f.away]!);
    const e = userEdge * cfg.career.prep.simEdge * (f.home === c.userClubId ? 1 : f.away === c.userClubId ? -1 : 0);
    const lh = s.baseGoals * Math.pow(h / a, s.exponent) * s.home * fraction * (1 + e);
    const la = s.baseGoals * Math.pow(a / h, s.exponent) * fraction * (1 - e);
    return [lh, la];
};

export const simulateScore = (cfg: GameConfig, rng: Rng, c: Career, f: Fixture, fraction = 1, userEdge = 0): [number, number] => {
    validLineup(cfg, c.clubs[f.home]!);
    validLineup(cfg, c.clubs[f.away]!);
    const [home, away] = fixtureGoalRates(cfg, c, f, fraction, userEdge);
    return [poisson(rng, home), poisson(rng, away)];
};

/** Estimate a win if the remaining rounds of an active fixture are simulated. */
export const simulatedWinChance = (cfg: GameConfig, c: Career, f: Fixture, score: readonly [number, number], fraction: number) => {
    const [home, away] = fixtureGoalRates(cfg, c, f, fraction, 0);
    const atHome = f.home === c.userClubId;
    const [ours, theirs] = atHome ? [home, away] : [away, home];
    const lead = atHome ? score[0] - score[1] : score[1] - score[0];
    // The far tail is negligible at ordinary match scoring rates.
    const goalLimit = (rate: number) => Math.ceil(rate + 12 * Math.sqrt(rate + 1));
    let theirProbability = Math.exp(-theirs);
    const theirCumulative = [theirProbability];
    for (let goals = 1; goals <= goalLimit(theirs); goals++) {
        theirProbability *= theirs / goals;
        theirCumulative.push(theirCumulative[goals - 1]! + theirProbability);
    }
    let ourProbability = Math.exp(-ours);
    let win = 0;
    const cup = isCupFixture(f);
    for (let goals = 0; goals <= goalLimit(ours); goals++) {
        const mostTheyCanScore = goals + lead - 1;
        const outright = mostTheyCanScore < 0 ? 0 : (theirCumulative[mostTheyCanScore] ?? 1);
        const tied = cup && mostTheyCanScore >= -1 ? (theirCumulative[mostTheyCanScore + 1] ?? 1) - outright : 0;
        win += ourProbability * (outright + tied * 0.5);
        ourProbability *= ours / (goals + 1);
    }
    return Math.min(1, win);
};

// ------------------------------------------------------------------ the day loop

const news = (c: Career, text: string, tone: News['tone'] = 'info', day = c.day) => {
    c.news.unshift({ season: c.season, day, text, tone });
    // Older news can roll off, but the calendar needs the whole current season.
    if (c.news.length > 80 && c.news[80]!.season !== c.season) c.news.length = 80;
};
const book = (c: Career, label: string, amount: number) => {
    const u = userClub(c);
    u.budget += amount;
    c.ledger.unshift({ season: c.season, day: c.day, label, amount });
    if (c.ledger.length > 120) c.ledger.length = 120;
};

export type MatchReport = {
    score: [number, number];
    knocks: Record<string, number>;
    played: string[];
    /** Per-player lines from a match played on the board (both teams); absent for quick sims. */
    lines?: Record<string, PlayerMatchLine>;
};

const aiMatchXp = (cfg: GameConfig, rng: Rng, club: CareerClub) => {
    for (const id of club.lineup) {
        const p = club.squad.find((q) => q.id === id);
        if (!p) continue;
        gainXp(cfg, p, cfg.career.matchXp * 0.8);
        autoLevel(cfg, rng, p);
    }
};

const playCupRound = (cfg: GameConfig, c: Career, rng: Rng, round: CupRound, userMatch?: { id: string; score: [number, number] }) => {
    for (const f of round.fixtures) {
        const score = f.id === userMatch?.id ? userMatch.score : simulateScore(cfg, rng, c, f);
        recordCupScore(rng, f, score);
        for (const id of [f.home, f.away]) {
            if (id !== c.userClubId) aiMatchXp(cfg, rng, c.clubs[id]!);
        }
    }
};

const finishCupRound = (cfg: GameConfig, c: Career, rng: Rng, round: CupRound) => {
    const cup = cupOf(c, round);
    const next = advanceCup(cup, round, rng, c.season);
    if (cup.champion) {
        const won = cup.champion === c.userClubId;
        const bonus = cup.key === 'intl' ? cfg.career.intlWinnerBonus : cfg.career.cupWinnerBonus;
        if (won) book(c, `${cup.name} 우승`, cfg.career.matchFee[userClub(c).tier]! * bonus);
        const champ = c.clubs[cup.champion]!;
        news(c, `${champ.name}${cup.key === 'intl' ? ` (${NATIONS[champ.nation].name})` : ''}이(가) ${cup.name}에서 우승했습니다!`, won ? 'good' : 'info');
    }
    const fixture = next && fixtureForClub(next.fixtures, c.userClubId);
    if (fixture) {
        const home = fixture.home === c.userClubId;
        const opponent = c.clubs[home ? fixture.away : fixture.home]!;
        const from = cup.key === 'intl' ? ` (${NATIONS[opponent.nation].name})` : '';
        news(c, `${cup.name} 추첨 · ${next.label}, ${next.day}일차 ${home ? '홈' : '원정'} ${opponent.name}${from}전.`);
    }
};

const playLeagueRound = (cfg: GameConfig, c: Career, rng: Rng, round: number, userMatch: Fixture, report: MatchReport) => {
    for (const d of c.divisions) {
        for (const f of d.fixtures.filter((x) => x.round === round)) {
            if (f.id === userMatch.id) {
                f.result = report.score;
                continue;
            }
            f.result = simulateScore(cfg, rng, c, f);
            story.recordFixture(c, simLines(rng, c.clubs[f.home]!, f.result[0], f.result[1]));
            story.recordFixture(c, simLines(rng, c.clubs[f.away]!, f.result[1], f.result[0]));
        }
    }
    // the rest of the world plays its matchday too
    for (const pyramid of Object.values(c.world))
        for (const d of pyramid) for (const f of d.fixtures) if (f.round === round) f.result = simulateScore(cfg, rng, c, f);
};

/**
 * Resolve the user's fixture from the report, sim the other fixtures, and apply matchday rewards.
 */
export const playMatchday = (cfg: GameConfig, c: Career, report: MatchReport) => {
    const t = today(cfg, c);
    if (t.kind !== 'match') return;
    const rng = careerRng(c);
    const u = userClub(c);
    const f = t.fixture;
    if (t.cup) playCupRound(cfg, c, rng, t.cup, { id: f.id, score: report.score });
    else playLeagueRound(cfg, c, rng, t.round, f, report);

    const home = f.home === u.id;
    const [gf, ga] = home ? report.score : ([report.score[1], report.score[0]] as [number, number]);
    const opp = c.clubs[home ? f.away : f.home]!;
    const fee = cfg.career.matchFee[u.tier]!;
    const winner = isCupFixture(f) ? cupWinner(f) : gf === ga ? undefined : gf > ga ? u.id : opp.id;
    const won = winner === u.id;
    const penalties = penaltyScore(f, home ? 0 : 1);
    book(c, `경기 수당 vs ${opp.short}`, fee);
    if (home) book(c, `입장 수입 · ${stadiumOf(c, u).name}`, Math.round(fee * cfg.career.ground[stadiumOf(c, u).size].gate));
    if (won) book(c, '승리 보너스', Math.round(fee * cfg.career.winBonus));
    else if (!winner) book(c, '무승부 보너스', Math.round(fee * cfg.career.drawBonus));
    book(c, '주급', -wageBill(cfg, u));
    const score = `${gf}–${ga}${penalties ? ` (${penalties})` : ''}`;
    news(
        c,
        `${t.cup ? `${cupOf(c, t.cup).name} · ${t.cup.label} · ` : ''}${won ? '승' : winner ? '패' : '무'} ${score} ${home ? '홈' : '원정'} ${opp.name}전.`,
        won ? 'good' : winner ? 'bad' : 'info',
    );
    if (t.cup && !won) news(c, `${cupOf(c, t.cup).name} 도전이 ${t.cup.label}에서 끝났습니다.`, 'bad');

    // match XP & injuries for the user's XI
    for (const id of report.played) {
        const p = u.squad.find((q) => q.id === id);
        if (!p) continue;
        if (gainXp(cfg, p, cfg.career.matchXp)) news(c, `${p.name} 선수가 레벨업 준비를 마쳤습니다. 포지션을 고르세요.`, 'good');
        for (let k = 0; k < (report.knocks[id] ?? 0); k++) {
            if (rng.chance(cfg.training.knockInjuryChance)) {
                const days = rng.int(cfg.training.injuryDays[0], cfg.training.injuryDays[1]);
                p.injury = Math.max(p.injury ?? 0, days);
                news(c, `${p.name} 선수가 부상을 입었습니다. ${days}일 결장.`, 'bad');
                break;
            }
        }
    }
    // the user's fixture: real lines when played on the board, invented ones for a quick sim
    const userLines = report.lines ?? (t.cup ? {} : simLines(rng, u, gf, ga));
    const mineOnly = Object.fromEntries(Object.entries(userLines).filter(([id]) => u.squad.some((p) => p.id === id)));
    if (!t.cup) {
        const oppLines = report.lines ?? simLines(rng, opp, ga, gf);
        story.recordFixture(c, Object.fromEntries(Object.entries(oppLines).filter(([id]) => opp.squad.some((p) => p.id === id))));
    }
    afterMatchday(
        cfg,
        c,
        rng,
        f,
        gf,
        ga,
        mineOnly,
        !!report.lines,
        (label, amount) => book(c, label, amount),
        (text, tone) => news(c, text, tone),
    );

    if (t.cup) finishCupRound(cfg, c, rng, t.cup);
    else {
        for (const club of Object.values(c.clubs)) {
            if (club.id !== u.id) aiMatchXp(cfg, rng, club);
        }
    }
    saveRng(c, rng);
    c.day++;
};

/**
 * The manager spends a player's banked level on `cls`: an existing class or a new outfield one.
 * Returns the news line, or null if the player can't level up into that class right now.
 */
export const chooseLevelUp = (cfg: GameConfig, c: Career, playerId: string, cls: ClassId): string | null => {
    const p = userClub(c).squad.find((q) => q.id === playerId);
    if (!p) return null;
    const rng = careerRng(c);
    const isNew = classLevel(p, cls) === 0;
    if (!levelUp(cfg, rng, p, cls)) return null;
    saveRng(c, rng);
    const text = isNew
        ? `${p.name} 선수가 새 포지션 ${cfg.classes[cls].label}을(를) 익혔습니다!`
        : `${p.name} 선수가 ${cfg.classes[cls].short} ${classLevel(p, cls)}에 도달했습니다.`;
    news(c, text, 'good');
    if (isNew)
        bumpQuest(cfg, c, 'newclass', 1, 'add', (amount, title) => {
            book(c, `퀘스트 완료: ${title}`, amount);
            news(c, `퀘스트 완료: ${title}! +${money(amount)}.`, 'good');
        });
    return text;
};

/** The manager picks a perk from one of a player's pending tiers. Returns the news line, or null. */
export const choosePerk = (cfg: GameConfig, c: Career, playerId: string, perk: PerkId): string | null => {
    const p = userClub(c).squad.find((q) => q.id === playerId);
    if (!p || !pickPerk(cfg, p, perk)) return null;
    const d = perkDef(cfg, perk);
    const text = `${p.name} learns ${d.label}${d.kind === 'passive' ? ' (passive)' : ''}.`;
    news(c, text, 'good');
    return text;
};

/** Run one drill per club and rest injured players. */
/** Two different drills at random (what AI clubs run). */
const randomDrills = (rng: Rng): Drills => {
    const a = rng.pick(DRILL_IDS);
    return [a, rng.pick(DRILL_IDS.filter((s) => s !== a))];
};

export const trainingDay = (cfg: GameConfig, c: Career) => {
    const t = today(cfg, c);
    if (t.kind !== 'training') return;
    const rng = careerRng(c);
    const u = userClub(c);
    const trainees: Trainee[] = [];
    const updates: string[] = [];
    const announce = (text: string, tone: News['tone']) => {
        news(c, text, tone);
        updates.unshift(text);
    };
    let recovering = 0;
    let xp = 0;
    let gains = 0;
    const cupClubs = new Set(t.cup?.fixtures.flatMap((f) => [f.home, f.away]));
    for (const club of Object.values(c.clubs)) {
        if (cupClubs.has(club.id)) continue;
        const isUser = club === u;
        const drills: Drills = isUser ? c.drills : randomDrills(rng);
        for (const p of club.squad) {
            const gain = trainingGain(cfg, p, drills);
            if (!gain) {
                if (isUser) recovering++;
                p.injury = (p.injury ?? 0) - cfg.training.heal;
                if (p.injury <= 0) {
                    delete p.injury;
                    if (isUser) announce(`${p.name} 선수가 부상에서 회복했습니다.`, 'good');
                }
                continue;
            }
            const { cls, amount } = gain;
            const ready = gainXp(cfg, p, amount);
            const up = drillStats(cfg, rng, p, drills);
            // AI clubs level up on the spot; the manager chooses the class for their own players
            if (!isUser) {
                autoLevel(cfg, rng, p);
                continue;
            }
            trainees.push({ player: p, cls });
            xp += amount;
            for (const st of up) {
                gains++;
                updates.push(`${p.name} ${DRILLS[st].label} +1.`);
            }
            if (ready) announce(`${p.name} 선수가 레벨업 준비를 마쳤습니다. 포지션을 고르세요.`, 'good');
        }
    }
    if (t.cup) {
        playCupRound(cfg, c, rng, t.cup);
        finishCupRound(cfg, c, rng, t.cup);
    }
    transferDay(cfg, c, rng, announce);
    const letter = afterTraining(cfg, c, rng, { trainees });
    if (letter) {
        letter.trainingDay = c.day;
        updates.unshift(`새 편지 · ${letter.title}`);
    }
    const summary = trainees.length
        ? `${drillsLabel(c.drills)} · ${trainees.length}명 훈련 · 경험치 ${xp} 획득${gains ? ` · 능력치 ${gains}개 상승` : ''}${recovering ? ` · ${recovering}명 회복 중` : ''}.`
        : '회복일. 선수단이 쉬었습니다.';
    news(c, summary);
    saveRng(c, rng);
    c.day++;
    return { summary, updates };
};

export type SeasonCeremony = {
    season: number;
    tier: number;
    position: number;
    champion: boolean;
    promoted: boolean;
    relegated: boolean;
    lines: string[];
    awards: ReturnType<typeof seasonAwards>;
};

/** Season end: rewards, promotion/relegation, aging, retirements, new fixtures & market. */
export const endSeason = (cfg: GameConfig, c: Career): SeasonCeremony => {
    const rng = careerRng(c);
    const summary: string[] = [];
    const u = userClub(c);
    const userDiv = divisionOf(c, u.id);
    const pos = table(userDiv).findIndex((r) => r.club === u.id) + 1;
    const ceremony: SeasonCeremony = {
        season: c.season,
        tier: u.tier,
        position: pos,
        champion: pos === 1,
        promoted: false,
        relegated: false,
        lines: summary,
        awards: seasonAwards(c),
    };
    const fee = cfg.career.matchFee[u.tier]!;
    c.history.push({ season: c.season, tier: u.tier, position: pos });
    if (pos === 1) {
        book(c, '시즌 목표: 우승', fee * cfg.career.goalTitle);
        summary.push(`${leagueName(u.nation, u.tier)} 우승!`);
    } else if (pos <= 4) {
        book(c, '시즌 목표: 상위 4위', fee * cfg.career.goalTop4);
        summary.push(`${ordinal(pos)} 마감: 상위 4위 보너스.`);
    } else summary.push(`${ordinal(pos)} 마감.`);
    if (pos <= cfg.career.clubsPerDivision - cfg.career.relegate) book(c, '시즌 목표: 잔류', fee * cfg.career.goalSurvive);

    // next season's international cup: the top of every top flight, from the final tables
    const qualifiers = intlQualifiers(cfg, c, true);
    if (qualifiers.includes(u.id)) summary.push(`${INTL_CUP_NAME} 진출!`);

    // promotion / relegation between adjacent tiers, inside every nation's pyramid
    for (const pyramid of [c.divisions, ...Object.values(c.world)]) {
        const moves: Array<{ id: string; from: number; to: number }> = [];
        for (const d of pyramid) {
            const t = table(d);
            if (d.tier > 0) for (const r of t.slice(0, cfg.career.promote)) moves.push({ id: r.club, from: d.tier, to: d.tier - 1 });
            if (d.tier < pyramid.length - 1)
                for (const r of t.slice(-cfg.career.relegate)) moves.push({ id: r.club, from: d.tier, to: d.tier + 1 });
        }
        for (const mv of moves) {
            pyramid[mv.from]!.clubs = pyramid[mv.from]!.clubs.filter((x) => x !== mv.id);
            pyramid[mv.to]!.clubs.push(mv.id);
            c.clubs[mv.id]!.tier = mv.to;
            if (mv.id === u.id) {
                summary.push(
                    mv.to < mv.from
                        ? `${leagueName(u.nation, mv.to)}(으)로 승격!`
                        : `${leagueName(u.nation, mv.to)}(으)로 강등.`,
                );
                if (mv.to < mv.from) ceremony.promoted = true;
                else ceremony.relegated = true;
            }
        }
    }

    // aging & retirement across every squad
    for (const club of Object.values(c.clubs)) {
        // retirement replaces club.squad with a filtered copy, so iterating the original is safe
        for (const p of club.squad) {
            ageOneSeason(cfg, rng, p);
            if (p.age >= cfg.career.retireFrom && rng.chance(cfg.career.retireChance)) {
                club.squad = club.squad.filter((q) => q.id !== p.id);
                if (club.id === u.id) summary.push(`${p.name} 선수가 ${p.age}세에 은퇴했습니다.`);
            }
        }
        // AI clubs refill with youth so squads stay playable; the user gets free trialists only below the minimum
        if (club.id === u.id) {
            const classes = Object.keys(cfg.career.squadMake) as ClassId[];
            while (club.squad.length < cfg.career.squadMin) {
                const needKeeper = !club.squad.some((p) => p.cls === 'keeper');
                const p = clubPlayer(
                    cfg,
                    rng,
                    c,
                    club,
                    needKeeper ? 'keeper' : rng.pick(classes),
                    Math.max(0, ...club.squad.map((q) => q.number)) + 1,
                    [17, 19],
                );
                club.squad.push(p);
                summary.push(`선수단을 채우기 위해 아카데미 테스트 선수 ${p.name}(${cfg.classes[p.cls].short})이(가) 합류합니다.`);
            }
        } else {
            for (const [cls, count] of Object.entries(cfg.career.squadMake) as Array<[ClassId, number]>) {
                while (club.squad.filter((p) => p.cls === cls).length < count) {
                    club.squad.push(clubPlayer(cfg, rng, c, club, cls, club.squad.length + 1, [17, 20]));
                }
            }
            // a new season, a fresh look at the shape that suits the squad
            club.formationId = pickFormation(cfg, rng, club);
        }
        club.lineup = autoLineup(cfg, club);
    }

    // AI clubs: a season's income from gates and prize money, by division (capped)
    const tr = cfg.career.transfers;
    for (const club of Object.values(c.clubs)) {
        if (club.id === u.id) continue;
        const base = cfg.career.startingBudget[club.tier]!;
        club.budget = Math.min(base * tr.aiBudgetCap, club.budget + base * tr.aiIncome);
    }

    c.season++;
    c.day = 1;
    buildSeason(cfg, c, rng, qualifiers);
    // free agents carry over: the old ones hang up their boots, a youth crop joins, the pool stays a sane size
    for (const p of c.market) ageOneSeason(cfg, rng, p);
    c.market = c.market.filter((p) => p.age < cfg.career.retireFrom);
    c.market.push(...buildMarket(cfg, rng, c, cfg.career.market.size, cfg.career.market.foreignShare, 0.75));
    if (c.market.length > cfg.career.market.maxFreeAgents)
        c.market = c.market.sort((a, b) => playerValue(cfg, b) - playerValue(cfg, a)).slice(0, cfg.career.market.maxFreeAgents);
    c.listed = c.listed.filter((l) => c.clubs[l.club]?.squad.some((q) => q.id === l.id));
    for (const s of summary) news(c, s, s.includes('강등') || s.includes('은퇴') ? 'bad' : 'good');
    news(c, `${c.season}시즌이 시작됩니다. 새로운 젊은 자유 계약 선수들이 시장에 나왔습니다.`, 'info');
    resetSeason(c, rng);
    saveRng(c, rng);
    return ceremony;
};

// ------------------------------------------------------------------ transfers (real players moving between clubs)

/** A day number that keeps counting across seasons (for transfer-list expiry). */
const absDay = (c: Career) => c.season * 1000 + c.day;

/** A player on the market: a free agent (club null) or transfer-listed by a club. */
export type MarketEntry = { p: Player; club: CareerClub | null };

/** Everything for sale: free agents and transfer-listed players. */
export const marketEntries = (c: Career): MarketEntry[] => [
    ...c.market.map((p) => ({ p, club: null })),
    ...c.listed.flatMap((l) => {
        const club = c.clubs[l.club];
        const p = club?.squad.find((q) => q.id === l.id);
        return club && p ? [{ p, club }] : [];
    }),
];
export const marketEntry = (c: Career, playerId: string): MarketEntry | undefined => {
    const free = c.market.find((p) => p.id === playerId);
    if (free) return { p: free, club: null };
    const l = c.listed.find((x) => x.id === playerId);
    const club = l && c.clubs[l.club];
    const p = club?.squad.find((q) => q.id === playerId);
    return club && p ? { p, club } : undefined;
};
/** What it costs to sign: the asking price from a club, a signing-on fee for a free agent. */
export const marketPrice = (cfg: GameConfig, e: MarketEntry) =>
    e.club ? askingPrice(cfg, e.p) : Math.round((playerValue(cfg, e.p) * cfg.career.market.freeAgentFee) / 1000) * 1000;

/** Move a player to `to` (from a club, or from the free agents) and settle the fee between AI clubs. */
const transfer = (c: Career, p: Player, from: CareerClub | null, to: CareerClub, fee: number) => {
    if (from) {
        from.squad = from.squad.filter((q) => q.id !== p.id);
        from.lineup = from.lineup.filter((id) => id !== p.id);
        if (from.id !== c.userClubId) from.budget += fee;
    } else c.market = c.market.filter((q) => q.id !== p.id);
    c.listed = c.listed.filter((l) => l.id !== p.id);
    p.number = Math.max(0, ...to.squad.map((q) => q.number)) + 1;
    to.squad.push(p);
    if (to.id !== c.userClubId) to.budget -= fee;
};

/** The XI slot where a club is weakest: its class and the fit of whoever plays there. */
const weakestSlot = (cfg: GameConfig, club: CareerClub, fit: FitTable) => {
    validLineup(cfg, club);
    const formation = cfg.formations.find((f) => f.id === club.formationId) ?? cfg.formations[0]!;
    let worst = { cls: formation.slots[0]!.cls, value: Infinity };
    club.lineup.forEach((id, i) => {
        const p = club.squad.find((q) => q.id === id);
        const cls = formation.slots[i]!.cls;
        const value = p ? fit(p, cls) : -Infinity;
        if (value < worst.value) worst = { cls, value };
    });
    return worst;
};

/** A club over the limit releases its least valuable spare; one under it signs a free agent or a youngster. */
const restock = (cfg: GameConfig, c: Career, rng: Rng, club: CareerClub, fit: FitTable) => {
    club.lineup = autoLineup(cfg, club, fit);
    while (club.squad.length > cfg.career.squadMax) {
        const spare = club.squad.filter((q) => !club.lineup.includes(q.id)).sort((a, b) => playerValue(cfg, a) - playerValue(cfg, b))[0];
        if (!spare) break;
        club.squad = club.squad.filter((q) => q.id !== spare.id);
        c.listed = c.listed.filter((l) => l.id !== spare.id);
        c.market.push(spare);
    }
    while (club.squad.length < cfg.career.squadMin) {
        const counts = (cls: ClassId) => club.squad.filter((q) => q.cls === cls).length;
        const need =
            (Object.entries(cfg.career.squadMake) as Array<[ClassId, number]>).find(([cls, n]) => counts(cls) < n)?.[0] ?? 'midfielder';
        const free = c.market
            .filter((p) => p.cls === need && marketPrice(cfg, { p, club: null }) <= club.budget)
            .sort((a, b) => fit(b, need) - fit(a, need))[0];
        if (free) transfer(c, free, null, club, marketPrice(cfg, { p: free, club: null }));
        else club.squad.push(clubPlayer(cfg, rng, c, club, need, club.squad.length + 1, [17, 19]));
    }
    club.lineup = autoLineup(cfg, club, fit);
};

/** An AI club shops: the free agent or listed player who most lifts its weakest slot, if it can pay. */
const aiShop = (
    cfg: GameConfig,
    c: Career,
    rng: Rng,
    club: CareerClub,
    fit: FitTable,
    tell: (text: string, seller: CareerClub | null) => void,
) => {
    const tr = cfg.career.transfers;
    const worst = weakestSlot(cfg, club, fit);
    const pick = marketEntries(c)
        .filter((e) => e.club?.id !== club.id && e.club?.id !== c.userClubId && marketPrice(cfg, e) <= club.budget * tr.spendShare)
        .map((e) => ({ e, gain: fit(e.p, worst.cls) - worst.value }))
        .filter((x) => x.gain >= tr.minGain)
        .sort((a, b) => b.gain - a.gain)[0];
    if (!pick) return;
    const { p, club: seller } = pick.e;
    const price = marketPrice(cfg, pick.e);
    transfer(c, p, seller, club, price);
    restock(cfg, c, rng, club, fit);
    if (seller) restock(cfg, c, rng, seller, fit);
    tell(
        `${club.name}이(가) ${p.name}(${cfg.classes[p.cls].short}) 선수를 ${seller ? `${seller.name}에서` : '자유 계약으로'} ${money(price)}에 영입했습니다.`,
        seller,
    );
};

/** An AI club with a spare player puts him on the transfer list. */
const aiList = (cfg: GameConfig, c: Career, club: CareerClub) => {
    if (club.squad.length <= cfg.career.squadMin + 1 || c.listed.length >= cfg.career.transfers.maxListed) return;
    validLineup(cfg, club);
    const spare = club.squad
        .filter((q) => !club.lineup.includes(q.id) && !c.listed.some((l) => l.id === q.id))
        .sort((a, b) => playerValue(cfg, a) - playerValue(cfg, b))[0];
    if (spare) c.listed.push({ id: spare.id, club: club.id, day: absDay(c) });
};

/** Maybe a club makes an offer for one of the manager's better players (it arrives as a letter). */
const maybeBid = (cfg: GameConfig, c: Career, rng: Rng) => {
    const tr = cfg.career.transfers;
    const u = userClub(c);
    if (story(c).inbox || u.squad.length <= cfg.career.squadMin || !rng.chance(tr.bidChance)) return;
    const targets = u.squad
        .filter((p) => !p.injury)
        .sort((a, b) => playerValue(cfg, b) - playerValue(cfg, a))
        .slice(0, 6);
    if (!targets.length) return;
    const p = rng.pick(targets);
    const amount = Math.round((playerValue(cfg, p) * (tr.bidPremium[0] + rng() * (tr.bidPremium[1] - tr.bidPremium[0]))) / 1000) * 1000;
    // clubs at your level or one division up, where he'd really start
    const buyer = suitorFor(cfg, c, rng, p, amount, [Math.max(0, u.tier - 1), u.tier]);
    if (!buyer) return;
    const abroad = buyer.nation !== c.nation ? ` (${NATIONS[buyer.nation].name})` : '';
    deliverBid(c, { buyer: buyer.id, buyerName: `${buyer.name}${abroad}`, player: p, amount });
};

/** A club (any nation, between `tiers`) that can pay `fee` and would put `p` in its XI. */
const suitorFor = (cfg: GameConfig, c: Career, rng: Rng, p: Player, fee: number, tiers: [number, number]): CareerClub | undefined => {
    const fit = fitTable(cfg);
    return Object.values(c.clubs)
        .filter((cl) => cl.id !== c.userClubId && cl.tier >= tiers[0] && cl.tier <= tiers[1] && cl.budget >= fee && !cl.squad.includes(p))
        .sort(() => rng() - 0.5)
        .slice(0, 120)
        .find((cl) => {
            // he'd replace their weakest starter in his own position
            validLineup(cfg, cl);
            const formation = cfg.formations.find((f) => f.id === cl.formationId) ?? cfg.formations[0]!;
            const starters = cl.lineup.flatMap((id, i) => {
                const q = cl.squad.find((x) => x.id === id);
                return q && formation.slots[i]!.cls === p.cls ? [fit(q, p.cls)] : [];
            });
            return starters.length > 0 && fit(p, p.cls) > Math.min(...starters) + cfg.career.transfers.bidMinGain;
        });
};

/** A training day on the market: clubs list spares and shop, old listings lapse, and maybe an offer comes in. */
const transferDay = (cfg: GameConfig, c: Career, rng: Rng, announce: (text: string, tone: News['tone']) => void) => {
    const tr = cfg.career.transfers;
    const u = userClub(c);
    const ids = Object.keys(c.clubs).filter((id) => id !== u.id);
    const fit = fitTable(cfg);
    c.listed = c.listed.filter((l) => absDay(c) - l.day <= tr.listDays && c.clubs[l.club]?.squad.some((q) => q.id === l.id));
    for (let i = 0; i < tr.listPerDay; i++) aiList(cfg, c, c.clubs[rng.pick(ids)]!);
    // news only for moves that touch the manager's division
    const myDivision = new Set(divisionOf(c, u.id).clubs);
    for (let i = 0; i < tr.clubsPerDay; i++) {
        const club = c.clubs[rng.pick(ids)]!;
        aiShop(cfg, c, rng, club, fit, (text, seller) => {
            if (myDivision.has(club.id) || (seller && myDivision.has(seller.id))) announce(text, 'info');
        });
    }
    maybeBid(cfg, c, rng);
};

// ------------------------------------------------------------------ market

/** `count` market players around the user's tier, scouted at home and abroad. */
const buildMarket = (
    cfg: GameConfig,
    rng: Rng,
    c: Career,
    count = cfg.career.market.size,
    foreignShare = cfg.career.market.foreignShare,
    youngShare = 0.4,
): Player[] => {
    const tier = userClub(c).tier;
    const classes = Object.keys(cfg.career.squadMake) as ClassId[];
    const out: Player[] = [];
    for (let i = 0; i < count; i++) {
        // mostly around the user's tier, sometimes a tier above or below
        const t = Math.max(0, Math.min(cfg.career.divisions - 1, tier + rng.int(-1, 1)));
        const young = rng.chance(youngShare);
        const from = pickNationality(rng, c.nation, foreignShare);
        const p = newPlayer(cfg, rng, c, rng.pick(classes), t, 0, young ? [17, 21] : [21, 32], from);
        out.push(p);
    }
    return out;
};

export const askingPrice = (cfg: GameConfig, p: Player) => Math.round((playerValue(cfg, p) * cfg.career.market.priceMarkup) / 1000) * 1000;
export const salePrice = (cfg: GameConfig, p: Player) => Math.round((playerValue(cfg, p) * cfg.career.market.saleCut) / 1000) * 1000;

export const buy = (cfg: GameConfig, c: Career, playerId: string): string | null => {
    const u = userClub(c);
    const e = marketEntry(c, playerId);
    if (!e) return '더 이상 영입할 수 없습니다.';
    if (u.squad.length >= cfg.career.squadMax) return `선수단이 가득 찼습니다(${cfg.career.squadMax}명).`;
    const price = marketPrice(cfg, e);
    if (u.budget < price) return '자금이 부족합니다.';
    const { p, club: seller } = e;
    transfer(c, p, seller, u, price);
    if (seller) {
        const rng = careerRng(c);
        restock(cfg, c, rng, seller, fitTable(cfg));
        saveRng(c, rng);
    }
    book(c, `${p.name} 영입`, -price);
    news(c, `${p.name} 선수가 ${seller ? `${seller.name}에서` : '자유 계약으로'} ${money(price)}에 입단했습니다.`, 'good');
    return null;
};

export const sell = (cfg: GameConfig, c: Career, playerId: string): string | null => {
    const u = userClub(c);
    const p = u.squad.find((q) => q.id === playerId);
    if (!p) return '내 선수단에 없는 선수입니다.';
    if (u.squad.length <= cfg.career.squadMin) return `선수단은 ${cfg.career.squadMin}명 아래로 줄일 수 없습니다.`;
    if (p.cls === 'keeper' && u.squad.filter((q) => q.cls === 'keeper').length <= 1) return '골키퍼가 최소 한 명은 필요합니다.';
    const price = salePrice(cfg, p);
    // a real buyer: any club (any level, any nation) that can pay and would play him
    const rng = careerRng(c);
    const buyer = suitorFor(cfg, c, rng, p, price, [0, cfg.career.divisions - 1]);
    saveRng(c, rng);
    if (!buyer) return `지금은 ${money(price)}에 ${p.name} 선수를 원하는 클럽이 없습니다. 며칠 뒤에 다시 시도하세요.`;
    transfer(c, p, u, buyer, price);
    buyer.lineup = autoLineup(cfg, buyer);
    validLineup(cfg, u);
    book(c, `${p.name} 판매`, price);
    news(
        c,
        `${p.name} 선수가 ${money(price)}에 ${buyer.name}${buyer.nation !== c.nation ? ` (${NATIONS[buyer.nation].name})` : ''}(으)로 이적했습니다.`,
        'info',
    );
    return null;
};

// ------------------------------------------------------------------ persistence

export const saveCareer = (c: Career) => writeSave(JSON.stringify(c));
export const loadCareer = (): Career | null => {
    try {
        const raw = readSave();
        if (!raw) return null;
        const c = JSON.parse(raw) as Career;
        // an older format isn't migrated: it's ignored and a new career takes its place
        return c.version === SAVE_VERSION ? c : null;
    } catch {
        return null;
    }
};
export const deleteCareer = () => deleteSave();

/** The save as it is stored, for a backup file (null without a career). */
export const careerBackup = (): string | null => readSave();
/** Replace the save with a backup file's contents. Returns why not, or null when it was taken. */
export const restoreCareer = (raw: string): string | null => {
    let c: Partial<Career>;
    try {
        c = JSON.parse(raw) as Partial<Career>;
    } catch {
        return 'Tackle Tactics 백업 파일이 아닙니다.';
    }
    if (!c || typeof c !== 'object' || !c.clubs || !c.userClubId) return 'Tackle Tactics 백업 파일이 아닙니다.';
    if (c.version !== SAVE_VERSION) return '이 백업은 이전 버전의 게임에서 만든 것이라 더 이상 불러올 수 없습니다.';
    writeSave(raw);
    return null;
};

export const userSide = (c: Career, f: Fixture): TeamSide => (f.home === c.userClubId ? 0 : 1);

/** Answer the pending inbox letter with choice `idx`; returns the outcome line (also in the news). */
export const resolveLetter = (cfg: GameConfig, c: Career, idx: number): string => {
    const rng = careerRng(c);
    const letter = story(c).inbox;
    const out = answerLetter(cfg, c, rng, idx, (label, amount) => book(c, label, amount));
    if (out) {
        if (letter?.trainingDay) news(c, `${letter.title} · ${out}`, 'info', letter.trainingDay);
        else news(c, out, 'info');
    }
    validLineup(cfg, userClub(c));
    saveRng(c, rng);
    return out;
};

/** A club's home ground, created on first use (old saves just get one). Grounds lean on the division. */
export const stadiumOf = (c: Career, club: CareerClub): Stadium => {
    if (!club.stadium) club.stadium = generateStadium(`${c.seed}-${club.id}`, club.name.split(' ')[0]!, club.tier);
    return club.stadium;
};

// ------------------------------------------------------------------ the manager's ground

/** Can a ground of `size` be had in division `tier`? (Bigger grounds need a higher division.) */
export const groundAllowed = (cfg: GameConfig, size: StadiumSize, tier: number) => tier <= cfg.career.ground[size].minTier;
/** The biggest ground a division allows: what a club starting there opens with by default. */
export const startingGroundSize = (cfg: GameConfig, tier: number): StadiumSize =>
    STADIUM_SIZES.toReversed().find((s) => groundAllowed(cfg, s, tier)) ?? 'village';
/** The next size up, and what stands in the way (null when it can be built now). */
export const groundUpgrade = (cfg: GameConfig, c: Career) => {
    const u = userClub(c);
    const now = stadiumOf(c, u).size;
    const next = STADIUM_SIZES[STADIUM_SIZES.indexOf(now) + 1];
    if (!next) return null;
    const rule = cfg.career.ground[next];
    const blocked = !groundAllowed(cfg, next, u.tier)
        ? `먼저 ${leagueName(u.nation, rule.minTier)}에 도달해야 합니다`
        : u.budget < rule.cost
          ? `${money(rule.cost)} 필요`
          : null;
    return { size: next, cost: rule.cost, capacity: rule.capacity, blocked };
};
/** Build the next size up: pays for it, raises the capacity (and the gate receipts). */
export const expandGround = (cfg: GameConfig, c: Career): string | null => {
    const up = groundUpgrade(cfg, c);
    if (!up) return '경기장이 더 이상 커질 수 없는 규모입니다.';
    if (up.blocked) return up.blocked;
    const u = userClub(c);
    const st = stadiumOf(c, u);
    book(c, `경기장 확장: ${sizeLabel(up.size).toLowerCase()}`, -up.cost);
    u.stadium = { ...st, size: up.size, capacity: up.capacity };
    news(c, `${st.name}이(가) ${sizeLabel(up.size).toLowerCase()} 규모가 되었습니다: ${up.capacity.toLocaleString('en')}석.`, 'good');
    return null;
};
/** Change how the ground looks (name, mowing, pitch, flags): free, any time. */
export const setGroundLook = (c: Career, look: GroundLook) => {
    const u = userClub(c);
    u.stadium = { ...stadiumOf(c, u), ...look, name: look.name.trim() || stadiumOf(c, u).name };
};

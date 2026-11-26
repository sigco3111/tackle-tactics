import { describe, expect, it } from 'vitest';
import { defaultConfig, withOverrides, type StatId } from '../src/config';
import { createRng } from '../src/rng';
import { writeSave } from '../src/meta/storage';
import {
    autoLineup,
    buy,
    careerRng,
    divisionOf,
    endSeason,
    fixtureClubs,
    kitsClash,
    loadCareer,
    careerBackup,
    restoreCareer,
    newCareer,
    playMatchday,
    resolveLetter,
    saveCareer,
    seasonDays,
    seasonSchedule,
    sell,
    simulateScore,
    simulatedWinChance,
    table,
    today,
    trainingDay,
    userClub,
    wageBill,
    SAVE_VERSION,
} from '../src/meta/career';
import { CUP_NAME, cupWinner, isCupFixture, type CupFixture } from '../src/meta/cup';
import { ovr, playerValue, wage, autoLevel } from '../src/meta/player';
import { story } from '../src/meta/story';
import { drillStats, trainingGain } from '../src/meta/training';

const cfg = defaultConfig;
const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };

describe('career', () => {
    it('estimates a simulated finish from the current score and the player’s side', () => {
        const oddsCfg = withOverrides({ career: { sim: { baseGoals: 2, exponent: 0, home: 0 } } });
        const c = newCareer(oddsCfg, 42, settings);
        const opponent = divisionOf(c, c.userClubId).clubs.find((id) => id !== c.userClubId)!;
        const home = { id: 'home', round: 0, home: c.userClubId, away: opponent };
        const away = { ...home, home: opponent, away: c.userClubId };
        const savedRng = c.rngState;

        expect(simulatedWinChance(oddsCfg, c, home, [0, 0], 0.5)).toBe(0);
        expect(simulatedWinChance(oddsCfg, c, home, [1, 0], 0.5)).toBeCloseTo(Math.exp(-1), 10);
        expect(simulatedWinChance(oddsCfg, c, away, [0, 0], 0.5)).toBeCloseTo(1 - Math.exp(-1), 10);
        expect(simulatedWinChance(oddsCfg, c, away, [0, 2], 0)).toBe(1);
        const cupFixture: CupFixture = { ...home, competition: 'cup' };
        expect(simulatedWinChance(oddsCfg, c, cupFixture, [0, 0], 0.5)).toBeCloseTo(Math.exp(-1) / 2, 10);
        expect(simulatedWinChance(oddsCfg, c, cupFixture, [0, 0], 0)).toBe(0.5);
        expect(c.rngState).toBe(savedRng);
    });

    it('builds a 5×10 pyramid with full squads, fixtures and a market', () => {
        const c = newCareer(cfg, 42, settings);
        expect(c.divisions.length).toBe(5);
        for (const d of c.divisions) {
            expect(d.clubs.length).toBe(10);
            expect(d.fixtures.length).toBe(90);
            expect(new Set(d.fixtures.map((f) => f.id)).size).toBe(90);
            for (const [i, firstLeg] of d.fixtures.slice(0, 45).entries()) {
                expect(d.fixtures[45 + i]).toMatchObject({ home: firstLeg.away, away: firstLeg.home, round: firstLeg.round + 9 });
            }
            for (const id of d.clubs) {
                const club = c.clubs[id]!;
                expect(club.squad.length).toBe(16);
                expect(new Set(club.lineup).size).toBe(11);
            }
        }
        expect(userClub(c).tier).toBe(4);
        expect(c.market.length).toBe(cfg.career.market.size);
        const t = today(cfg, c);
        const [h, a] = fixtureClubs(cfg, c, t.kind === 'match' ? t.fixture : c.divisions[4]!.fixtures[0]!);
        expect(h.squad.length).toBe(11);
        expect(a.kit).not.toBe(h.kit);
        const first = c.cup!.rounds[0]!;
        expect(first.fixtures).toHaveLength(18);
        expect(first.byes).toHaveLength(14);
        expect(new Set([...first.byes, ...first.fixtures.flatMap((f) => [f.home, f.away])])).toEqual(
            new Set(c.divisions.flatMap((d) => d.clubs)),
        );
        const schedule = seasonSchedule(cfg, c);
        expect(schedule.filter((date) => !date.cup).map((date) => date.round)).toEqual(Array.from({ length: 18 }, (_, i) => i));
        // six domestic and six international cup dates sit between the 18 league matchdays
        const cupDays = schedule.filter((date) => date.cup).map((date) => date.day);
        expect(cupDays).toHaveLength(c.cup!.rounds.length + c.intl!.rounds.length);
        // 17 nations send two clubs each: 34 clubs, so a preliminary round trims the field to 32
        expect(c.intl!.rounds.map((r) => r.label)).toEqual(['예선 라운드', '32강', '16강', '8강', '준결승', '결승']);
        expect(new Set(cupDays).size).toBe(cupDays.length);
        expect(cupDays.every((d) => (d - 1) % cfg.career.daysPerMatchday === 0)).toBe(true);
        // the domestic final closes the season
        expect(schedule.at(-1)!.cup).toBe(c.cup!.rounds.at(-1));
        expect(seasonDays(cfg, c)).toBe((18 + 6 + 6) * cfg.career.daysPerMatchday);
    });

    it('decides a drawn cup tie on penalties and draws the next round without changing the league', () => {
        const c = newCareer(cfg, 42, settings);
        const opening = c.cup!.rounds[0]!;
        const tie = opening.fixtures[0]!;
        c.userClubId = tie.home;
        c.day = opening.day;
        expect(today(cfg, c)).toMatchObject({ kind: 'match', fixture: { id: tie.id } });
        const standings = table(divisionOf(c, c.userClubId));
        const quests = structuredClone(story(c).quests);

        playMatchday(cfg, c, { score: [2, 2], knocks: {}, played: userClub(c).lineup });

        expect(tie.result).toEqual([2, 2]);
        expect(tie.penalties?.[0]).not.toBe(tie.penalties?.[1]);
        expect(table(divisionOf(c, c.userClubId))).toEqual(standings);
        expect(story(c).quests).toEqual(quests);
        expect(story(c).seasonStats).toEqual({});
        const next = c.cup!.rounds[1]!;
        expect(next.fixtures).toHaveLength(16);
        expect(new Set(next.fixtures.flatMap((f) => [f.home, f.away]))).toEqual(
            new Set([...opening.byes, ...opening.fixtures.map(cupWinner)]),
        );
        expect(c.news).toEqual(
            expect.arrayContaining([expect.objectContaining({ day: opening.day, text: expect.stringContaining('승부차기') })]),
        );
    });

    it.each(['win', 'loss'])('trains on a bye and finishes the cup after a user %s', (outcome) => {
        const c = newCareer(cfg, 42, settings);
        const cup = c.cup!;
        const opening = cup.rounds[0]!;
        c.userClubId = opening.byes[0]!;
        c.day = opening.day;
        expect(today(cfg, c)).toMatchObject({ kind: 'training', cup: opening });
        expect(trainingDay(cfg, c)?.summary).toContain('16명 훈련');
        expect(opening.fixtures.every((f) => !!cupWinner(f))).toBe(true);

        for (const [index, round] of cup.rounds.slice(1).entries()) {
            c.day = round.day;
            const day = today(cfg, c);
            expect(day.kind).toBe(outcome === 'loss' && index > 0 ? 'training' : 'match');
            if (day.kind === 'training') {
                trainingDay(cfg, c);
                continue;
            }
            expect(day.kind).toBe('match');
            if (day.kind !== 'match') throw new Error('Expected a cup tie');
            expect(isCupFixture(day.fixture)).toBe(true);
            const homeWins = (day.fixture.home === c.userClubId) === (outcome === 'win');
            playMatchday(cfg, c, { score: homeWins ? [1, 0] : [0, 1], knocks: {}, played: [] });
        }

        expect(cup.rounds.flatMap((r) => r.fixtures)).toHaveLength(49);
        expect(cup.champion).toBeDefined();
        expect(cup.champion === c.userClubId).toBe(outcome === 'win');
        expect(c.ledger.some((entry) => entry.label === `${CUP_NAME} 우승`)).toBe(outcome === 'win');
        c.day = 73;
        const award = endSeason(cfg, c).awards.find((a) => a.title === CUP_NAME);
        expect(award?.who).toBe(c.clubs[cup.champion!]!.name);
        expect(c.cup?.champion).toBeUndefined();
    });

    it('trains the full fit squad, rests injured players, and records both training days', () => {
        const c = newCareer(cfg, 42, settings);
        const squad = userClub(c).squad;
        const injured = squad[0]!;
        c.drills = ['tackling', 'reflexes'];
        expect(trainingDay(cfg, c)).toBeUndefined();
        playMatchday(cfg, c, { score: [0, 0], knocks: {}, played: [] });
        injured.injury = cfg.training.heal;
        c.news = Array.from({ length: 80 }, (_, i) => ({ season: c.season, day: 1, text: `Entry ${i}`, tone: 'info' }));

        const day = c.day;
        const expectedGains = squad.slice(1).map((p) => trainingGain(cfg, p, c.drills)!);
        const expectedXp = expectedGains.reduce((total, gain) => total + gain.amount, 0);
        const injuredXp = injured.xp;
        const before = squad.map((p) => ({ xp: p.xp, levels: { ...p.levels } }));
        const report = trainingDay(cfg, c)!;
        expect(report.summary).toMatch(
            new RegExp(`^태클 \\+ 반사신경 · 15명 훈련 · 경험치 ${expectedXp} 획득( · 능력치 \\d+개 상승)? · 1명 회복 중\\.$`),
        );
        expect(injured.injury).toBeUndefined();
        expect(injured.xp).toEqual(injuredXp);
        expect(report.updates).toContain(`${injured.name} 선수가 부상에서 회복했습니다.`);
        // XP goes into the player's pool; no class levels change until the manager chooses one
        for (const [i, p] of squad.slice(1).entries()) {
            expect(p.xp).toBe(before[i + 1]!.xp + expectedGains[i]!.amount);
            expect(p.levels).toEqual(before[i + 1]!.levels);
        }
        expect(c.news[0]).toMatchObject({ season: c.season, day, text: report.summary });

        for (const p of squad) p.injury = cfg.training.heal + 1;
        const rest = trainingDay(cfg, c)!;
        expect(squad.every((p) => p.injury === 1)).toBe(true);
        expect(c.news[0]).toMatchObject({ season: c.season, day: day + 1, text: '회복일. 선수단이 쉬었습니다.' });
        expect(rest.summary).toBe(c.news[0]!.text);
        expect(c.news).toHaveLength(83);
    });

    it('scales XP by how well the two drills fit the class, and by aptitude', () => {
        const c = newCareer(cfg, 42, settings);
        const p = userClub(c).squad.find((player) => player.cls === 'defender')!;
        const stats = { ...p.stats, tackling: 50, reflexes: 50, passing: 50, shooting: 50 };
        const df = { ...p, stats, levels: { defender: 2 } };
        const gain = (player: typeof p, d: [StatId, StatId]) => trainingGain(cfg, player, d)!;

        const both = gain(df, ['tackling', 'reflexes']);
        const one = gain(df, ['tackling', 'shooting']);
        const none = gain(df, ['shooting', 'speed']);
        expect([both.fit, one.fit, none.fit]).toEqual([2, 1, 0]);
        expect(both.amount).toBeGreaterThan(one.amount);
        expect(one.amount).toBeGreaterThan(none.amount);
        expect(none.amount).toBeGreaterThan(0);
        // better at the drilled attributes, more XP
        expect(gain({ ...df, stats: { ...stats, tackling: 90 } }, ['tackling', 'reflexes']).amount).toBeGreaterThan(both.amount);
        // a second class counts at half: midfield levels make passing + dribbling worth something
        expect(gain(df, ['passing', 'dribbling']).fit).toBe(0);
        expect(gain({ ...df, levels: { defender: 2, midfielder: 1 } }, ['passing', 'dribbling']).fit).toBe(1);
        expect(trainingGain(cfg, { ...df, injury: 2 }, ['tackling', 'reflexes'])).toBeNull();
    });

    it('drills can lift their attributes, never past the ceiling', () => {
        const p = { ...userClub(newCareer(cfg, 42, settings)).squad[0]! };
        p.stats = { ...p.stats, passing: 40, shooting: cfg.world.statCeil };
        const rng = createRng(3);
        let ups = 0;
        for (let i = 0; i < 400; i++) ups += drillStats(cfg, rng, p, ['passing', 'shooting']).length;
        expect(ups).toBeGreaterThan(0);
        expect(p.stats.passing).toBe(40 + ups);
        expect(p.stats.shooting).toBe(cfg.world.statCeil);
    });

    it('saves round-trip intact; an older save format is not loaded (no migrations)', () => {
        const c = newCareer(cfg, 42, settings);
        c.drills = ['reflexes', 'speed'];
        saveCareer(c);
        expect(loadCareer()).toEqual(c);
        writeSave(JSON.stringify({ ...c, version: SAVE_VERSION - 1 }));
        expect(loadCareer()).toBeNull();
    });

    it('restores a backup file, refusing junk and older versions', () => {
        const c = newCareer(cfg, 43, settings);
        expect(restoreCareer('not json')).toMatch(/백업 파일이 아닙니다/);
        expect(restoreCareer(JSON.stringify({ hello: 1 }))).toMatch(/백업 파일이 아닙니다/);
        expect(restoreCareer(JSON.stringify({ ...c, version: SAVE_VERSION - 1 }))).toMatch(/이전 버전/);
        expect(restoreCareer(JSON.stringify(c))).toBeNull();
        expect(loadCareer()).toEqual(c);
        expect(careerBackup()).toBe(JSON.stringify(c));
    });

    it('plays three seasons headless: money flows, players grow, promotion/relegation move clubs', () => {
        const c = newCareer(cfg, 7, settings);
        const u0 = userClub(c);
        const startBudget = u0.budget;
        const lvl0 = u0.squad.reduce((a, p) => a + p.level, 0);
        const log: string[] = [];
        let letters = 0;
        for (let season = 1; season <= 3; season++) {
            for (let guard = 0; guard < 200; guard++) {
                const t = today(cfg, c);
                if (t.kind === 'seasonEnd') {
                    const u = userClub(c);
                    const pos = table(divisionOf(c, u.id)).findIndex((r) => r.club === u.id) + 1;
                    const s = endSeason(cfg, c);
                    log.push(
                        `S${season}: tier ${u.tier + 1} pos ${pos} budget ${Math.round(u.budget / 1000)}k wages/md ${Math.round(wageBill(cfg, u) / 1000)}k morale ${story(c).morale} ${s.lines.join(' | ')} | awards: ${s.awards.map((a) => `${a.title}=${a.who}`).join(', ')}`,
                    );
                    break;
                }
                // answer any letter with a random choice, like a player would
                if (story(c).inbox) {
                    letters++;
                    resolveLetter(cfg, c, letters % 2); // deterministic: alternate the answers
                }
                if (t.kind === 'match') {
                    const rng = careerRng(c);
                    const score = simulateScore(cfg, rng, c, t.fixture);
                    c.rngState = rng.state();
                    playMatchday(cfg, c, { score, knocks: {}, played: userClub(c).lineup });
                } else trainingDay(cfg, c);
                // the manager's level-up choices: main class, perks at random
                const rng = careerRng(c);
                for (const p of userClub(c).squad) autoLevel(cfg, rng, p);
                c.rngState = rng.state();
            }
        }
        console.log(log.join('\n'));
        console.log(
            'letters answered',
            letters,
            'quests',
            JSON.stringify(story(c).quests.map((q) => `${q.title} ${q.progress}/${q.target}`)),
        );
        expect(letters).toBeGreaterThan(2);
        const u = userClub(c);
        const lvl1 = u.squad.reduce((a, p) => a + p.level, 0);
        expect(lvl1).toBeGreaterThan(lvl0);
        expect(c.season).toBe(4);
        expect(u.budget).not.toBe(startBudget);
        for (const d of c.divisions) expect(d.clubs.length).toBe(10);
        // tiers really differ in quality
        const avg = (t: number) => {
            const clubs = c.divisions[t]!.clubs.map((id) => c.clubs[id]!);
            return clubs.reduce((a, cl) => a + cl.squad.reduce((x, p) => x + ovr(cfg, p), 0) / cl.squad.length, 0) / clubs.length;
        };
        console.log('avg ovr by tier', [0, 1, 2, 3, 4].map((t) => avg(t).toFixed(1)).join(' '));
        expect(avg(0)).toBeGreaterThan(avg(4));
    }, 60_000); // 16 full pyramids: a few seconds a season

    it('market: buy and sell move money and players', () => {
        const c = newCareer(cfg, 9, settings);
        const u = userClub(c);
        u.budget = 10_000_000;
        const p = c.market[0]!;
        expect(buy(cfg, c, p.id)).toBeNull();
        expect(u.squad.some((q) => q.id === p.id)).toBe(true);
        const before = u.budget;
        expect(sell(cfg, c, p.id)).toBeNull();
        expect(u.budget).toBeGreaterThan(before);
        console.log(
            'sample values (bottom tier):',
            u.squad
                .slice(0, 6)
                .map((q) => `${q.name} ovr ${ovr(cfg, q)} age ${q.age} → ${Math.round(playerValue(cfg, q) / 1000)}k, wage ${wage(cfg, q)}`)
                .join('\n'),
        );
        expect(autoLineup(cfg, u).length).toBe(11);
    });

    it('a new career takes the club name, short name and both kits from the kit editor', () => {
        const c = newCareer(cfg, 9, settings, {
            name: 'Mudbury Rovers',
            short: 'mbr',
            kit: 'red',
            awayKit: 'white',
            keeperKit: 'keeper_lime',
        });
        const u = userClub(c);
        expect(u.name).toBe('Mudbury Rovers');
        expect(u.short).toBe('MBR');
        expect(u.kit).toBe('red');
        expect(u.keeperKit).toBe('keeper_lime');
        expect(u.awayKit).toBe('white');
        const f = c.divisions.at(-1)!.fixtures.find((x) => x.home === u.id || x.away === u.id)!;
        const mine = fixtureClubs(cfg, c, f).find((x) => x.id === u.id)!;
        expect(mine.squad.some((p) => p.sprite === 'keeper_lime')).toBe(true);
    });

    it('the away side changes into its away kit only when the strips clash', () => {
        const c = newCareer(cfg, 11, settings, { kit: 'blue', awayKit: 'yellow' });
        // every generated club's change strip differs from its home one (checked before the test edits kits)
        for (const cl of Object.values(c.clubs)) expect(kitsClash(cfg, cl.kit, cl.awayKit!)).toBe(false);
        const u = userClub(c);
        const f = c.divisions.at(-1)!.fixtures.find((x) => x.away === u.id)!;
        const host = c.clubs[f.home]!;
        host.kit = 'sky'; // too close to blue
        expect(kitsClash(cfg, 'blue', 'sky')).toBe(true);
        expect(fixtureClubs(cfg, c, f)[1].kit).toBe('yellow');
        host.kit = 'red'; // no clash: home strip
        expect(fixtureClubs(cfg, c, f)[1].kit).toBe('blue');
    });
});

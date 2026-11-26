/**
 * The manager hub: a sidebar of screens over one mutable `Career`. Every mutation calls
 * `changed()`, which publishes the new version of the model and autosaves.
 */
import { combined, derived, grain, type WritableGrain } from '@grainular/grains';
import { josa } from '../../world/josa';
import { GroundEditor } from '../GroundEditor';
import { NATION_IDS, NATIONS, nationOf, type NationId } from '../../world/nations';
import { leagueName, leagueShort } from '../../world/leagues';
import { flag } from '../flag';
import type { Confirm } from '../confirm';
import { $each, $if, $render, $switch, attr, html, mounted, on, type Fragment } from '@grainular/nord';
import type { ClassId, GameConfig, TeamStyle } from '../../config';
import {
    abilitiesOf,
    abilityDef,
    classLabel,
    classLevel,
    passivesOf,
    nextPerkTier,
    pendingPerks,
    perkDef,
    type PerkId,
    type AbilityId,
} from '../../engine/abilities';
import {
    autoLineup,
    buy,
    divisionOf,
    stadiumOf,
    resolveLetter,
    roundsPerSeason,
    salePrice,
    saveCareer,
    scheduledFixture,
    seasonDays,
    seasonSchedule,
    sell,
    squadOvr,
    table,
    today,
    trainingDay,
    userClub,
    validLineup,
    wageBill,
    type Career,
    type CareerClub,
    type Fixture,
    type SeasonCeremony,
    chooseLevelUp,
    choosePerk,
    cupOf,
    pyramidOf,
    marketEntries,
    marketEntry,
    marketPrice,
    expandGround,
    groundUpgrade,
    setGroundLook,
} from '../../meta/career';
import { CUP_NAME, INTL_CUP_NAME, cupWinner, isCupFixture, penaltyScore } from '../../meta/cup';
import { avgRating, moraleLabel, rivalOf, seasonLine, story } from '../../meta/story';
import { COUNTERS, isDerby, opponentOf, planEdge, prepFor, TALKS, type TeamTalk } from '../../meta/prep';
import { styleOf } from '../../ai/brain';
import { audio } from '../audio';
import { conditionsLabel, sizeLabel, type GroundLook, type StadiumSize } from '../../world/stadium';
import { fitFor, levelsReady, levelUpOptions, money, ovr, playerValue, potentialStars, wage, xpToNext } from '../../meta/player';
import { DRILLS, DRILL_IDS, drillClasses, drillsLabel, pickDrill, trainingGain } from '../../meta/training';
import type { Player } from '../../types';
import { kitColor } from '../MatchView';
import { Playbook } from '../Playbook';
import { recolorVersion } from '../recolor';
import { spriteStyle } from '../sprites';
import { prefs, setPref } from '../prefs';
import { RadioPlayer } from '../RadioUI';
import { Dialog } from '../Dialog';

type Tab = 'overview' | 'season' | 'squad' | 'tactics' | 'training' | 'league' | 'cup' | 'market' | 'finances' | 'playbook';
const TABS: Array<[Tab, string, string]> = [
    ['overview', '개요', '◈'],
    ['season', '시즌 일정', '▤'],
    ['squad', '스쿼드', '☰'],
    ['tactics', '전술', '▦'],
    ['training', '훈련', '⚒'],
    ['league', '리그', '♜'],
    ['cup', '컵 대회', '♛'],
    ['market', '이적 시장', '⇄'],
    ['finances', '재정', '¤'],
    ['playbook', '플레이북', '✦'],
];
const CLASSES: ClassId[] = ['keeper', 'defender', 'midfielder', 'winger', 'striker'];

export type HubNotice = { title: string; lines: string[] };

const PLAYER_DEVELOPMENT: HubNotice = {
    title: '선수 성장',
    lines: [
        '종합 능력치(OVR)는 현재 실력을 나타냅니다. 포지션 레벨과 각 포지션에 중요한 능력치를 합산한 값입니다. 골키퍼는 반사신경, 스트라이커는 슈팅이 더 크게 반영됩니다. 포지션 레벨은 능력도 해금합니다.',
        '잠재력 별은 레벨업당 성장폭을 보여 줍니다. 잠재력이 높을수록 보통 능력치가 더 많이 오르며, 어떤 포지션이 레벨업하느냐에 따라 오르는 능력치가 달라집니다.',
        '나이는 매 시즌 종료 시 능력치에 영향을 줍니다. 선수는 개인 전성기 나이 전에는 성장하고, 전후로는 유지되며, 이후에는 하락합니다. 베테랑도 시즌 중 레벨업으로 성장할 수 있습니다.',
        '이적 가치는 현재 OVR, 잠재력, 전성기 대비 나이를 반영합니다. 어린 유망주는 같은 OVR의 베테랑보다 비쌀 수 있습니다. 가치가 높을수록 보통 주급도 높습니다.',
    ],
};

export type HubActions = {
    confirm: Confirm;
    /** Start the user's fixture today (play it in the match view). */
    playMatch: () => void;
    /** Resolve today's fixture instantly. */
    simMatch: () => void;
    endSeason: () => SeasonCeremony;
    exit: () => void;
    settings: () => void;
};

export const spriteFor = (club: CareerClub, p: Player) => (p.cls === 'keeper' ? club.keeperKit : `${club.kit}_player_${p.look ?? 1}`);

const ordinal = (n: number) => `${n}위`;

const crest = (cl: CareerClub) => html`<span class="crest" style="--kit:${kitColor(cl.kit)}">${cl.short}</span>`;

/** The day (seed:season:day) the level-up prompt last opened on its own: once a day is enough. */
let promptedOn = '';

export const Hub = (cfg: GameConfig, c: Career, actions: HubActions, modal: WritableGrain<HubNotice | null>) => {
    const version = grain(0);
    const tab = grain<Tab>('overview');
    const selected = grain<{ id: string; from: 'squad' | 'market' } | null>(null);
    const flash = grain<string | null>(null);
    const leagueTier = grain<number>(userClub(c).tier);
    const leagueNation = grain<NationId>(c.nation);
    const planDay = grain<number | null>(null);
    const marketFilter = grain<ClassId | 'all'>('all');
    const marketNation = grain<NationId | 'all'>('all');
    const marketSource = grain<'all' | 'free' | 'listed'>('all');
    const slotPick = grain<number | null>(null);
    const letterOpen = grain(false);
    const groundOpen = grain(false);
    const ceremony = grain<SeasonCeremony | null>(null);
    /** The level-up prompt: open for a given player, or for whoever is next in line (id null). */
    const levelUp = grain<{ id: string | null } | null>(null);

    const read = <T>(value: () => T) => derived(version, value);
    const modelRegion = (view: () => Fragment) => $render(read(view));
    let toastTimer: ReturnType<typeof setTimeout>;
    const clearToast = mounted(() => {
        // back from a match (or a fresh load): anyone ready to level up gets the prompt
        const t = setTimeout(() => promptLevelUps(), 400);
        return () => {
            clearTimeout(t);
            clearTimeout(toastTimer);
        };
    });

    const changed = () => {
        saveCareer(c);
        version.update((v) => v + 1);
    };
    const toast = (msg: string | null) => {
        if (!msg) return;
        flash.set(msg);
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => flash.set(null), 2600);
    };

    const u = () => userClub(c);
    /** A player with a level to spend, or a perk tier still to choose from. */
    const isReady = (p: Player) => levelsReady(cfg, p) > 0 || pendingPerks(cfg, p).length > 0;
    /** Open the level-up prompt once a day when someone is ready (after training, back from a match). */
    const promptLevelUps = () => {
        const key = `${c.seed}:${c.season}:${c.day}`;
        if (promptedOn === key || !u().squad.some(isReady)) return;
        promptedOn = key;
        levelUp.set({ id: null });
    };
    const club = (id: string) => c.clubs[id]!;
    const clubResult = (f: Fixture) => {
        if (!f.result) return null;
        const isHome = f.home === c.userClubId;
        const [gf, ga] = isHome ? f.result : [f.result[1], f.result[0]];
        const winner = isCupFixture(f) ? cupWinner(f) : undefined;
        const outcome = winner ? (winner === c.userClubId ? 'win' : 'loss') : gf > ga ? 'win' : gf < ga ? 'loss' : 'draw';
        return { gf, ga, outcome, pens: penaltyScore(f, isHome ? 0 : 1) };
    };
    const portrait = (cl: CareerClub, p: Player, size = 40) => {
        const style = derived(recolorVersion, () => portraitStyle(cl, p, size));
        return html`<span class="portrait-s" style="width:${size}px;height:${size}px"><span class="sprite still" ${attr({ style })}></span></span>`;
    };
    /** Crop the sprite to head & shoulders: draw it larger than the frame and shift it up-left. */
    const portraitStyle = (cl: CareerClub, p: Player, size: number) => {
        const big = Math.round(size * 1.9);
        const frames = cfg.animFrames.idle ?? 12;
        return `${spriteStyle(cfg, spriteFor(cl, p), 'idle', 'down', p)};width:${big}px;height:${big}px;background-size:${frames * big}px ${big}px;left:${Math.round((size - big) / 2)}px;top:${Math.round(-big * 0.14)}px`;
    };
    const stars = (p: Player) => {
        const rating = potentialStars(cfg, p);
        const label = `잠재력 5점 만점에 ${rating}점 · 레벨업당 성장폭`;
        return html`<span class="stars" role="img" aria-label="${label}" title="${label}">${'★'.repeat(rating)}<i>${'★'.repeat(5 - rating)}</i></span>`;
    };

    // ------------------------------------------------------------ top bar
    const todayInfo = () => {
        if (story(c).inbox) return { label: '편지가 도착했습니다', sub: '진행하기 전에 읽어 보세요', kind: 'letter' as const };
        const t = today(cfg, c);
        if (t.kind === 'seasonEnd') return { label: '시즌 종료', sub: '승격, 강등, 시상', kind: t.kind };
        if (t.kind === 'match') {
            const f = t.fixture;
            const opp = club(f.home === u().id ? f.away : f.home);
            const label = t.cup ? `${cupOf(c, t.cup).name} · ${t.cup.label}` : `${t.round + 1}라운드`;
            return { label, sub: `${f.home === u().id ? 'vs' : '@'} ${opp.name}`, kind: t.kind };
        }
        return {
            label: t.cup ? `${cupOf(c, t.cup).name} 당일 · 훈련` : '훈련일',
            sub: drillsLabel(c.drills),
            kind: t.kind,
        };
    };

    const continueDay = () => {
        if (story(c).inbox) {
            letterOpen.set(true);
            return;
        }
        const t = today(cfg, c);
        if (t.kind === 'match') {
            validLineup(cfg, u());
            preview.set(true);
            return;
        }
        if (t.kind === 'training') {
            const report = trainingDay(cfg, c);
            if (!report) return;
            changed();
            toast([report.summary, ...report.updates.slice(0, 3)].join(' '));
            promptLevelUps();
            return;
        }
        const result = actions.endSeason();
        changed();
        audio.play(result.champion || result.promoted ? 'goal' : 'whistleEnd');
        ceremony.set(result);
    };
    const preview = grain(false);

    const todayAction = read(todayInfo);
    const topbar = html`<header class="hub-top">
        <div class="when"><b>${read(() => String(c.season))}시즌</b><span>${read(() => {
            const days = seasonDays(cfg, c);
            return c.day > days ? '시즌 리뷰' : `${days}일 중 ${c.day}일차`;
        })}</span></div>
        ${RadioPlayer()}
        <button class="primary go" ${on('click', continueDay)}><span><b>${derived(todayAction, (t) => t.label)}</b><small>${derived(todayAction, (t) => t.sub)}</small></span><i>→</i></button>
    </header>`;

    // ------------------------------------------------------------ overview
    const nextUp = () => {
        const t = today(cfg, c);
        if (t.kind === 'match') {
            const f = t.fixture;
            const h = club(f.home);
            const a = club(f.away);
            const label = t.cup ? `${cupOf(c, t.cup).name} · ${t.cup.label}` : `${roundsPerSeason(c)}라운드 중 ${t.round + 1}라운드`;
            return html`<div class="card next">
                <h3>다음 경기 · ${label}</h3>
                <div class="vs">${crest(h)}<b>${h.name}</b><span>vs</span><b>${a.name}</b>${crest(a)}</div>
                <p class="muted">팀 전력 ${squadOvr(cfg, h).toFixed(0)} vs ${squadOvr(cfg, a).toFixed(0)}</p>
            </div>`;
        }
        if (t.kind === 'training') {
            const next = seasonSchedule(cfg, c).find((date) => date.day > c.day && scheduledFixture(c, date));
            const note = t.cup ? `오늘은 ${cupOf(c, t.cup).name} ${t.cup.label}입니다. 선수단은 훈련합니다.` : '';
            return html`<div class="card next"><h3>훈련일 · ${drillsLabel(c.drills)}</h3>
                ${note ? html`<p>${note}</p>` : html``}
                <p>${next ? `다음 경기는 ${next.day}일차입니다.` : '마지막 훈련일 뒤에 시즌 리뷰가 이어집니다.'}</p>
                <button class="ghost" ${on('click', () => tab.set('training'))}>훈련 보기</button>
            </div>`;
        }
        return html`<div class="card next"><h3>시즌 종료</h3><p>계속해서 승격, 강등, 시즌 보너스를 정산하세요.</p></div>`;
    };

    const miniTable = () => {
        const d = divisionOf(c, u().id);
        const rows = table(d);
        return html`<div class="card"><h3>${leagueName(c.nation, d.tier)}</h3>${leagueTable(rows, d.tier, true)}</div>`;
    };

    const alerts = () => {
        const cl = u();
        const injured = cl.squad.filter((p) => p.injury);
        const items: Fragment[] = [];
        if (injured.length)
            items.push(
                html`<li class="bad">부상 ${String(injured.length)}명: ${injured.map((p) => `${p.name} (${p.injury}일)`).join(', ')}</li>`,
            );
        const ready = cl.squad.filter(isReady);
        if (ready.length)
            items.push(
                html`<li class="good lvl-alert">▲ 레벨업 가능 ${String(ready.length)}명: ${ready.map((p) => p.name).join(', ')} <button class="ghost" ${on('click', () => levelUp.set({ id: null }))}>선택</button></li>`,
            );
        if (cl.budget < 0) items.push(html`<li class="bad">적자 상태입니다. 선수를 팔거나 경기에서 이겨 보세요.</li>`);
        if (cl.squad.length < cfg.career.squadMin + 1)
            items.push(html`<li class="bad">선수층이 얇습니다(${String(cl.squad.length)}명). 이적 시장을 확인하세요.</li>`);
        if (!items.length) items.push(html`<li class="good">이상 없음. 선수단 컨디션이 좋습니다.</li>`);
        return items;
    };

    /** The squad at a glance: morale (meter, match edge, form) above the things that need attention. */
    const squadCard = () => {
        const s = story(c);
        const m = s.morale;
        const tone = m >= 70 ? 'hi' : m >= 55 ? 'ok' : m >= 40 ? 'meh' : 'lo';
        const edge = Math.round(((m - 60) / 400) * 100);
        const lit = Math.round(m / 10);
        const cells = Array.from(
            { length: 10 },
            (_, i) => html`<i class="${i < lit ? `on m-${i < 2 ? 'lo' : i < 4 ? 'meh' : i < 6 ? 'ok' : 'hi'}` : ''}"></i>`,
        );
        const div = divisionOf(c, u().id);
        const form = div.fixtures
            .filter((x) => x.result && (x.home === u().id || x.away === u().id))
            .slice(-5)
            .map((x) => {
                const [gh, ga] = x.result!;
                const [f, ag] = x.home === u().id ? [gh, ga] : [ga, gh];
                return f > ag ? 'W' : f === ag ? 'D' : 'L';
            });
        const run =
            s.streak >= 2
                ? `${String(s.streak)}연승`
                : (s.lossRun ?? 0) >= 2
                  ? `${String(s.lossRun)}연패`
                  : s.streak <= -2
                    ? `${String(-s.streak)}경기 무승`
                    : '';
        const drift = m > 62 ? '훈련일마다 가라앉습니다.' : m < 58 ? '훈련일마다 조금씩 회복됩니다.' : '안정적입니다.';
        const edgeText = `${edge > 0 ? '+' : ''}${String(edge)}%`;
        return html`<div class="card squad-status m-${tone}">
            <h3>선수단 상태</h3>
            <dl class="ss-rows">
                <dt>사기</dt>
                <dd><span class="morale-meter" title="사기 ${String(m)}/100">${cells}<span class="mid"></span></span><span class="ss-mood">${moraleLabel(m)} · ${String(m)}</span></dd>
                <dt>경기 보정</dt>
                <dd title="사기는 모든 경기에서 슛 정확도, 태클, 인터셉트에 영향을 줍니다">${edgeText} <span class="muted">슛·태클·인터셉트</span></dd>
                <dt>최근 폼</dt>
                <dd><span class="form">${form.length ? form.map((r) => html`<i class="r${r}">${r === 'W' ? '승' : r === 'D' ? '무' : '패'}</i>`) : '–'}</span> <span class="muted">${run || drift}</span></dd>
            </dl>
            <ul class="ss-alerts">${alerts()}</ul>
        </div>`;
    };

    const NewsFeed = () => html`<div class="card news fill"><h3>뉴스</h3><ul class="scroll">
        ${$each(read(() => c.news.slice(0, 14))).$as((n) => html`<li class="${n.tone}"><b>${String(n.season)}시즌 ${String(n.day)}일</b> ${n.text}</li>`)}
    </ul></div>`;

    const questsCard = () => {
        const qs = story(c).quests;
        if (!qs.length) return html``;
        const fee = cfg.career.matchFee[u().tier]!;
        return html`<div class="card quests"><h3>시즌 퀘스트 <small>보너스 자금과 사기</small></h3>
            <ul>${qs.map(
                (q) => html`<li class="${q.done ? 'done' : ''}">
                <div><b>${q.done ? '✓ ' : ''}${q.title}</b><span>${q.desc}</span></div>
                <div class="qprog"><span class="xpbar"><i style="width:${String((q.progress / q.target) * 100)}%"></i></span><small>${String(q.progress)}/${String(q.target)}</small></div>
                <em>${money(Math.round(fee * q.reward))}</em>
            </li>`,
            )}</ul></div>`;
    };

    const Overview = () => html`<div class="grid-2">
        <div class="col">${modelRegion(nextUp)}${modelRegion(squadCard)}${modelRegion(questsCard)}${NewsFeed()}</div>
        <div class="col">${modelRegion(miniTable)}${modelRegion(xiCard)}${modelRegion(historyCard)}</div>
    </div>`;

    const xiCard = () => {
        const cl = u();
        validLineup(cfg, cl);
        const players = cl.lineup.map((id) => cl.squad.find((p) => p.id === id)!).filter(Boolean);
        return html`<div class="card fill"><h3>선발 11명 <small>${cl.formationId} · 전력 ${squadOvr(cfg, cl).toFixed(0)}</small></h3>
            <ul class="xi scroll">${players.map((p) => html`<li ${on('click', () => selected.set({ id: p.id, from: 'squad' }))}>${portrait(cl, p, 26)}<span>${p.name}</span>${p.injury ? html`<em class="inj">✚ ${String(p.injury)}d</em>` : html``}<em>${classLabel(cfg, p)} · ${String(ovr(cfg, p))}</em></li>`)}</ul></div>`;
    };

    const historyCard = () =>
        html`<div class="card"><h3>클럽 역사</h3>${
            c.history.length
                ? html`<ul class="hist">${c.history.map((h) => html`<li>${String(h.season)}시즌: ${leagueName(c.nation, h.tier)} ${ordinal(h.position)}</li>`)}
            ${story(c)
                .awards.slice(-4)
                .map((a) => html`<li class="award">★ ${String(a.season)}시즌 ${a.title}: ${a.who}</li>`)}</ul>`
                : html`<p class="muted">첫 시즌입니다. 상위 ${String(cfg.career.promote)}팀은 승격, 하위 ${String(cfg.career.relegate)}팀은 강등됩니다.</p>`
        }</div>`;

    // ------------------------------------------------------------ season plan
    const calendar = read(() => {
        const lastDay = seasonDays(cfg, c) + 1;
        const rival = rivalOf(c);
        const inbox = story(c).inbox;
        const dates = new Map(seasonSchedule(cfg, c).map((date) => [date.day, date]));
        const news = c.news.filter((item) => item.season === c.season);
        const days = Array.from({ length: lastDay }, (_, i) => {
            const day = i + 1;
            const date = dates.get(day);
            const fixture = date && scheduledFixture(c, date);
            const home = fixture?.home === c.userClubId;
            const opponent = fixture ? club(home ? fixture.away : fixture.home) : null;
            const result = fixture && clubResult(fixture);
            const cup = date?.cup;
            const kind = cup ? 'cup' : fixture ? 'match' : day === lastDay ? 'review' : 'training';
            return {
                day,
                kind,
                trains: kind === 'training' || (!!cup?.fixtures.length && !fixture),
                title: cup
                    ? `${cupOf(c, cup).name} · ${cup.label}`
                    : fixture
                      ? `${fixture.round + 1}라운드`
                      : kind === 'review'
                        ? '시즌 리뷰'
                        : '훈련',
                match: opponent ? `${home ? 'vs' : '@'} ${opponent.name}` : '',
                cupNote:
                    cup && !fixture
                        ? !cup.fixtures.length
                            ? '추첨 대기'
                            : cup.byes.includes(u().id)
                              ? '부전승 · 선수단 훈련'
                              : '선수단 훈련'
                        : '',
                derby: !!opponent && opponent.id === rival?.id,
                score: result ? `${result.gf}–${result.ga} ${result.outcome}${result.pens ? ` (${result.pens})` : ''}` : '',
                tone: result?.outcome === 'win' ? 'pos' : result?.outcome === 'loss' ? 'neg' : '',
                letter: day === (inbox?.trainingDay ?? c.day) ? inbox : null,
                news: news.filter((item) => item.day === day),
            };
        });
        return { days, rival, season: c.season, today: c.day };
    });
    const SeasonPlan = () => {
        const selectedDay = derived(combined([planDay, calendar]), ([day, cal]) => Math.min(day ?? cal.today, cal.days.length));
        const pageSize = 30;
        const page = derived(selectedDay, (day) => Math.floor((day - 1) / pageSize));
        const visibleDays = derived(combined([page, calendar]), ([index, cal]) =>
            cal.days.slice(index * pageSize, (index + 1) * pageSize).map((day) => day.day),
        );
        const pages = derived(calendar, (cal) => Array.from({ length: Math.ceil(cal.days.length / pageSize) }, (_, i) => i));
        const details = derived(combined([selectedDay, calendar]), ([day, cal]) => {
            const item = cal.days[day - 1]!;
            const { title, match, score, tone, letter } = item;
            return html`<section class="season-day-details" aria-live="polite">
                <h4>${String(day)}일차 · ${title}${item.derby ? ' · 더비' : ''}</h4>
                ${match ? html`<p>${match}${score ? html` <strong class="${tone}">${score}</strong>` : html``}</p>` : html``}
                ${item.cupNote ? html`<p>${item.cupNote}</p>` : html``}
                ${item.kind === 'cup' ? html`<p><button class="ghost" ${on('click', () => tab.set('cup'))}>컵 대회 보기</button></p>` : html``}
                ${item.kind === 'review' ? html`<p>승격, 강등, 시상</p>` : html``}
                ${item.trains && day === cal.today ? html`<p>드릴 · ${drillsLabel(c.drills)}</p>` : html``}
                ${item.trains && day < cal.today && !item.news.length ? html`<p class="muted">훈련 완료</p>` : html``}
                ${letter ? html`<p><button class="ghost" ${on('click', () => letterOpen.set(true))}>편지 읽기</button> ${letter.title} · ${letter.from}</p>` : html``}
                ${item.news.length ? html`<ul class="alerts">${item.news.map((event) => html`<li class="${event.tone}">${event.text}</li>`)}</ul>` : html``}
            </section>`;
        });
        return html`<div class="card fill season-calendar">
            <h3>${derived(calendar, (info) => String(info.season))}시즌 일정 <small ${attr({ hidden: derived(calendar, (info) => !info.rival) })}>${derived(calendar, (info) => (info.rival ? `라이벌 · ${info.rival.name}` : ''))}</small></h3>
            <div class="seg" role="group" aria-label="일정 날짜">
                ${$each(pages)
                    .$withKey((index) => index)
                    .$as((index) => {
                        const active = derived(page, (i) => i === index);
                        const first = index * pageSize + 1;
                        const last = derived(calendar, (cal) => Math.min(first + pageSize - 1, cal.days.length));
                        return html`<button ${attr({ class: derived(active, (value) => (value ? 'on' : '')), 'aria-pressed': derived(active, String) })}
                        ${on('click', () => planDay.set(c.day >= first && c.day <= last() ? null : first))}>${String(first)}–${derived(last, String)}일</button>`;
                    })}
                <button ${on('click', () => planDay.set(null))}>오늘</button>
            </div>
            <div class="calendar-layout">
                <div class="scroll"><div class="season-calendar-grid" aria-label="시즌 일정">
                    ${$each(visibleDays)
                        .$withKey((day) => day)
                        .$as((day) => {
                            const entry = derived(calendar, (info) => info.days[day - 1]!);
                            const current = derived(calendar, (info) => day === info.today);
                            const content = derived(
                                entry,
                                ({ title, match, cupNote, score, tone, derby, letter, news }) => html`
                            <b>${title}${derby ? ' · 더비' : ''}</b>
                            ${match || cupNote ? html`<span class="season-opponent">${match || cupNote}</span>` : html``}
                            ${score ? html`<strong class="${tone}">${score}</strong>` : html``}
                            ${letter ? html`<small class="season-event">✉ ${letter.title}</small>` : html``}
                            ${news.length ? html`<small class="season-event">${news.length === 1 ? news[0]!.text : `${news.length} club updates`}</small>` : html``}
                        `,
                            );
                            return html`<button type="button" ${attr({
                                class: derived(calendar, (info) => `season-day ${day < info.today ? 'past' : ''}`),
                                'data-kind': derived(entry, (item) => item?.kind),
                                'aria-pressed': derived(selectedDay, (date) => String(date === day)),
                                'aria-current': derived(current, (isToday) => (isToday ? 'date' : undefined)),
                            })} ${on('click', () => planDay.set(day))}>
                            <span class="season-day-heading">${String(day)}일${$if(current).$then(() => html`<small>오늘</small>`)}</span>
                            ${$render(content)}
                        </button>`;
                        })}
                </div></div>
                <div class="scroll">${$render(details)}</div>
            </div>
        </div>`;
    };

    // ------------------------------------------------------------ league
    const leagueTable = (
        rows: ReturnType<typeof table>,
        tier: number,
        compact = false,
    ) => html`<table class="tbl league ${tier === 0 ? 'top-flight' : ''}">
        <thead><tr><th>#</th><th>클럽</th><th>경기</th>${compact ? html`` : html`<th>승</th><th>무</th><th>패</th><th>득점</th><th>실점</th>`}<th>득실</th><th>승점</th></tr></thead>
        <tbody>${rows.map((r, i) => {
            const cl = club(r.club);
            const zone =
                tier === 0 && i < cfg.career.intlPerNation
                    ? 'intl'
                    : tier > 0 && i < cfg.career.promote
                      ? 'up'
                      : tier < cfg.career.divisions - 1 && i >= rows.length - cfg.career.relegate
                        ? 'down'
                        : '';
            return html`<tr class="${zone} ${r.club === u().id ? 'me' : ''}">
                <td>${String(i + 1)}</td><td class="club">${crest(cl)}${cl.name}</td><td>${String(r.p)}</td>
                ${compact ? html`` : html`<td>${String(r.w)}</td><td>${String(r.d)}</td><td>${String(r.l)}</td><td>${String(r.gf)}</td><td>${String(r.ga)}</td>`}
                <td>${String(r.gf - r.ga)}</td><td><b>${String(r.pts)}</b></td></tr>`;
        })}</tbody></table>`;

    /** The division's top scorers this season (played, simulated and invented alike). */
    const goldenBoot = (d: (typeof c.divisions)[number]) => {
        const st = story(c).seasonStats;
        const rows = d.clubs
            .flatMap((id) => club(id).squad.map((p) => ({ p, cl: club(id), l: st[p.id] })))
            .filter((x) => x.l && x.l.goals > 0)
            .sort((a, b) => b.l!.goals - a.l!.goals || b.l!.assists - a.l!.assists)
            .slice(0, 8);
        return html`<div class="card fill boot"><h3>득점왕 <small>득점 순위</small></h3>${
            rows.length
                ? html`<ol class="scroll">${rows.map((x, i) => html`<li class="${x.cl.id === u().id ? 'me' : ''}"><span class="pos">${String(i + 1)}</span>${portrait(x.cl, x.p, 24)}<b>${x.p.name}</b>${crest(x.cl)}<em>${String(x.l!.goals)}골 · ${String(x.l!.assists)}도움</em></li>`)}</ol>`
                : html`<p class="muted">이번 시즌 아직 득점이 없습니다.</p>`
        }</div>`;
    };

    const League = () => {
        const pyramid = (n: NationId) => (n === c.nation ? c.divisions : (c.world[n] ?? c.divisions));
        const entries = derived(combined([leagueNation, leagueTier, version]), ([n, tier]) => {
            const d = pyramid(n)[tier] ?? pyramid(n)[0]!;
            const home = n === c.nation;
            const rounds = Array.from({ length: roundsPerSeason(c) }, (_, r) => d.fixtures.filter((f) => f.round === r));
            return html`            <div class="grid-2 wide-left">
                <div class="col"><div class="card"><h3>${flag(n)} ${NATIONS[n].name} · ${leagueName(n, d.tier)}</h3>${leagueTable(table(d), d.tier)}<p class="muted legend-line">${d.tier === 0 ? html`<i class="intl"></i>${INTL_CUP_NAME} ` : html``}<i class="up"></i>승격 <i class="down"></i>강등</p></div>${home ? goldenBoot(d) : html``}</div>
                <div class="card fixtures fill"><h3>경기 일정</h3><div class="scroll">${rounds.map(
                    (fs, r) =>
                        html`<div class="round"><h4>${String(r + 1)}라운드</h4>${fs.map(
                            (f) => html`<div class="fx ${f.home === u().id || f.away === u().id ? 'me' : ''}">
                    <span>${club(f.home).name}</span><b>${f.result ? `${f.result[0]} – ${f.result[1]}` : 'v'}</b><span>${club(f.away).name}</span></div>`,
                        )}</div>`,
                )}</div></div>
            </div>`;
        });
        const nationButton = (n: NationId) => {
            const active = derived(leagueNation, (cur) => cur === n);
            return html`<button title="${NATIONS[n].name}" ${attr({ class: derived(active, (isActive) => `nation-filter${isActive ? ' on' : ''}`), 'aria-pressed': derived(active, String) })} ${on('click', () => leagueNation.set(n))}>${flag(n)}</button>`;
        };
        return html`<div class="stack">
            <div class="seg nation-seg">${[c.nation, ...NATION_IDS.filter((n) => n !== c.nation)].map(nationButton)}</div>
            <div class="seg">${c.divisions.map((division) => {
                const active = derived(leagueTier, (tier) => tier === division.tier);
                return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => leagueTier.set(division.tier))}>${derived(leagueNation, (n) => leagueName(n, division.tier))}${derived(combined([leagueNation, version]), ([n]) => (n === c.nation && division.tier === u().tier ? ' ★' : ''))}</button>`;
            })}</div>
            ${$render(entries)}
        </div>`;
    };

    const Cup = () => {
        const selectedRound = grain<number | null>(null);
        const which = grain<'cup' | 'intl'>('cup');
        const info = derived(combined([which, version]), ([key]) => (key === 'intl' ? c.intl : c.cup));
        const rounds = derived(info, (cup) => cup?.rounds ?? []);
        const activeRound = derived(combined([selectedRound, rounds]), ([picked, dates]) => {
            const scheduled = dates.findIndex((date) => date.day >= c.day);
            return picked ?? (scheduled < 0 ? dates.length - 1 : scheduled);
        });
        const roundView = derived(combined([activeRound, rounds]), ([index, dates]) => {
            const round = dates[index];
            if (!round)
                return html`<p class="muted">${which() === 'intl' ? `이번 시즌에는 ${josa(INTL_CUP_NAME,'이')} 없습니다.` : '컵 대회는 다음 시즌에 시작합니다.'}</p>`;
            return html`<h4>${round.label} · ${String(round.day)}일차</h4>
                ${
                    round.fixtures.length
                        ? html`<table class="tbl cup-fixtures">
                    <thead><tr><th>홈</th><th>결과</th><th>원정</th></tr></thead>
                    <tbody>${round.fixtures.map((fixture) => {
                        const home = club(fixture.home);
                        const away = club(fixture.away);
                        const winner = cupWinner(fixture);
                        const where = (cl: CareerClub) =>
                            which() === 'intl' ? flag(cl.nation) : html`<small>${leagueShort(cl.nation, cl.tier)}</small>`;
                        return html`<tr class="${home.id === c.userClubId || away.id === c.userClubId ? 'me' : ''}">
                            <td class="${winner === home.id ? 'cup-winner' : ''}">${crest(home)} ${home.name} ${where(home)}</td>
                            <td>${fixture.result ? `${fixture.result[0]}–${fixture.result[1]}` : 'vs'} <small>${penaltyScore(fixture)}</small></td>
                            <td class="${winner === away.id ? 'cup-winner' : ''}">${crest(away)} ${away.name} ${where(away)}</td>
                        </tr>`;
                    })}</tbody>
                </table>`
                        : html`<p class="muted">추첨은 이전 라운드 뒤에 진행됩니다.</p>`
                }
                ${round.byes.length ? html`<h4>다음 라운드 부전승</h4><p>${round.byes.map((id) => club(id).name).join(' · ')}</p>` : html``}`;
        });
        return html`<div class="card fill">
            <div class="seg">${(['cup', 'intl'] as const).map((key) => {
                const active = derived(which, (cur) => cur === key);
                return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on(
                    'click',
                    () => {
                        which.set(key);
                        selectedRound.set(null);
                    },
                )}>${key === 'intl' ? INTL_CUP_NAME : CUP_NAME}</button>`;
            })}</div>
            <h3>${derived(which, (key) => (key === 'intl' ? INTL_CUP_NAME : CUP_NAME))} <small>${derived(info, (cup) =>
                cup?.champion
                    ? `${club(cup.champion).name} 우승`
                    : cup?.key === 'intl'
                      ? `단판 토너먼트 · 각 1부 리그 상위 ${cfg.career.intlPerNation}팀${cup.rounds.some((r) => r.fixtures.some((f) => f.home === c.userClubId || f.away === c.userClubId) || r.byes.includes(c.userClubId)) ? ' · 내 클럽 참가' : ''}`
                      : '단판 토너먼트 · 5개 디비전 전체',
            )}</small></h3>
            <div class="seg" role="group" aria-label="컵 라운드">
                ${$each(derived(rounds, (dates) => dates.map((_, i) => i)))
                    .$withKey((index) => index)
                    .$as((index) => {
                        const active = derived(activeRound, (value) => value === index);
                        return html`<button ${attr({ class: derived(active, (value) => (value ? 'on' : '')), 'aria-pressed': derived(active, String) })}
                        ${on('click', () => selectedRound.set(index))}>${derived(rounds, (dates) => dates[index]?.label ?? '')}</button>`;
                    })}
            </div>
            <div class="scroll">${$render(roundView)}</div>
        </div>`;
    };

    // ------------------------------------------------------------ squad
    const classChips = (p: Player) =>
        html`<span class="classes">${(Object.entries(p.levels) as Array<[ClassId, number]>).sort((a, b) => b[1] - a[1]).map(([cl, l]) => html`<span class="cls cls-${cl}">${cfg.classes[cl].short} ${String(l)}</span>`)}</span>`;

    const playerRow = (p: Player, extra: Fragment, from: 'squad' | 'market') => {
        const injury = read(() => p.injury);
        const injuryLabel = derived(injury, (days) => (days ? `✚ ${days}일` : ''));
        return html`<tr ${attr({ class: derived(injury, (days) => (days ? 'injured' : '')) })} ${on('click', () => selected.set({ id: p.id, from }))}>
            <td>${portrait(u(), p, 32)}</td>
            <td class="name">${flag(p.nation)}<b>${p.name}</b>${$if(read(() => from === 'squad' && isReady(p))).$then(() => html`<em class="lvl-badge" title="레벨업 가능">▲</em>`)}${$if(derived(injury, Boolean)).$then(() => html`<em class="inj">${injuryLabel}</em>`)}</td>
            <td>${modelRegion(() => classChips(p))}</td>
            <td class="num">${read(() => String(p.age))}</td>
            <td class="num"><b>${read(() => String(ovr(cfg, p)))}</b></td>
            <td>${modelRegion(() => stars(p))}</td>
            <td class="num">${read(() => String(abilitiesOf(cfg, p).length))}</td>
            ${extra}
        </tr>`;
    };

    const seasonCell = (p: Player) => {
        const l = seasonLine(c, p.id);
        return l && l.apps ? `${l.goals}·${l.assists}·${avgRating(l).toFixed(1)}` : '—';
    };

    const Squad = () => {
        const rows = read(() =>
            [...u().squad].sort((a, b) => CLASSES.indexOf(a.cls) - CLASSES.indexOf(b.cls) || ovr(cfg, b) - ovr(cfg, a)),
        );
        return html`<div class="card fill">
            <header class="squad-heading">
                <h3>스쿼드 <small>${read(() => String(u().squad.length))}명 · ${String(cfg.career.squadMin)}–${String(cfg.career.squadMax)}명 허용 · 선수를 누르면 상세 정보</small></h3>
                <button type="button" class="ghost" ${on('click', () => modal.set(PLAYER_DEVELOPMENT))}>선수 성장</button>
            </header>
            <div class="scroll"><table class="tbl players"><thead><tr><th></th><th>이름</th><th>포지션</th><th>나이</th><th>OVR</th><th>잠재력</th><th>능력</th><th>선발</th><th title="시즌 득점 / 도움 / 평균 평점">득·도·평점</th><th>가치</th><th>주급</th></tr></thead>
            <tbody>${$each(rows)
                .$withKey((p) => p.id)
                .$as((p) =>
                    playerRow(
                        p,
                        html`
                <td>${$if(read(() => u().lineup.includes(p.id))).$then(() => html`<span class="pill">선발</span>`)}</td>
                <td class="num">${read(() => seasonCell(p))}</td><td class="num">${read(() => money(playerValue(cfg, p)))}</td><td class="num">${read(() => money(wage(cfg, p)))}</td>`,
                        'squad',
                    ),
                )}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ player drawer
    const xpBar = (p: Player) => {
        const need = xpToNext(cfg, p);
        const have = Math.round(p.xp);
        return html`<span class="xpbar ${have >= need ? 'full' : ''}" title="다음 레벨까지 경험치 ${String(have)} / ${String(need)}"><i style="width:${Math.min(100, (have / need) * 100)}%"></i></span>`;
    };

    const drawer = derived(selected, (sel) => {
        if (!sel) return html``;
        const fromMarket = sel.from === 'market';
        const entry = fromMarket ? marketEntry(c, sel.id) : undefined;
        const p = fromMarket ? entry?.p : u().squad.find((q) => q.id === sel.id);
        if (!p) return html``;
        const cl = u();
        const owned = abilitiesOf(cfg, p);
        const classes = (Object.entries(p.levels) as Array<[ClassId, number]>).sort((a, b) => b[1] - a[1]);
        const ahead = classes.map(([k]) => nextPerkTier(cfg, p, k)).filter((t) => t !== null);
        const stat = (k: keyof Player['stats'], label: string) =>
            html`<div class="stat"><span>${label}</span><i style="--v:${String(Math.min(100, p.stats[k]))}%"></i><b>${String(p.stats[k])}</b></div>`;
        const feedback = grain('');
        const act = fromMarket
            ? html`<button class="primary" ${on('click', () => {
                  const err = buy(cfg, c, p.id);
                  if (err) {
                      feedback.set(err);
                      return;
                  }
                  selected.set(null);
                  toast(`${p.name} 영입 완료!`);
                  changed();
              })}>${money(marketPrice(cfg, entry!))}에 영입${entry!.club ? html` <small>${entry!.club.name} 소속</small>` : html` <small>자유 계약</small>`}</button>`
            : html`<button class="warn" ${on('click', async () => {
                  if (
                      !(await actions.confirm({
                          title: `${p.name} 선수를 판매할까요?`,
                          body: `원하는 클럽이 선수를 데려갑니다. 지불액: ${money(salePrice(cfg, p))}.`,
                          action: '선수 판매',
                      }))
                  )
                      return;
                  const err = sell(cfg, c, p.id);
                  if (err) {
                      feedback.set(err);
                      return;
                  }
                  selected.set(null);
                  toast(`${p.name} 판매 완료.`);
                  changed();
              })}>${money(salePrice(cfg, p))}에 판매</button>`;
        return Dialog({
            label: p.name,
            className: 'drawer-wrap',
            dismiss: () => selected.set(null),
            children: html`<aside class="drawer" style="--kit:${kitColor(cl.kit)}">
                <header>${portrait(cl, p, 64)}<div><h2>${p.name}</h2><p>${flag(p.nation)} ${nationOf(p.nation).adjective} · ${classLabel(cfg, p)} · ${String(p.age)}세 (전성기 약 ${String(p.peakAge)}세)</p></div><button class="ghost" ${on('click', () => selected.set(null))}>✕</button></header>
                <div class="kv">
                    <div><span>종합</span><b>${String(ovr(cfg, p))}</b></div>
                    <div><span>잠재력</span><b>${stars(p)}</b></div>
                    <div><span>재능</span><b>${p.talent.toFixed(2)}</b></div>
                    <div><span>가치</span><b>${money(playerValue(cfg, p))}</b></div>
                    <div><span>주급</span><b>${money(wage(cfg, p))}</b></div>
                    <div><span>상태</span><b>${p.injury ? `부상 ${p.injury}일` : '양호'}</b></div>
                    ${(() => {
                        const l = seasonLine(c, p.id);
                        return l && l.apps
                            ? html`<div class="wide"><span>이번 시즌</span><b>${String(l.apps)}경기 · ${String(l.goals)}골 · ${String(l.assists)}도움 · 평점 ${avgRating(l).toFixed(1)}${l.motm ? ` · MOM ${l.motm}회` : ''}</b></div>`
                            : html``;
                    })()}
                </div>
                <h4>포지션 레벨 <small>레벨 ${String(p.level)} · 경험치 ${String(Math.round(p.xp))} / ${String(xpToNext(cfg, p))}</small></h4>
                <div class="levels">${classes.map(([k, l]) => html`<div class="lvl"><span class="cls cls-${k}">${cfg.classes[k].label}</span><b>${String(l)}</b></div>`)}</div>
                <div class="lvl-xp">${xpBar(p)}${
                    !fromMarket && isReady(p)
                        ? html`<button class="primary" ${on('click', () => {
                              selected.set(null);
                              levelUp.set({ id: p.id });
                          })}>▲ 레벨업</button>`
                        : html``
                }</div>
                <h4>능력</h4>
                <div class="ab-list">${
                    owned.length
                        ? owned.map((id) => {
                              const a = abilityDef(cfg, id);
                              return html`<div class="ab"><span class="ic">${a.icon}</span><div><b>${a.label}</b><p>${a.desc}</p></div></div>`;
                          })
                        : html`<p class="muted">아직 없습니다. 특정 포지션 레벨에서 능력이나 패시브를 고를 수 있습니다.</p>`
                }
                    ${passivesOf(cfg, p).map((id) => html`<div class="ab passive"><span class="ic">◆</span><div><b>${cfg.passives[id].label}</b><p>${cfg.passives[id].desc}</p></div></div>`)}</div>
                ${
                    ahead.length
                        ? html`<h4>앞으로의 선택</h4><div class="ab-list">${ahead.map(
                              (t) =>
                                  html`<div class="ab locked"><span class="ic">◇</span><div><b>${cfg.classes[t.cls].short} ${String(t.level)} <em>(현재 ${String(classLevel(p, t.cls))})</em></b><p>${t.options.map((o) => perkDef(cfg, o).label).join(' 또는 ')}</p></div></div>`,
                          )}</div>`
                        : html``
                }
                <h4>능력치</h4>
                <div class="stats">${stat('speed', '속도')}${stat('pace', '주력')}${stat('passing', '패스')}${stat('shooting', '슈팅')}${stat('dribbling', '드리블')}${stat('tackling', '태클')}${stat('reflexes', '반사')}${stat('composure', '침착')}</div>
                <p class="neg" role="status" ${attr({ hidden: derived(feedback, (message) => !message) })}>${feedback}</p>
                <footer>${act}</footer>
            </aside>`,
        });
    });

    // ------------------------------------------------------------ tactics
    const Tactics = () => {
        const lineup = read(() => {
            const cl = u();
            validLineup(cfg, cl);
            const formation = cfg.formations.find((f) => f.id === cl.formationId) ?? cfg.formations[0]!;
            const slots = formation.slots.map((slot, i) => ({ slot, player: cl.squad.find((p) => p.id === cl.lineup[i]) }));
            return { formation, slots };
        });
        const slotEls = $each(derived(lineup, (team) => team.slots.map((_, i) => i)))
            .$withKey((i) => i)
            .$as((i) => {
                const entry = derived(lineup, (team) => team.slots[i]!);
                const fitClass = derived(entry, ({ player, slot }) =>
                    player ? (classLevel(player, slot.cls) > 0 ? 'fit' : 'misfit') : 'empty',
                );
                const cls = derived(combined([fitClass, slotPick]), ([fit, pick]) => `slot ${fit} ${pick === i ? 'on' : ''}`);
                const style = derived(entry, ({ slot }) => `left:${slot.x * 100 * 1.9 + 3}%;top:${slot.y * 84 + 8}%`);
                const slotPlayer = derived(entry, ({ player }) => player);
                return html`<button ${attr({ class: cls, style, 'aria-pressed': derived(slotPick, (pick) => String(pick === i)) })} ${on('click', () => slotPick.update((pick) => (pick === i ? null : i)))}>
                ${$render(derived(slotPlayer, (p) => (p ? portrait(u(), p, 36) : html``)))}
                <b>${derived(slotPlayer, (p) => p?.name.split(' ')[0] ?? '—')}</b><span>${derived(entry, ({ player, slot }) => `${cfg.classes[slot.cls].short}${player ? ` · ${ovr(cfg, player, slot.cls)}` : ''}`)}</span>
            </button>`;
            });
        const choose = (id: string) => {
            const pick = slotPick();
            if (pick === null) return;
            const cl = u();
            const current = cl.lineup.indexOf(id);
            if (current >= 0) cl.lineup[current] = cl.lineup[pick]!;
            cl.lineup[pick] = id;
            slotPick.set(null);
            changed();
        };
        const bench = derived(combined([slotPick, lineup]), ([pick, team]) => {
            const cl = u();
            const slot = pick === null ? undefined : team.slots[pick]?.slot;
            if (!slot)
                return html`<h3>후보</h3><ul class="bench">${cl.squad.filter((p) => !cl.lineup.includes(p.id)).map((p) => html`<li>${portrait(cl, p, 28)}<b>${p.name}</b>${classChips(p)}${p.injury ? html`<em class="inj">✚ ${String(p.injury)}d</em>` : html``}</li>`)}</ul>`;
            const candidates = [...cl.squad].sort((a, b) => fitFor(cfg, b, slot.cls) - fitFor(cfg, a, slot.cls));
            return html`<h3>${cfg.classes[slot.cls].label} 선택</h3><ul class="bench pickable">${candidates.map((p) => html`<li class="${p.injury ? 'injured' : ''}" ${on('click', () => choose(p.id))}>${portrait(cl, p, 28)}<b>${p.name}</b>${classChips(p)}<span class="num">${String(ovr(cfg, p, slot.cls))}</span>${cl.lineup.includes(p.id) ? html`<span class="pill">선발</span>` : html``}</li>`)}</ul>`;
        });
        return html`<div class="grid-2 wide-left">
            <div class="card fill">
                <h3>포메이션 <small>포지션을 누른 뒤 선수를 고르세요 · 자리가 맞지 않는 선수는 해당 포지션 능력치로 뛰지만 능력은 쓰지 못합니다</small></h3>
                <div class="seg">${cfg.formations.map((f) => {
                    const active = derived(lineup, (team) => team.formation.id === f.id);
                    return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on(
                        'click',
                        () => {
                            const cl = u();
                            cl.formationId = f.id;
                            cl.lineup = autoLineup(cfg, cl);
                            changed();
                        },
                    )}>${f.label}</button>`;
                })}
                    <button class="ghost" ${on('click', () => {
                        const cl = u();
                        cl.lineup = autoLineup(cfg, cl);
                        changed();
                        toast('최적의 선발 11명을 골랐습니다.');
                    })}>선발 자동 선택</button></div>
                <p class="formation-note">${derived(lineup, (team) => team.formation.note)}</p>
                <div class="board">${slotEls}<div class="half"></div><div class="box"></div></div>
            </div>
            <div class="card fill">${$render(bench)}</div>
        </div>`;
    };

    // ------------------------------------------------------------ training
    const Training = () => {
        const drills = read(() => c.drills);
        const rows = read(() => [...u().squad].sort((a, b) => ovr(cfg, b) - ovr(cfg, a)));
        const drillButtons = DRILL_IDS.map((id) => {
            const active = derived(drills, (d) => d.includes(id));
            return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })}
                ${on('click', () => {
                    if (c.drills.includes(id)) return;
                    c.drills = pickDrill(c.drills, id);
                    changed();
                })}>
                <b>${DRILLS[id].label}</b><small>${DRILLS[id].note}</small>
                <span class="drill-cls">${drillClasses(cfg, id).map((cls) => html`<i>${cfg.classes[cls].short}</i>`)}</span>
            </button>`;
        });
        const fitDots = (fit: number) => [0, 1].map((i) => (fit >= i + 1 ? '●' : fit > i ? '◐' : '○')).join('');
        const row = (p: Player) => {
            const gain = read(() => trainingGain(cfg, p, c.drills));
            const injury = read(() => (p.injury ? `✚ ${p.injury}일` : ''));
            const progress = read(() =>
                isReady(p)
                    ? html`<button class="lvl-ready" ${on('click', (e) => {
                          e.stopPropagation(); // the level-up prompt, not the player panel
                          levelUp.set({ id: p.id });
                      })}>▲ 레벨업</button>`
                    : html`<span class="prog">Lv${String(p.level)} ${xpBar(p)}</span>`,
            );
            const nextUnlock = read(() => {
                const t = nextPerkTier(cfg, p, p.cls);
                return t ? `${cfg.classes[t.cls].short} ${t.level}: ${t.options.map((o) => perkDef(cfg, o).label).join(' 또는 ')}` : '';
            });
            // a click opens the same player panel as the squad list
            return html`<tr ${attr({ class: read(() => (p.injury ? 'injured' : '')) })} ${on('click', () => selected.set({ id: p.id, from: 'squad' }))}>
                <td>${portrait(u(), p, 28)}</td>
                <td class="name">${flag(p.nation)}<b>${p.name}</b>${$if(derived(injury, Boolean)).$then(() => html`<em class="inj">${injury}</em>`)}</td>
                <td>${modelRegion(() => classChips(p))}</td>
                <td>${modelRegion(() => stars(p))}</td>
                <td><span class="fit" ${attr({ title: derived(gain, (r) => (r ? `드릴 2개 중 ${String(r.fit)}개 적합` : '')) })}>${derived(gain, (r) => (r ? fitDots(r.fit) : ''))}</span></td>
                <td><span ${attr({ class: derived(gain, (result) => (result ? 'training-xp' : 'muted')) })}>${derived(gain, (result) =>
                    result ? `+${result.amount} XP` : '회복 중',
                )}</span></td>
                <td>${$render(progress)}</td>
                <td><span class="muted">${nextUnlock}</span></td>
            </tr>`;
        };

        return html`<div class="card fill">
            <h3>선수단 훈련 <small>훈련일마다 드릴 두 가지를 고르세요</small></h3>
            <div class="training-focus" role="group" aria-label="드릴">${drillButtons}</div>
            <p class="muted training-note">각 포지션은 세 가지 능력치를 가장 잘 훈련합니다. 오늘의 드릴이 포지션에 맞을수록 경험치를 더 많이 얻고(●● 강함, ●○ 보통, ○○ 포지션 외), 드릴로 해당 능력치가 1 오를 수 있습니다. 레벨업 시 올릴 포지션은 직접 고릅니다. 부상 선수는 회복합니다.</p>
            <div class="scroll"><table class="tbl training"><thead><tr><th></th><th>선수</th><th>포지션</th><th>잠재력</th><th>적합도</th><th>훈련 경험치</th><th>다음 레벨</th><th>다음 선택</th></tr></thead>
            <tbody>${$each(rows)
                .$withKey((p) => p.id)
                .$as(row)}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ market
    const Market = () => {
        const list = derived(combined([marketFilter, marketNation, marketSource, version]), ([filter, from, source]) =>
            marketEntries(c)
                .filter(
                    (e) =>
                        (filter === 'all' || e.p.cls === filter) &&
                        (from === 'all' || nationOf(e.p.nation).id === from) &&
                        (source === 'all' || (source === 'free') === !e.club),
                )
                .sort((a, b) => ovr(cfg, b.p) - ovr(cfg, a.p)),
        );
        const sourceButton = (k: 'all' | 'free' | 'listed', label: string) => {
            const active = derived(marketSource, (cur) => cur === k);
            return html`<button ${attr({ class: derived(active, (isOn) => (isOn ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => marketSource.set(k))}>${label}</button>`;
        };
        const nationButton = (k: NationId | 'all') => {
            const active = derived(marketNation, (cur) => cur === k);
            return html`<button title="${k === 'all' ? '모든 국가' : NATIONS[k].name}" ${attr({ class: derived(active, (isOn) => `nation-filter${isOn ? ' on' : ''}`), 'aria-pressed': derived(active, String) })} ${on('click', () => marketNation.set(k))}>${k === 'all' ? '전체' : flag(k)}</button>`;
        };
        return html`<div class="card fill">
            <h3>이적 시장 <small>${read(() => `자유 계약 ${c.market.length}명 · 클럽 이적 명단 ${c.listed.length}명`)} · 예산 ${read(() => money(u().budget))}</small></h3>
            <div class="seg">${sourceButton('all', '전체')}${sourceButton('listed', '이적 명단')}${sourceButton('free', '자유 계약')}</div>
            <div class="seg">${(['all', ...CLASSES] as const).map((k) => {
                const active = derived(marketFilter, (filter) => filter === k);
                return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => marketFilter.set(k))}>${k === 'all' ? '전체' : cfg.classes[k].label}</button>`;
            })}</div>
            <div class="seg nation-seg">${(['all', ...NATION_IDS] as const).map(nationButton)}</div>
            <div class="scroll"><table class="tbl players"><thead><tr><th></th><th>이름</th><th>포지션</th><th>나이</th><th>OVR</th><th>잠재력</th><th>능력</th><th>소속</th><th>가격</th><th>주급</th></tr></thead>
            <tbody>${$each(list)
                .$withKey((e) => e.p.id)
                .$as((e) =>
                    playerRow(
                        e.p,
                        html`<td class="at">${e.club ? html`${crest(e.club)} <span>${e.club.name}</span>` : html`<span class="muted">자유 계약</span>`}</td><td ${attr({ class: read(() => (marketPrice(cfg, e) > u().budget ? 'num neg' : 'num')) })}>${read(() => money(marketPrice(cfg, e)))}</td><td class="num">${read(() => money(wage(cfg, e.p)))}</td>`,
                        'market',
                    ),
                )}</tbody></table></div>
        </div>`;
    };

    // ------------------------------------------------------------ finances
    /** The manager's ground: what it is, what it brings in, edit its look, build the next size. */
    const groundCard = () => {
        const cl = u();
        const st = stadiumOf(c, cl);
        const fee = cfg.career.matchFee[cl.tier]!;
        const up = groundUpgrade(cfg, c);
        return html`<div class="card ground-card"><h3>내 경기장 <small>${st.name}</small></h3><div class="kv">
                <div><span>규모</span><b>${sizeLabel(st.size)}</b></div>
                <div><span>좌석</span><b>${st.capacity.toLocaleString('en')}</b></div>
                <div><span>홈 경기당 입장 수입</span><b>${money(Math.round(fee * cfg.career.ground[st.size].gate))}</b></div>
            </div>
            <div class="ground-actions">
                <button class="ghost" ${on('click', () => groundOpen.set(true))}>경기장 편집</button>
                ${
                    up
                        ? html`<button class="primary" ${attr({ disabled: !!up.blocked })} ${on('click', () => {
                              const err = expandGround(cfg, c);
                              if (err) return toast(err);
                              audio.play('coin');
                              toast(`${st.name} 확장 완료!`);
                              changed();
                          })}>${sizeLabel(up.size).toLowerCase()} 규모로 확장 · ${money(up.cost)}</button>${up.blocked ? html`<small class="muted">${up.blocked}</small>` : html``}`
                        : html`<small class="muted">더 이상 커질 수 없는 규모입니다.</small>`
                }
            </div></div>`;
    };
    const GroundDialog = () => {
        const st = stadiumOf(c, u());
        const look = grain<GroundLook>({ name: st.name, pattern: st.pattern, bands: st.bands, condition: st.condition, flag: st.flag });
        const size = grain<StadiumSize>(st.size);
        return Dialog({
            label: '내 경기장',
            dismiss: () => groundOpen.set(false),
            className: 'modal ground-modal',
            children: html`<div class="modal-body"><header><h2>내 경기장</h2></header>
                <div class="modal-scroll">${GroundEditor(cfg, look, size)}</div>
                <footer><button class="ghost" ${on('click', () => groundOpen.set(false))}>취소</button><button class="primary" ${on(
                    'click',
                    () => {
                        setGroundLook(c, look());
                        groundOpen.set(false);
                        toast('경기장을 수정했습니다.');
                        changed();
                    },
                )}>저장</button></footer></div>`,
        });
    };

    const Finances = () => html`<div class="grid-2">
        <div class="col">${modelRegion(() => {
            const cl = u();
            const fee = cfg.career.matchFee[cl.tier]!;
            return html`
                <div class="card"><h3>개요</h3><div class="kv">
                    <div><span>예산</span><b class="${cl.budget < 0 ? 'neg' : ''}">${money(cl.budget)}</b></div>
                    <div><span>경기일당 주급 총액</span><b>${money(wageBill(cfg, cl))}</b></div>
                    <div><span>경기 수당</span><b>${money(fee)}</b></div>
                    <div><span>승리 보너스</span><b>${money(Math.round(fee * cfg.career.winBonus))}</b></div>
                    <div><span>선수단 가치</span><b>${money(cl.squad.reduce((a, p) => a + playerValue(cfg, p), 0))}</b></div>
                </div></div>
                <div class="card"><h3>시즌 목표</h3><ul class="alerts">
                    <li>디비전 우승: ${money(fee * cfg.career.goalTitle)}</li>
                    <li>상위 4위: ${money(fee * cfg.career.goalTop4)}</li>
                    <li>강등 면하기: ${money(fee * cfg.career.goalSurvive)}</li>
                </ul><p class="muted">상위 디비전일수록 경기당 수입이 훨씬 크고, 선수들의 요구액도 그만큼 큽니다.</p></div>
            `;
        })}${modelRegion(groundCard)}</div>
        <div class="card fill"><h3>장부</h3><div class="scroll"><table class="tbl ledger"><tbody>${$each(read(() => c.ledger.slice(0, 60))).$as((l) => html`<tr><td class="muted">${String(l.season)}시즌 ${String(l.day)}일</td><td>${l.label}</td><td class="num ${l.amount < 0 ? 'neg' : 'pos'}">${money(l.amount)}</td></tr>`)}</tbody></table></div></div>
    </div>`;

    // ------------------------------------------------------------ match preview
    // ------------------------------------------------------------ coach tips: each screen explained once
    const HUB_TIPS: Record<string, { title: string; text: string | string[] }> = {
        overview: {
            title: '클럽에 오신 것을 환영합니다',
            text: '금색 버튼을 누르면 일정이 진행되거나 경기 준비 화면이 열립니다. 시즌 일정에서 리그 경기, 컵 대회 날짜, 훈련일을 확인하세요. 경기 사이에 편지가 도착합니다. 상위 2위 안에 들면 한 디비전 승격합니다.',
        },
        squad: {
            title: '내 선수단',
            text: PLAYER_DEVELOPMENT.lines,
        },
        tactics: {
            title: '선발 11명 정하기',
            text: '포메이션을 고른 뒤 슬롯을 눌러 그 자리에서 뛸 선수를 정하세요. 자리가 맞지 않으면 선수가 약해지며, 숫자는 그 슬롯에 대한 적합도입니다. 자동 선택은 모든 슬롯을 가장 잘 맞는 선수로 채웁니다. 벤치에 남은 좋은 선수들은 이유를 물으러 올 겁니다.',
        },
        training: {
            title: '훈련일',
            text: [
                '선수단의 훈련 초점을 고르세요. 드릴에 맞는 선수(포지션과 능력치)는 경험치를 더 많이 얻습니다. 부상 선수는 쉬면서 회복합니다.',
                '선수의 경험치가 충분해지면 레벨이 들어갈 포지션을 고릅니다. 이미 가진 포지션이나 새 필드 포지션 중에서 선택합니다. 포지션 레벨 2, 5, 8에서는 두 가지 특전 중 하나도 고르며, 나머지는 영영 사라집니다.',
            ],
        },
        league: {
            title: '리그',
            text: [
                '10개 클럽이 서로 홈 앤드 어웨이로 맞붙습니다. 승리 3점, 무승부 1점. 상위 2팀은 승격, 하위 2팀은 강등됩니다. 더비는 사기를 두 배로 크게 흔듭니다.',
                '다른 나라들도 각자 5개 디비전으로 함께 진행됩니다. 국기를 눌러 전환하세요. 각 나라 1부 리그 상위 2팀은 다음 시즌 챔피언스컵에 진출합니다.',
            ],
        },
        cup: {
            title: '컵 대회',
            text: [
                '피라미드 컵은 5개 디비전의 모든 클럽이 참가합니다. 단판 승부에 무승부면 승부차기라서 약팀도 멀리 갈 수 있습니다.',
                '챔피언스컵은 최강팀들의 대회입니다. 각 나라 1부 리그 상위 2팀, 총 32개 클럽이 참가합니다. 자국 1부 리그에서 상위권을 차지해 진출하세요.',
            ],
        },
        market: {
            title: '이적',
            text: [
                '새 선수가 시즌 내내 모든 나라에서 시장에 나옵니다. 어린 선수를 사서 키운 뒤 이익을 남기고 팔거나 계속 데리고 있으세요. 주급을 주의하세요. 이적료는 한 번이지만 주급은 경기일마다 나갑니다.',
                '다른 클럽도 선수를 찾고 있어서 내 최고 선수에게 제안할 수 있습니다. 제안은 편지처럼 도착합니다. 돈을 받거나 선수를 지키세요.',
            ],
        },
        finances: {
            title: '돈',
            text: '수입은 경기 수당, 승리 보너스, 시즌 목표(잔류, 상위 4위, 우승), 선수 판매에서 나옵니다. 주급은 경기일마다 나갑니다. 돈이 바닥나면 이적 시장이 막힙니다.',
        },
        playbook: {
            title: '플레이북',
            text: '모든 포지션, 능력, 패시브를 한곳에서 볼 수 있습니다. 포지션 레벨 2, 5, 8에서 선수는 둘 중 하나("또는"으로 표시)를 고르며, 나머지는 영영 사라집니다. 패시브는 항상 적용됩니다.',
        },
        prep: {
            title: '경기 준비',
            text: '먼저 상대를 파악하세요. 스타일, 폼, 위험 선수를 확인합니다. 게임 플랜을 고르면 자동 관리 선수들이 따르고, 상대 스타일을 받아치면 당일 전력이 올라갑니다. 그다음 팀 토크를 하고 보드에서 직접 플레이하거나 빠르게 시뮬레이션하세요.',
        },
    };
    /** A one-time note from the coach inside a dialog (level-up prompt, first offer); "Got it" hides it for good. */
    const NOTES: Record<string, string> = {
        levelup:
            '결정은 감독님 몫입니다. 이번 레벨을 넣을 포지션을 고르세요. 아는 것을 키우거나 새로운 것을 가르칠 수 있습니다. 포지션 레벨 2, 5, 8에서는 특전도 고르는데, 다른 선택지는 사라지니 팀에 필요한 것을 생각해 보세요.',
        bid: '어느 클럽이 우리 선수를 원합니다. 돈은 진짜지만 그 선수가 남기는 공백도 진짜입니다. 팔면 시장에서 다시 보강할 수 있고, 거절하면 선수단은 감독님이 자기들 편이라고 느낍니다.',
    };
    const coachNote = (id: keyof typeof NOTES) => {
        const key = `hub-${id}`;
        const show = derived(prefs, (p) => p.tips && !p.tipsSeen.includes(key));
        return $if(show).$then(
            () =>
                html`<div class="coach-note"><small>말로 코치</small><p>${NOTES[id]!}</p><button class="ghost" ${on('click', () => setPref('tipsSeen', [...prefs().tipsSeen, key]))}>확인</button></div>`,
        );
    };
    const coachTip = (id: Tab | 'prep', p: ReturnType<typeof prefs>) => {
        const tip = HUB_TIPS[id];
        if (!p.tips || !tip || p.tipsSeen.includes(`hub-${id}`)) return html``;
        const done = (forever: boolean) => {
            setPref('tipsSeen', [...prefs().tipsSeen, `hub-${id}`]);
            if (forever) setPref('tips', false);
        };
        const size = 96;
        const frames = cfg.animFrames.shout ?? 12;
        return html`<div class="tip ${id === 'prep' ? 'prep-tip' : 'hub-tip'}">
            <div class="coach"><div class="sprite" style="${spriteStyle(cfg, 'coach', 'shout', 'down')};width:${String(size)}px;height:${String(size)}px;background-size:${String(frames * size)}px ${String(size)}px;--strip:${String(frames * size)}px"></div></div>
            <div class="tip-body"><small>말로 코치</small><h3>${tip.title}</h3>
                ${(typeof tip.text === 'string' ? [tip.text] : tip.text).map((paragraph) => html`<p>${paragraph}</p>`)}
                <div class="tip-actions"><button class="ghost" ${on('click', () => done(true))}>팁 끄기</button><button class="primary" ${on('click', () => done(false))}>확인</button></div></div>
        </div>`;
    };
    const hubTip = derived(combined([tab, prefs]), ([id, p]) => coachTip(id, p));
    const prepTip = derived(prefs, (p) => coachTip('prep', p));

    const PreviewDialog = () => {
        const t = today(cfg, c);
        if (t.kind !== 'match') return html``;
        const h = club(t.fixture.home);
        const a = club(t.fixture.away);
        validLineup(cfg, h);
        validLineup(cfg, a);
        const prep = prepFor(cfg, c, t.fixture);
        const opp = opponentOf(c, t.fixture);
        const oppStyle = styleOf(opp);
        const derby = isDerby(c, t.fixture);
        const div = pyramidOf(c, opp.id).find((d) => d.clubs.includes(opp.id))!;
        const pos = table(div).findIndex((r) => r.club === opp.id) + 1;
        const form = div.fixtures
            .filter((x) => x.result && (x.home === opp.id || x.away === opp.id))
            .slice(-5)
            .map((x) => {
                const [gh, ga] = x.result!;
                const [f, ag] = x.home === opp.id ? [gh, ga] : [ga, gh];
                return f > ag ? 'W' : f === ag ? 'D' : 'L';
            });
        const threats = opp.lineup
            .map((id) => opp.squad.find((p) => p.id === id)!)
            .filter(Boolean)
            .sort((x, y) => ovr(cfg, y) - ovr(cfg, x))
            .slice(0, 3);
        const st = stadiumOf(c, h);
        const ref = cfg.referee.styles[prep.referee.style];
        const setPlan = (s: TeamStyle) => {
            prep.plan = s;
            changed();
        };
        const setTalk = (k: TeamTalk) => {
            prep.talk = k;
            changed();
        };
        const edgeNote = (s: TeamStyle) => {
            const e = planEdge(s, oppStyle);
            return e > 0
                ? html`<em class="pos">${cfg.ai.styles[oppStyle].label}에 강함</em>`
                : e < 0
                  ? html`<em class="neg">${cfg.ai.styles[oppStyle].label}에 약함</em>`
                  : html``;
        };
        const styles = Object.keys(cfg.ai.styles) as TeamStyle[];
        const selectedPlan = read(() => prep.plan);
        const selectedTalk = read(() => prep.talk);
        const counter = derived(selectedPlan, (plan) =>
            COUNTERS[plan] ? `. ${josa(cfg.ai.styles[plan].label,'은')} ${cfg.ai.styles[COUNTERS[plan]!].label}에 강합니다` : '',
        );
        return Dialog({
            label: '경기 준비',
            dismiss: () => preview.set(false),
            children: html`<div class="modal-body preview prep">
                <header><h2>경기 준비 · ${t.cup ? `${CUP_NAME} · ${t.cup.label}` : `${t.round + 1}라운드`}${derby ? html` <span class="derby">더비</span>` : html``}</h2><button class="ghost" ${on('click', () => preview.set(false))}>✕</button></header>
                <div class="modal-scroll">
                    ${$render(prepTip)}
                    <div class="vs big">${crest(h)}<b>${h.name}</b><span>vs</span><b>${a.name}</b>${crest(a)}</div>
                    <p class="venue">${st.name} · ${sizeLabel(st.size)} · ${conditionsLabel(prep.conditions)} · 심판 ${prep.referee.name} (${ref.label})${t.cup ? ' · 무승부 시 승부차기' : ''}</p>
                    <div class="grid-2">
                        <div class="card"><h4>상대 분석: ${opp.short}</h4>
                            <div class="kv">
                                <div><span>스타일</span><b>${cfg.ai.styles[oppStyle].label}</b></div>
                                <div><span>포메이션</span><b>${opp.formationId}</b></div>
                                <div><span>${leagueName(opp.nation, opp.tier)}</span><b>${pos ? ordinal(pos) : '–'}</b></div>
                                <div><span>최근 폼</span><b class="form">${form.length ? form.map((r) => html`<i class="r${r}">${r === 'W' ? '승' : r === 'D' ? '무' : '패'}</i>`) : '–'}</b></div>
                                <div><span>전력</span><b>${squadOvr(cfg, opp).toFixed(0)} vs 우리 ${squadOvr(cfg, u()).toFixed(0)}</b></div>
                            </div>
                            <p class="muted">${cfg.ai.styles[oppStyle].note}${derby ? ' 더비 경기입니다. 결과가 사기를 두 배로 크게 흔듭니다.' : ''}</p>
                            <h5>경계 대상</h5><ul class="xi">${threats.map((p) => html`<li>${portrait(opp, p, 24)}<span>${p.name}</span><em>${classLabel(cfg, p)} · ${String(seasonLine(c, p.id)?.goals ?? 0)}골</em></li>`)}</ul>
                        </div>
                        <div class="card"><h4>게임 플랜</h4>
                            <div class="plan-list">${styles.map((s) => html`<button ${attr({ class: derived(selectedPlan, (plan) => `plan ${plan === s ? 'on' : ''}`) })} ${on('click', () => setPlan(s))}><b>${cfg.ai.styles[s].label}</b>${edgeNote(s)}<span>${cfg.ai.styles[s].note}</span></button>`)}</div>
                            <p class="muted">자동 관리 선수들이 플랜을 따릅니다. 상대 스타일을 받아치면 당일 전력이 올라갑니다${counter}.</p>
                            <h4>팀 토크 <small>분위기: ${moraleLabel(story(c).morale)}</small></h4>
                            <div class="plan-list talks">${(Object.keys(TALKS) as TeamTalk[]).map((k) => html`<button ${attr({ class: derived(selectedTalk, (talk) => `plan ${talk === k ? 'on' : ''}`) })} ${on('click', () => setTalk(k))}><b>${TALKS[k].label}</b><span>${TALKS[k].note}</span></button>`)}</div>
                        </div>
                    </div>
                </div>
                <footer>
                    <button class="ghost" ${on('click', () => {
                        preview.set(false);
                        tab.set('tactics');
                    })}>라인업 변경</button>
                    <button ${on('click', () => {
                        preview.set(false);
                        actions.simMatch();
                        changed();
                    })}>빠른 시뮬레이션</button>
                    <button class="primary" ${on('click', () => {
                        preview.set(false);
                        actions.playMatch();
                    })}>경기 시작 →</button>
                </footer>
            </div>`,
        });
    };

    // ------------------------------------------------------------ letters & ceremony
    const LetterDialog = () => {
        const l = story(c).inbox;
        if (!l) return html``;
        const answer = (i: number) => {
            const out = resolveLetter(cfg, c, i);
            letterOpen.set(false);
            changed();
            audio.play('coin');
            toast(out);
        };
        return Dialog({
            label: l.title,
            className: 'modal letter-modal',
            children: html`<div class="letter">
            <div class="seal">✉</div>
            <small>보낸 사람: ${l.from}</small>
            <h2>${l.title}</h2>
            <p>${l.body.replace(/\*/g, '')}</p>
            ${
                l.kind === 'transferBid'
                    ? (() => {
                          const p = u().squad.find((q) => q.id === l.subject);
                          return html`${coachNote('bid')}${
                              p
                                  ? html`<p class="bid-facts">${flag(p.nation)} <b>${p.name}</b> · ${classLabel(cfg, p)} · OVR ${String(ovr(cfg, p))} · ${String(p.age)}세 · 가치 ${money(playerValue(cfg, p))}${u().lineup.includes(p.id) ? ' · 선발 멤버' : ''}</p>`
                                  : html``
                          }`;
                      })()
                    : html``
            }
            <div class="letter-choices">${l.choices.map((ch, i) => html`<button class="${i === 0 ? 'primary' : ''}" ${on('click', () => answer(i))}><b>${ch.label}</b><small>${ch.hint}</small></button>`)}</div>
        </div>`,
        });
    };

    const CeremonyDialog = () => {
        const r = ceremony()!;
        const headline = r.champion ? '우승!' : r.promoted ? '승격!' : r.relegated ? '강등' : '시즌 종료';
        const trophy = r.champion ? 'cup_gold' : r.promoted ? 'cup_silver' : r.relegated ? '' : 'medal_silver';
        const icon = { cup: '♛', medal: '◆', boot: '⚑', star: '★' } as const;
        return Dialog({
            label: headline,
            className: 'modal ceremony-modal',
            children: html`<div class="modal-body ceremony ${r.champion || r.promoted ? 'glory' : r.relegated ? 'gloom' : ''}">
            ${r.champion || r.promoted ? html`<div class="confetti">${Array.from({ length: 40 }, (_, i) => html`<i style="left:${String((i * 37) % 100)}%;animation-delay:${String((i % 10) * 120)}ms;--c:${['#f2bf2f', '#56b4e9', '#ffffff', '#cc79a7'][i % 4]!}"></i>`)}</div>` : html``}
            <div class="modal-scroll">
                <small>${String(r.season)}시즌 · ${leagueName(c.nation, r.tier)}</small>
                <h2>${headline}</h2>
                ${trophy ? html`<img class="trophy" src="assets/props/${trophy}.png" alt="" />` : html``}
                <p class="placing">${String(cfg.career.clubsPerDivision)}팀 중 ${ordinal(r.position)}</p>
                <ul class="awards">${r.awards.map((a) => html`<li><span class="aw-ic">${icon[a.icon]}</span><div><b>${a.title}</b><span>${a.who}</span><small>${a.detail}</small></div></li>`)}</ul>
                <ul class="alerts">${r.lines.map((l) => html`<li>${l}</li>`)}</ul>
            </div>
            <footer><button class="primary" ${on('click', () => ceremony.set(null))}>${String(r.season + 1)}시즌으로 →</button></footer>
        </div>`,
        });
    };

    // ------------------------------------------------------------ level-up prompt
    const STAT_SHORT: Record<string, string> = {
        speed: '속도',
        pace: '주력',
        passing: '패스',
        shooting: '슈팅',
        dribbling: '드리블',
        tackling: '태클',
        reflexes: '반사',
        composure: '침착',
    };
    const LevelUpDialog = () => {
        const view = derived(combined([version, levelUp]), ([, want]) => {
            const queue = u().squad.filter(isReady);
            const p = (want?.id ? queue.find((q) => q.id === want.id) : null) ?? queue[0];
            if (!p) {
                queueMicrotask(() => levelUp.set(null));
                return html``;
            }
            const others = queue.length - 1;
            const head = html`<div class="lu-player">${portrait(u(), p, 56)}<div><h3>${p.name}</h3><p>${classLabel(cfg, p)} · 레벨 ${String(p.level)} · 경험치 ${String(Math.round(p.xp))} 보유</p></div></div>`;
            const perks = pendingPerks(cfg, p);
            if (perks.length) {
                const t = perks[0]!;
                const card = (id: PerkId) => {
                    const d = perkDef(cfg, id);
                    const ab = d.kind === 'ability' ? abilityDef(cfg, id as AbilityId) : null;
                    const desc = ab ? ab.desc : cfg.passives[id as keyof typeof cfg.passives].desc;
                    return html`<button class="lu-card" ${on('click', () => {
                        const text = choosePerk(cfg, c, p.id, id);
                        if (text) {
                            audio.play('ability');
                            toast(text);
                            changed();
                        }
                    })}><span class="lu-ic">${ab ? ab.icon : '◆'}</span><b>${d.label}</b><small>${ab ? `능력 · ${ab.phase === 'act' ? '이동 후' : '이동 전'}${ab.cooldown ? ` · 쿨다운 ${String(ab.cooldown)}라운드` : ''}` : '패시브 · 항상 적용'}</small><p>${desc}</p></button>`;
                };
                return html`${head}<p class="lu-step">${cfg.classes[t.cls].label} ${String(t.level)}: 하나를 고르세요. 나머지는 영영 사라집니다.</p>
                    <div class="lu-cards perks">${t.options.map(card)}</div>${foot(others, false)}`;
            }
            const card = (cls: ClassId) => {
                const now = classLevel(p, cls);
                const prof = cfg.classes[cls].statProfile;
                const top = (Object.keys(prof) as Array<keyof typeof prof>).sort((a, b) => prof[b] - prof[a]).slice(0, 3);
                const tier = (cfg.perkTiers[cls] ?? []).find((x) => x.level === now + 1);
                return html`<button class="lu-card cls-card" ${on('click', () => {
                    const text = chooseLevelUp(cfg, c, p.id, cls);
                    if (text) {
                        audio.play('goal');
                        toast(text);
                        changed();
                    }
                })}><b>${cfg.classes[cls].label}</b><small>${now ? `${cfg.classes[cls].short} ${String(now)} → ${String(now + 1)}` : '새 포지션'}</small>
                    <p>성장: ${top.map((k) => STAT_SHORT[k]).join(', ')}</p>
                    ${tier ? html`<p class="lu-tier">${tier.options.length > 1 ? '선택' : '획득'}: ${tier.options.map((o) => perkDef(cfg, o as PerkId).label).join(' 또는 ')}</p>` : html``}
                </button>`;
            };
            return html`${head}<p class="lu-step">이번 레벨을 어떤 포지션에 넣을까요?</p>
                <div class="lu-cards">${levelUpOptions(p).map(card)}</div>${foot(others, true)}`;
        });
        const foot = (others: number, classStep: boolean) =>
            html`<footer class="lu-foot"><span class="muted">${others ? `이후 ${String(others)}명 더 레벨업 가능` : classStep ? '새 포지션은 레벨 1에서 시작하며, 레벨 2까지 능력이 없습니다.' : ''}</span><button class="ghost" ${on('click', () => levelUp.set(null))}>나중에 결정</button></footer>`;
        return Dialog({
            label: '레벨업',
            dismiss: () => levelUp.set(null),
            className: 'modal levelup-modal',
            children: html`<div class="modal-body levelup"><header><h2>▲ 레벨업</h2></header><div class="modal-scroll">${coachNote('levelup')}${$render(view)}</div></div>`,
        });
    };

    const NoticeDialog = () => {
        const m = modal()!;
        return Dialog({
            label: m.title,
            dismiss: () => modal.set(null),
            children: html`<div class="modal-body notice">
            <header><h2>${m.title}</h2></header><div class="modal-scroll"><ul class="alerts">${m.lines.map((l) => html`<li>${l}</li>`)}</ul></div>
            <footer><button class="primary" ${on('click', () => modal.set(null))}>계속</button></footer></div>`,
        });
    };

    // ------------------------------------------------------------ shell
    const screen = $switch(tab)
        .$case('season', SeasonPlan)
        .$case('squad', Squad)
        .$case('tactics', Tactics)
        .$case('training', Training)
        .$case('league', League)
        .$case('cup', Cup)
        .$case('market', Market)
        .$case('finances', Finances)
        .$case('playbook', () => html`<div class="card fill"><div class="scroll">${Playbook(cfg)}</div></div>`)
        .$default(Overview);

    const sidebar = html`<nav class="hub-side">
        <div class="club-id" ${attr({ style: read(() => `--kit:${kitColor(u().kit)}`) })}><span class="crest big">${read(() => u().short)}</span><div><b>${read(() => u().name)}</b><small>${read(() => leagueName(u().nation, u().tier))}</small></div></div>
        ${TABS.map(([id, label, icon]) => {
            const active = derived(tab, (current) => current === id);
            return html`<button ${attr({ class: derived(active, (isActive) => (isActive ? 'on' : '')), 'aria-current': derived(active, (isActive) => (isActive ? 'page' : undefined)) })} ${on(
                'click',
                () => {
                    planDay.set(null);
                    slotPick.set(null);
                    tab.set(id);
                },
            )}><span>${icon}</span>${label}</button>`;
        })}
        <div class="spacer"></div>
        <button class="menu-extra" ${on('click', actions.settings)}><span>⚙</span>설정</button>
        <button class="ghost" ${on('click', actions.exit)}>저장 후 종료</button>
    </nav>`;

    return html`<div class="hub" ${clearToast}>
        ${sidebar}
        <main class="hub-main">${topbar}<section class="hub-content">${screen}</section></main>
        ${$render(drawer)}
        ${$if(preview).$then(PreviewDialog)}${$if(derived(modal, Boolean)).$then(NoticeDialog)}
        ${$if(letterOpen).$then(LetterDialog)}${$if(derived(ceremony, Boolean)).$then(CeremonyDialog)}${$if(derived(levelUp, Boolean)).$then(LevelUpDialog)}${$if(groundOpen).$then(GroundDialog)}
        <div class="hub-overlays">${$render(hubTip)}</div>
        ${$if(derived(flash, (f) => !!f)).$then(() => html`<div class="toast">${derived(flash, (f) => f ?? '')}</div>`)}
    </div>`;
};

import { combined, derived, grain } from '@grainular/grains';
import { GroundEditor } from './GroundEditor';
import { money } from '../meta/player';
import { SimView } from './SimView';
import { Dropdown } from './Dropdown';
import { DEFAULT_NATION, NATION_IDS, NATIONS, type NationId } from '../world/nations';
import { leagueName, leagueShort } from '../world/leagues';
import { flag } from './flag';
import { createConfirmation } from './confirm';
import { controlValue, distinct } from './value';
import { Dialog } from './Dialog';
import { isDesktop, quitApp } from './desktop';
import { $each, $if, $render, $switch, attr, html, mounted, on } from '@grainular/nord';
import { defaultConfig, withOverrides, type Difficulty, type GameConfig, type TeamStyle, type TimeoutPolicy } from '../config';
import { createRng } from '../rng';
import type { Club } from '../types';
import { generateClub } from '../world/generate';
import { abilitiesOf, classLabel } from '../engine/abilities';
import {
    deleteCareer,
    stadiumOf,
    endSeason,
    fixtureClubs,
    loadCareer,
    newCareer,
    playMatchday,
    seasonDays,
    saveCareer,
    simulatedWinChance,
    today,
    userClub,
    userSide,
    type Career,
    awayKitFor,
    kitsClash,
    type Fixture,
    groundAllowed,
    startingGroundSize,
} from '../meta/career';
import { CUP_NAME, penaltyScore } from '../meta/cup';
import { Hub, type HubNotice } from './hub/Hub';
import { styleOf } from '../ai/brain';
import { recolorVersion } from './recolor';
import {
    generateStadium,
    rollConditions,
    type Conditions,
    type PitchCondition,
    type StadiumSize,
    type TimeOfDay,
    type Weather,
    defaultGroundLook,
    sizeLabel,
    type GroundLook,
} from '../world/stadium';
import { SettingsModal } from './Settings';
import { LESSONS } from './tutorial';
import { RadioPlayer } from './RadioUI';
import { radio } from './radio';
import { applyTalk, matchEdge, prepFor, storyLines } from '../meta/prep';
import { audio } from './audio';
import { AI_SPEED, prefs } from './prefs';
import { MatchController, type Controller } from './controller';
import { kitColor, MatchView } from './MatchView';
import { spriteStyle } from './sprites';
import { castUrl } from './castPack';

type Mode = 'ai' | 'hotseat' | 'watch';
type Settings = {
    mode: Mode;
    difficulty: Difficulty;
    timerSeconds: number;
    rounds: number;
    timeoutPolicy: TimeoutPolicy;
    homeFormation: string;
    awayFormation: string;
    homeKit: string;
    awayKit: string;
    ground: 'random' | StadiumSize;
    pitch: 'random' | PitchCondition;
    time: 'random' | TimeOfDay;
    weather: 'random' | Weather;
    seed: number;
};

const STORAGE_KEY = 'tackle-tactics:settings';
const loadSettings = (): Settings => {
    const fallback: Settings = {
        mode: 'ai',
        difficulty: 'normal',
        timerSeconds: defaultConfig.match.timerSeconds,
        rounds: defaultConfig.match.rounds,
        timeoutPolicy: defaultConfig.match.timeoutPolicy,
        homeFormation: '4-3-3',
        awayFormation: '4-4-2',
        homeKit: 'blue',
        awayKit: 'yellow',
        ground: 'random',
        pitch: 'random',
        time: 'random',
        weather: 'random',
        seed: Math.floor(Math.random() * 1e9),
    };
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? { ...fallback, ...JSON.parse(raw), seed: fallback.seed } : fallback;
    } catch {
        return fallback;
    }
};
const saveSettings = (s: Settings) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
        /* private mode etc. */
    }
};

const buildClubs = (cfg: GameConfig, s: Settings): [Club, Club] => {
    const rng = createRng(s.seed);
    const names = new Set<string>();
    const kAway = kitsClash(cfg, s.awayKit, s.homeKit) ? awayKitFor(cfg, s.awayKit, 0, s.homeKit) : s.awayKit;
    return [
        generateClub(cfg, rng, 'home', s.homeKit, cfg.kits.keepers[0]!, s.homeFormation, names, rng.pick([...NATION_IDS])),
        generateClub(cfg, rng, 'away', kAway, cfg.kits.keepers[1]!, s.awayFormation, names, rng.pick([...NATION_IDS])),
    ];
};

/** Weather makes the ball a little less predictable (config.weather). */
const weatherCfg = (base: GameConfig, cond: Conditions) => {
    const k = base.weather.scatterMult[cond.weather] ?? 1;
    return withOverrides(
        {
            ball: { passScatterPerCell: base.ball.passScatterPerCell * k, shotScatterPerCell: base.ball.shotScatterPerCell * k },
        },
        base,
    );
};

/** Match pacing follows the AI-speed preference. */
const pacing = () => {
    const f = AI_SPEED[prefs().aiSpeed];
    return { aiThinkMs: Math.round(defaultConfig.match.aiThinkMs * f), resolvePauseMs: Math.round(defaultConfig.match.resolvePauseMs * f) };
};

export const App = () => {
    const confirmation = createConfirmation();
    const settings = grain<Settings>(loadSettings());
    const showHowto = grain(false);
    const screen = grain<'title' | 'setup' | 'newCareer' | 'hub' | 'match' | 'sim'>('title');
    /** The live simulation screen's content (quick sim, or finishing a match early). */
    let simView: (() => ReturnType<typeof SimView>) | null = null;
    let ctl: MatchController | null = null;
    const career = grain<Career | null>(loadCareer());
    const hubNotice = grain<HubNotice | null>(null);
    let matchExit: () => void = () => {};
    let finishOdds: (() => number) | undefined;

    const configFor = (s: Settings) =>
        withOverrides({ match: { timerSeconds: s.timerSeconds, rounds: s.rounds, timeoutPolicy: s.timeoutPolicy, ...pacing() } });

    const start = () => {
        const s = settings();
        saveSettings(s);
        const clubs = buildClubs(configFor(s), s);
        const pick = <T extends string>(v: 'random' | T) => (v === 'random' ? undefined : v);
        const stadium = generateStadium(`quick-${s.seed}-${Math.random()}`, clubs[0].name.split(' ')[0]!, undefined, {
            size: pick(s.ground),
            condition: pick(s.pitch),
        });
        const conditions = rollConditions(createRng(Math.floor(Math.random() * 1e9)), stadium, {
            time: pick(s.time),
            weather: pick(s.weather),
        });
        const cfg = weatherCfg(configFor(s), conditions);
        const controllers: [Controller, Controller] =
            s.mode === 'ai' ? ['human', 'ai'] : s.mode === 'hotseat' ? ['human', 'human'] : ['ai', 'ai'];
        ctl = new MatchController(cfg, clubs, { controllers, difficulty: s.difficulty, seed: s.seed, stadium, conditions });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = ctl; // debugging hook
        matchExit = exit;
        finishOdds = undefined;
        screen.set('match');
    };
    const startTutorial = () => {
        const s: Settings = {
            ...settings(),
            mode: 'ai',
            seed: 4242,
            homeFormation: '4-3-3',
            awayFormation: '4-4-2',
            homeKit: 'blue',
            awayKit: 'yellow',
        };
        const base = withOverrides({ match: { timerSeconds: 0, rounds: 30, ...pacing() } });
        const clubs = buildClubs(base, s);
        const stadium = generateStadium('tutorial-ground', 'Training', undefined, { size: 'village', condition: 'lush' });
        const conditions: Conditions = { time: 'day', weather: 'clear' };
        ctl = new MatchController(weatherCfg(base, conditions), clubs, {
            controllers: ['human', 'ai'],
            difficulty: 'normal',
            seed: 4242,
            stadium,
            conditions,
            tutorial: LESSONS,
        });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = ctl; // debugging hook
        matchExit = () => {
            ctl?.stop();
            ctl = null;
            screen.set('title');
        };
        finishOdds = undefined;
        screen.set('match');
    };
    const exit = () => {
        ctl?.stop();
        ctl = null;
        settings.update((s) => ({ ...s, seed: Math.floor(Math.random() * 1e9) }));
        screen.set('setup');
    };

    // ------------------------------------------------------------ career flow
    const careerCfg = (c: Career) =>
        withOverrides({
            match: {
                timerSeconds: c.settings.timerSeconds,
                rounds: c.settings.rounds,
                timeoutPolicy: c.settings.timeoutPolicy,
                ...pacing(),
            },
        });

    const reportNotice = (c: Career, title: string, newsBefore: number) => {
        const fresh = c.news.slice(0, Math.max(0, c.news.length - newsBefore)).map((n) => n.text);
        hubNotice.set({ title, lines: fresh.length ? fresh.slice(0, 8) : ['경기일이 끝났습니다.'] });
    };

    const resultTitle = (c: Career, f: Fixture) => {
        const [home, away] = f.result!;
        const penalties = penaltyScore(f);
        return `${c.clubs[f.home]!.short} ${home} – ${away} ${c.clubs[f.away]!.short}${penalties ? ` (${penalties})` : ''}`;
    };

    /** Today's career fixture, set up for the engine: prep, talk, conditions, the controller. */
    const buildCareerMatch = () => {
        const c = career()!;
        const cfg = careerCfg(c);
        const t = today(cfg, c);
        if (t.kind !== 'match') return null;
        const side = userSide(c, t.fixture);
        const controllers: [Controller, Controller] = side === 0 ? ['human', 'ai'] : ['ai', 'human'];
        const stadium = stadiumOf(c, c.clubs[t.fixture.home]!);
        // match prep: the talk lands now, the plan steers your auto-players, a counter-plan lifts the side
        const prep = prepFor(cfg, c, t.fixture);
        const talk = applyTalk(cfg, c, t.fixture, prep, Math.random);
        if (talk) c.news.unshift({ season: c.season, day: c.day, text: talk, tone: 'info' });
        const conditions = prep.conditions;
        const clubs = fixtureClubs(cfg, c, t.fixture);
        clubs[side].morale = Math.max(10, Math.min(100, (clubs[side].morale ?? 60) + matchEdge(cfg, c, t.fixture, prep)));
        const plans: [TeamStyle | null, TeamStyle | null] = side === 0 ? [prep.plan, null] : [null, prep.plan];
        const match = new MatchController(weatherCfg(cfg, conditions), clubs, {
            controllers,
            difficulty: c.settings.difficulty,
            seed: Math.floor(Math.random() * 1e9),
            stadium,
            conditions,
            referee: prep.referee,
            plans,
            story: storyLines(cfg, c, t.fixture, prep),
        });
        if (import.meta.env.DEV) (window as unknown as { __tt: MatchController }).__tt = match;
        /** The match is over (played, simulated, or both): record it and go back to the club. */
        const finish = (note = '') => {
            const m = match.match;
            const played = m
                .everyone()
                .filter((p) => p.team === side)
                .map((p) => p.id);
            const stats = match.stats;
            match.stop();
            ctl = null;
            const before = c.news.length;
            const lines = Object.fromEntries(
                m.everyone().map((p) => {
                    const l = stats.players.get(p.id);
                    return [p.id, { goals: l?.goals ?? 0, assists: l?.assists ?? 0, rating: stats.rating(p) }];
                }),
            );
            playMatchday(cfg, c, { score: [...m.state.score] as [number, number], knocks: m.state.knocks, played, lines });
            saveCareer(c);
            reportNotice(c, `${resultTitle(c, t.fixture)}${note}`, before);
            simView = null;
            screen.set('hub');
        };
        return { c, cfg, t, match, finish };
    };

    /** Play the rest of a match live, without the pitch (the match itself keeps going on the engine). */
    const showSim = (match: MatchController, title: string, onDone: () => void) => {
        simView = () => SimView(match, { title, doneLabel: '클럽으로 돌아가기', onDone });
        screen.set('sim');
    };

    const playCareerMatch = () => {
        const built = buildCareerMatch();
        if (!built) return;
        const { c, cfg, t, match, finish } = built;
        ctl = match;
        const remainingFraction = () => Math.max(0, 1 - (match.match.state.round - 1) / cfg.match.rounds);
        finishOdds = () => simulatedWinChance(cfg, c, t.fixture, match.match.state.score, remainingFraction());
        matchExit = () => {
            if (match.match.state.over) return finish();
            // leaving early: the rest is simulated for real, and you can watch it play out
            match.stop();
            showSim(match, '남은 경기 시뮬레이션', () => finish(' (남은 경기 시뮬레이션)'));
        };
        screen.set('match');
    };

    const simCareerMatch = () => {
        const built = buildCareerMatch();
        if (!built) return;
        showSim(built.match, '시뮬레이션 경기', () => built.finish(' (시뮬레이션)'));
    };

    const hubActions = {
        confirm: confirmation.confirm,
        playMatch: playCareerMatch,
        simMatch: simCareerMatch,
        endSeason: () => {
            const c = career()!;
            return endSeason(careerCfg(c), c);
        },
        exit: () => {
            const c = career();
            if (c) saveCareer(c);
            screen.set('title');
        },
        settings: () => showSettings.set(true),
    };

    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => settings.update((s) => ({ ...s, [k]: v }));

    const setting = <K extends keyof Settings>(key: K) => distinct(derived(settings, (s) => s[key]));
    const select = <K extends keyof Settings>(k: K, opts: Array<[string, string]>, cast: (v: string) => Settings[K]) => {
        const value = derived(setting(k), (current) => opts.find(([v]) => current === cast(v))?.[0] ?? opts[0]![0]);
        return Dropdown(value, opts, (v) => set(k, cast(v)));
    };

    const range = (k: 'timerSeconds' | 'rounds', min: number, max: number, step: number, unit: string) => {
        const value = setting(k);
        const label = derived(value, (n) => (k === 'timerSeconds' && n <= 0 ? 'Off' : `${n}${unit}`));
        return html`<div class="range"><input type="range" min="${String(min)}" max="${String(max)}" step="${String(step)}" value="${String(value())}" ${controlValue(value)}
            ${on('input', (e) => set(k, Number((e.currentTarget as HTMLInputElement).value)))} /><output>${label}</output></div>`;
    };

    const setupSquads = derived(
        combined([setting('seed'), setting('homeFormation'), setting('awayFormation'), setting('homeKit'), setting('awayKit')]),
        () => buildClubs(defaultConfig, settings()),
    );

    const formations = defaultConfig.formations.map((f) => [f.id, f.label] as [string, string]);
    const KIT_KO: Record<string, string> = { blue: '파랑', yellow: '노랑', white: '흰색', hoops: '초록·흰 줄무늬', sky: '하늘색', stripes: '흑백 줄무늬', orange: '주황', red: '빨강', pink: '분홍', black: '검정', lime: '라임', keeper_pink: '분홍', keeper_black: '검정', keeper_lime: '라임', keeper_orange: '주황' };
    const kits = defaultConfig.kits.outfield.map((k) => [k, KIT_KO[k] ?? k] as [string, string]);

    const SetupSquad = (side: 'Home' | 'Away') => {
        const home = side === 'Home';
        const club = derived(setupSquads, (clubs) => clubs[home ? 0 : 1]);
        const controller = derived(setting('mode'), (mode) => {
            if (mode === 'watch') return 'AI';
            if (mode === 'hotseat') return home ? '플레이어 1' : '플레이어 2';
            return home ? '나' : 'AI';
        });
        const roster = $each(derived(club, (c) => c.squad)).$as((p) => {
            const abilities = abilitiesOf(defaultConfig, p)
                .map((id) => defaultConfig.abilities[id].label)
                .join(', ');
            const style = derived(recolorVersion, () => spriteStyle(defaultConfig, p.sprite, 'idle', 'down', p));
            return html`<li>
                <div class="sprite still" ${attr({ style })}></div>
                <span class="num">${String(p.number)}</span><span class="nm" title="${p.name}">${p.name}</span>
                <span class="cl" title="${abilities || '아직 능력 없음'}">${classLabel(defaultConfig, p)}</span>
                <span class="sp" title="속도 (턴 순서)">${String(p.stats.speed)}</span>
            </li>`;
        });
        return html`<section class="opts squad" aria-label="${home ? '홈' : '원정'} 스쿼드">
            <header class="setup-club" ${attr({ style: derived(club, (c) => `--kit:${kitColor(c.kit)}`) })}>
                <div><small>${home ? '홈' : '원정'} · ${controller}</small><h2>${derived(club, (c) => c.name)}</h2></div>
                <span>${derived(club, (c) => defaultConfig.ai.styles[styleOf(c)].label)}</span>
            </header>
            <div class="pair setup-team-options">
                <label>포메이션 ${select(home ? 'homeFormation' : 'awayFormation', formations, (v) => v)}</label>
                <label>유니폼 ${select(home ? 'homeKit' : 'awayKit', kits, (v) => v)}</label>
            </div>
            <div class="setup-lineup">
                <div class="setup-roster-head" aria-hidden="true"><span>선수</span><span>포지션</span><span>속도</span></div>
                <ul class="setup-roster" aria-label="${home ? '홈' : '원정'} 라인업">${roster}</ul>
            </div>
        </section>`;
    };

    const Setup = () => html`<main class="setup quick-match" aria-label="빠른 경기">
        <div class="quick-match-inner">
            <header class="quick-match-header">
                <button class="ghost" ${on('click', () => screen.set('title'))}>← 뒤로</button>
                <h1>빠른 경기</h1>
                <button class="ghost" ${on('click', () => showHowto.set(true))}>게임 방법</button>
            </header>
            <div class="setup-grid">
                <section class="opts setup-rules" aria-label="경기 설정">
                    <h2>경기 설정</h2>
                    <div class="setup-options">
                        <div class="pair"><label>모드 ${select(
                            'mode',
                            [
                                ['ai', '나 vs AI'],
                                ['hotseat', '2인 대결 (번갈아 플레이)'],
                                ['watch', 'AI끼리 관전'],
                            ],
                            (v) => v as Mode,
                        )}</label>
                        <label>AI 난이도 ${select(
                            'difficulty',
                            [
                                ['easy', '쉬움'],
                                ['normal', '보통'],
                                ['hard', '어려움'],
                            ],
                            (v) => v as Difficulty,
                        )}</label></div>
                        <label>행동 제한 시간 ${range('timerSeconds', 0, 45, 1, 's')}</label>
                        <label>경기 길이 (라운드) ${range('rounds', 6, 40, 2, '')}</label>
                        <label>시간 초과 시 ${select(
                            'timeoutPolicy',
                            [
                                ['lose', '행동 상실'],
                                ['auto', 'AI가 대신 수행'],
                            ],
                            (v) => v as TimeoutPolicy,
                        )}</label>
                        <h3>경기 환경</h3>
                        <div class="pair"><label>경기장 ${select(
                            'ground',
                            [
                                ['random', '무작위'],
                                ['village', '마을'],
                                ['town', '소도시'],
                                ['city', '대도시'],
                                ['grand', '대형'],
                            ],
                            (v) => v as Settings['ground'],
                        )}</label>
                        <label>그라운드 ${select(
                            'pitch',
                            [
                                ['random', '무작위'],
                                ['lush', '푸른 잔디'],
                                ['dry', '메마름'],
                                ['muddy', '진흙'],
                                ['frost', '서리'],
                            ],
                            (v) => v as Settings['pitch'],
                        )}</label></div>
                        <div class="pair"><label>킥오프 시간 ${select(
                            'time',
                            [
                                ['random', '무작위'],
                                ['day', '오후'],
                                ['dusk', '해질녘'],
                                ['night', '밤'],
                            ],
                            (v) => v as Settings['time'],
                        )}</label>
                        <label>날씨 ${select(
                            'weather',
                            [
                                ['random', '무작위'],
                                ['clear', '맑음'],
                                ['rain', '비'],
                                ['snow', '눈'],
                                ['fog', '안개'],
                            ],
                            (v) => v as Settings['weather'],
                        )}</label></div>
                    </div>
                </section>
                ${SetupSquad('Home')}
                ${SetupSquad('Away')}
            </div>
            <footer class="quick-match-actions">
                <button class="ghost" ${on('click', () => set('seed', Math.floor(Math.random() * 1e9)))}>새 스쿼드</button>
                <button class="primary" ${on('click', start)}>킥오프 →</button>
            </footer>
        </div>
        ${$if(showHowto).$then(() =>
            Dialog({
                label: '게임 방법',
                dismiss: () => showHowto.set(false),
                children: html`<div class="modal-body howto-modal"><header><h2>게임 방법</h2><button class="ghost" ${on('click', () => showHowto.set(false))}>닫기</button></header>
                <div class="modal-scroll"><ul>
                    <li>22명의 선수가 한 명씩, 가장 빠른 선수부터 팀이 번갈아 가며 행동합니다. 모두가 한 번씩 행동하면 한 <b>라운드</b>입니다.</li>
                    <li>각 행동에는 제한 시간이 있습니다. 빨리 행동해서 순서를 넘기세요. 망설이면 그 행동을 잃습니다.</li>
                    <li><b>이동</b>(파란색). 공 없이 달리다가 상대 선수의 인접 칸에 들어서면 멈춥니다. 이것이 마킹입니다.</li>
                    <li>공을 가지고 있으면 드리블한 뒤 <b>패스 또는 슛</b>을 할 수 있습니다. 어디든 조준하세요. 주황색 구역은 공이 떨어질 수 있는 범위입니다. 멀수록 더 큰 도박입니다. 골문을 겨냥하면 슛입니다.</li>
                    <li><b>반응 행동</b>: 모든 선수는 라운드마다 한 번씩 가집니다. 누군가를 드리블로 지나치거나 근처로 공을 보내면 상대가 태클/인터셉트 판정을 얻습니다. 분홍 칸은 반응이 가능한 구역이고, 흐린 원은 이미 사용한 것입니다.</li>
                    <li>${String(defaultConfig.ball.loftThreshold)}칸보다 긴 패스는 띄운 공이 되어, 출발과 착지 근처에서만 경합할 수 있습니다.</li>
                    <li><b>능력</b>은 포지션 레벨에서 나옵니다(포지션 위에 마우스를 올리면 능력 목록이 보입니다). 윙어는 스프린트, 트릭, 크로스를 쓰고, 스트라이커는 뒷공간 침투와 슛 선택을 하며, 미드필더는 압박, 스루패스, 템포 조절을 합니다. 수비수는 슬라이딩, 대인 마크, 파울을 하고, 골키퍼는 지휘와 전진 수비를 합니다. 복수 포지션 선수는 두 능력 세트를 모두 얻습니다. 대부분 라운드 단위의 쿨다운이 있습니다.</li>
                    <li>단축키: <kbd>Space</kbd> 대기/종료, <kbd>1</kbd>–<kbd>9</kbd> 능력, <kbd>T</kbd> 태클, <kbd>Esc</kbd> 취소, <kbd>A</kbd> 이 행동을 AI가 대신 수행.</li>
                </ul></div>
            </div>`,
            }),
        )}
    </main>`;

    // ------------------------------------------------------------ title & new career
    const titleScene = () => {
        const figs: Array<[string, string, number, string]> = [
            ['blue_player_1', 'celebrate_down', 22, 'down'],
            ['yellow_player_2', 'idle_left', 70, 'left'],
            ['blue_player_2', 'juggle_right', 8, 'right'],
            ['keeper_pink', 'gk_ready_down', 84, 'down'],
        ];
        return html`<div class="title-scene">
            <div class="sky"></div><div class="stand-band"></div>
            ${[8, 30, 70, 92].map((x) => html`<div class="lights" style="left:${String(x)}%"></div>`)}
            <div class="turf"></div>
            ${figs.map(([kit, anim, x]) => {
                const [name, dir] = [anim.slice(0, anim.lastIndexOf('_')), anim.slice(anim.lastIndexOf('_') + 1)];
                const frames = defaultConfig.animFrames[name] ?? 8;
                return html`<div class="fig" style="left:${String(x)}%"><div class="sprite" style="background-image:url(${castUrl(`assets/cast/${kit}/${name}_${dir}.png`)});background-size:${String(frames * 160)}px 160px;--strip:${String(frames * 160)}px;animation-duration:${String(frames * 120)}ms;animation-timing-function:steps(${String(frames)})"></div></div>`;
            })}
            <div class="vignette"></div>
        </div>`;
    };

    /** Title menu: one list, a ▶ on the focused item, its description underneath. Arrows + Enter work too. */
    const Title = (c: Career | null) => {
        type Item = { id: string; label: string; desc: string; go: () => void; cls?: string };
        const items: Item[] = [
            ...(c
                ? [
                      {
                          id: 'continue',
                          label: '커리어 이어하기',
                          desc: `${userClub(c).name} · ${String(c.season)}시즌 · ${leagueName(c.nation, userClub(c).tier)}`,
                          go: () => screen.set('hub'),
                          cls: 'primary',
                      },
                  ]
                : []),
            { id: 'tutorial', label: '튜토리얼', desc: '훈련장에서 배우는 짧은 8개 레슨. 여기서 시작하세요.', go: startTutorial },
            {
                id: 'career',
                label: '새 커리어',
                desc: '최하위 리그의 클럽을 최상위로 이끄세요. 훈련하고, 영입하고, 승격하세요.',
                go: () => screen.set('newCareer'),
            },
            {
                id: 'quick',
                label: '빠른 경기',
                desc: '단판 경기: AI와 대결, 2인 대결, 또는 AI끼리 관전.',
                go: () => screen.set('setup'),
            },
            {
                id: 'settings',
                label: '설정',
                desc: 'UI 크기, 글꼴, 사운드, 진행 속도, 경기 기본값.',
                go: () => showSettings.set(true),
            },
            ...(isDesktop
                ? [
                      {
                          id: 'exit',
                          label: '종료',
                          desc: '게임을 닫습니다. 커리어는 자동으로 저장됩니다.',
                          go: () => void quitApp(),
                          cls: 'exit',
                      },
                  ]
                : []),
        ];
        const focus = grain(0);
        const keys = mounted<HTMLDivElement>(() => {
            const onKey = (e: KeyboardEvent) => {
                if (showSettings() || showHowto()) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    focus.update((f) => (f + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length);
                    audio.play('click');
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    items[focus()]?.go();
                }
            };
            window.addEventListener('keydown', onKey);
            return () => window.removeEventListener('keydown', onKey);
        });
        const menu = items.map((it, i) => {
            const cls = derived(focus, (f) => `title-item ${it.cls ?? ''} ${i === f ? 'on' : ''}`);
            return html`<button ${attr({ class: cls })} ${on('mouseenter', () => focus.set(i))} ${on('focus', () => focus.set(i))} ${on('click', it.go)}>${it.label}</button>`;
        });
        const desc = derived(focus, (f) => items[f]?.desc ?? '');
        return html`<div class="setup title-screen" ${keys}>${titleScene()}<div class="setup-inner">
            <h1>Tackle <span>Tactics</span></h1>
            <nav class="title-menu">${menu}</nav>
            <p class="title-desc">${desc}</p>
            <p class="credits">그래픽: 한국어판 직접 제작</p>
        </div></div>`;
    };

    const NewCareer = () => {
        const name = grain('');
        const nation = grain<NationId>(DEFAULT_NATION);
        const cc = defaultConfig.career;
        /** Starting division (0 = top flight); the ground can be as big as that division allows. */
        const startTier = grain(cc.divisions - 1);
        const groundLook = grain<GroundLook>({ ...defaultGroundLook(''), name: '' });
        const groundSize = grain<StadiumSize>(startingGroundSize(defaultConfig, cc.divisions - 1));
        const pickTier = (t: number) => {
            startTier.set(t);
            // the ground defaults to the biggest the division allows (pick a smaller one on the next step)
            groundSize.set(startingGroundSize(defaultConfig, t));
        };
        const divisionPicker = html`<div class="seg nc-divisions">${Array.from({ length: cc.divisions }, (_, t) => {
            const active = derived(startTier, (cur) => cur === t);
            return html`<button type="button" ${attr({ class: derived(active, (x) => (x ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => pickTier(t))}>${derived(nation, (n) => leagueShort(n, t))}</button>`;
        })}</div>
        <p class="muted nc-division-note">${derived(combined([startTier, nation]), ([t, n]) => {
            const where =
                t === cc.divisions - 1
                    ? '피라미드의 맨 아래: 긴 여정의 시작입니다.'
                    : t === 0
                      ? '최상위 리그: 잔류하고 챔피언스컵에 도전하세요.'
                      : '중간 리그: 승격이 목표입니다.';
            return `${leagueName(n, t)}. ${where} 예산 ${money(cc.startingBudget[t]!)}, ${t + 1}부 수준의 스쿼드, 최대 ${sizeLabel(startingGroundSize(defaultConfig, t)).toLowerCase()} 규모의 경기장.`;
        })}</p>`;
        const groundEditor = GroundEditor(defaultConfig, groundLook, groundSize, {
            allowed: (sz) => groundAllowed(defaultConfig, sz, startTier()),
            lockedNote: (sz) => `${leagueShort(nation(), cc.ground[sz].minTier)}+`,
            watch: combined([startTier, nation]),
        });
        const kit = grain('blue');
        const keeperKit = grain(defaultConfig.kits.keepers[0]!);
        const awayKit = grain('white');
        // the away strip may never clash with the home one: move it along when the home kit changes
        const chooseHomeKit = (k: string) => {
            kit.set(k);
            if (kitsClash(defaultConfig, awayKit(), k)) awayKit.set(awayKitFor(defaultConfig, k));
        };
        /** The short name follows the club name until you type your own. */
        const short = grain('');
        const shortEdited = grain(false);
        const autoShort = (n: string) =>
            n
                .replace(/[^A-Za-z]/g, '')
                .slice(0, 3)
                .toUpperCase();
        const shownShort = derived(combined([name, short, shortEdited]), ([n, sh, edited]) => (edited ? sh : autoShort(n)) || 'YOU');
        const kitName = (k: string) => {
            return KIT_KO[k] ?? k;
        };
        // built once each: only the selected / clashing state and the preview kits update (no sprite rebuilds)
        const swatch = (k: string, which: 'home' | 'away' | 'keeper') => {
            const target = which === 'home' ? kit : which === 'away' ? awayKit : keeperKit;
            const clash = derived(kit, (home) => which === 'away' && kitsClash(defaultConfig, k, home));
            const cls = derived(combined([target, clash]), ([cur, c]) => `kit-swatch ${cur === k ? 'on' : ''} ${c ? 'clash' : ''}`);
            const title = derived(clash, (c) => (c ? `${kitName(k)}: 홈 유니폼과 색이 겹칩니다` : kitName(k)));
            const art = spriteStyle(defaultConfig, which === 'keeper' ? k : `${k}_player_1`, 'idle', 'down');
            return html`<button ${attr({ class: cls, disabled: clash, title })} ${on('click', () => (which === 'home' ? chooseHomeKit(k) : target.set(k)))}>
                <span class="portrait kit-portrait"><span class="sprite still" style="${art}"></span></span>
                <small>${kitName(k)}</small>
            </button>`;
        };
        const model = (source: typeof kit, sprite: (k: string) => string, anim = 'idle') =>
            html`<span class="kit-model"><span class="sprite" ${attr({ style: derived(source, (k) => spriteStyle(defaultConfig, sprite(k), anim, 'down')) })}></span></span>`;
        const preview = html`<div class="kit-preview">
            <div class="kit-crest" ${attr({ style: derived(kit, (k) => `--kit:${kitColor(k)}`) })}><span>${shownShort}</span></div>
            <b>${derived(name, (n) => n.trim() || '내 클럽')}</b>
            <div class="kit-pitch">
                ${model(kit, (k) => `${k}_player_1`)}${model(kit, (k) => `${k}_player_2`)}${model(keeperKit, (k) => k, 'gk_ready')}
                <span class="kit-away-label">원정</span>
                ${model(awayKit, (k) => `${k}_player_1`)}${model(awayKit, (k) => `${k}_player_2`)}
            </div>
        </div>`;
        /** A few example clubs and players, with distinct towns and surnames (fixed per country). */
        const sample = (id: NationId) => {
            const n = NATIONS[id];
            const rng = createRng(NATION_IDS.indexOf(id) * 7919 + 101);
            const towns = n.places(rng).filter((p, i, all) => all.findIndex((q) => q.slice(-3) === p.slice(-3)) === i);
            const clubs = towns.slice(0, 3).map((p) => n.clubName(rng, p));
            const players: string[] = [];
            while (players.length < 3) {
                const candidate = n.playerName(rng);
                if (!players.some((q) => q.split(' ').at(-1) === candidate.split(' ').at(-1))) players.push(candidate);
            }
            return { clubs, players };
        };
        const samples = Object.fromEntries(NATION_IDS.map((id) => [id, sample(id)])) as Record<NationId, ReturnType<typeof sample>>;
        const countryPicker = html`<div class="nation-pick" role="radiogroup" aria-label="국가">${NATION_IDS.map(
            (id) =>
                html`<button type="button" role="radio" ${attr({
                    class: derived(nation, (cur) => `nation-flag${cur === id ? ' on' : ''}`),
                    'aria-checked': derived(nation, (cur) => String(cur === id)),
                })} title="${NATIONS[id].name}" aria-label="${NATIONS[id].name}" ${on('click', () => nation.set(id))}>${flag(id, 'flag big')}</button>`,
        )}</div>
        <p class="nation-name">${derived(nation, (id) => NATIONS[id].name)}</p>
        <dl class="nation-sample">
            <dt>클럽</dt><dd>${derived(nation, (id) => samples[id].clubs.join(' · '))}</dd>
            <dt>선수</dt><dd>${derived(nation, (id) => samples[id].players.join(' · '))}</dd>
        </dl>
        <p class="muted">내 클럽은 5단계 리그 피라미드에서 선택한 디비전에서 시작합니다. 클럽 선수 대부분은 현지 출신이며, 이적 시장에서는 모든 나라의 선수를 찾아볼 수 있습니다.</p>`;
        const s = settings();
        const startError = grain('');
        const create = async () => {
            const existing = career();
            if (
                existing &&
                !(await confirmation.confirm({
                    title: '새 커리어를 시작할까요?',
                    body: `${userClub(existing).name}(으)로 진행 중인 현재 커리어가 사라집니다.`,
                    action: '새 커리어 시작',
                }))
            )
                return;
            const next = newCareer(
                defaultConfig,
                Math.floor(Math.random() * 1e9),
                {
                    timerSeconds: settings().timerSeconds,
                    rounds: settings().rounds,
                    difficulty: settings().difficulty,
                    timeoutPolicy: settings().timeoutPolicy,
                },
                {
                    name: name().trim() || undefined,
                    short: shortEdited() ? short() : undefined,
                    kit: kit(),
                    awayKit: awayKit(),
                    keeperKit: keeperKit(),
                    nation: nation(),
                    tier: startTier(),
                    ground: { look: groundLook(), size: groundSize() },
                },
            );
            if (!saveCareer(next)) {
                startError.set('새 커리어를 저장하지 못했습니다.');
                return;
            }
            career.set(next);
            hubNotice.set({
                title: `${userClub(next).name}에 오신 것을 환영합니다`,
                lines: [
                    `${NATIONS[next.nation].adjective} 피라미드 5단계 중 ${userClub(next).tier + 1}단계인 ${leagueName(next.nation, userClub(next).tier)}에서 시작합니다. 매 시즌 상위 2개 클럽이 승격합니다.`,
                    `${seasonDays(defaultConfig, next)}일 시즌에는 홈 앤드 어웨이 리그 경기와 전 디비전이 참가하는 ${CUP_NAME}가 포함됩니다.`,
                    '훈련에서 드릴 두 가지를 고르세요. 포지션에 맞는 선수가 경험치를 가장 많이 얻습니다. 전술에서 선발 11명을 정하고, 시장에서 선수를 사고파세요.',
                    '오른쪽 위의 노란 버튼을 눌러 일정을 진행하세요.',
                ],
            });
            screen.set('hub');
        };
        // two steps, both built once and toggled, so the kit sprites never rebuild
        const step = grain<1 | 2>(1);
        const shownOn = (n: 1 | 2) => attr({ hidden: derived(step, (cur) => cur !== n) });
        const stepChip = (n: 1 | 2, label: string) =>
            html`<li><button type="button" ${attr({ class: derived(step, (cur) => (cur === n ? 'on' : '')), 'aria-current': derived(step, (cur) => (cur === n ? 'step' : 'false')) })} ${on('click', () => step.set(n))}><b>${String(n)}</b>${label}</button></li>`;
        return html`<div class="setup"><div class="setup-inner new-career">
            <header class="nc-head">
                <h1>새 <span>커리어</span></h1>
                <ol class="nc-steps">${stepChip(1, '국가')}${stepChip(2, '내 클럽')}</ol>
            </header>
            <div class="nc-step nc-country" ${shownOn(1)}>
                <section class="opts">
                    <h4>국가</h4>
                    ${countryPicker}
                </section>
                <section class="opts">
                    <h4>시작 디비전</h4>
                    ${divisionPicker}
                    <h4>경기 설정</h4>
                    <label>행동 제한 시간 ${range('timerSeconds', 0, 45, 1, 's')}</label>
                    <label>경기 길이 (라운드) ${range('rounds', 6, 40, 2, '')}</label>
                    <label>AI 난이도 ${select(
                        'difficulty',
                        [
                            ['easy', '쉬움'],
                            ['normal', '보통'],
                            ['hard', '어려움'],
                        ],
                        (v) => v as Difficulty,
                    )}</label>
                    <label>시간 초과 시 ${select(
                        'timeoutPolicy',
                        [
                            ['lose', '행동 상실'],
                            ['auto', 'AI가 대신 수행'],
                        ],
                        (v) => v as TimeoutPolicy,
                    )}</label>
                    <p class="muted">경기 설정은 이 커리어의 모든 경기에 적용됩니다. 기본 ${String(s.rounds)}라운드이며, 12~16라운드가 속도감 있는 경기입니다.</p>
                </section>
            </div>
            <div class="nc-step nc-club" ${shownOn(2)}>
                <section class="opts">
                    <h4>내 클럽</h4>
                    <div class="nc-names">
                        <label>클럽 이름 <input type="text" maxlength="28" placeholder="비워 두면 무작위 클럽" ${on('input', (e) => name.set((e.target as HTMLInputElement).value))} /></label>
                        <label>약칭 <input type="text" class="short-input" maxlength="3" ${attr({ value: shownShort })} ${on(
                            'input',
                            (e) => {
                                shortEdited.set(true);
                                short.set((e.target as HTMLInputElement).value.toUpperCase());
                            },
                        )} /></label>
                    </div>
                    ${preview}
                    <h4>내 경기장</h4>
                    ${groundEditor}
                </section>
                <section class="opts">
                    <h4>홈 유니폼</h4>
                    <div class="kit-grid">${kits.map(([k]) => swatch(k, 'home'))}</div>
                    <h4>원정 유니폼 <small>홈 팀 유니폼과 색이 겹칠 때 착용</small></h4>
                    <div class="kit-grid">${kits.map(([k]) => swatch(k, 'away'))}</div>
                    <h4>골키퍼</h4>
                    <div class="kit-grid">${defaultConfig.kits.keepers.map((k) => swatch(k, 'keeper'))}</div>
                </section>
            </div>
            <footer class="nc-actions">
                <button class="ghost" ${on('click', () => (step() === 1 ? screen.set('title') : step.set(1)))}>${derived(step, (cur) => (cur === 1 ? '뒤로' : '← 국가'))}</button>
                <p class="neg" role="status" ${attr({ hidden: derived(startError, (message) => !message) })}>${startError}</p>
                <button class="primary" ${on('click', () => (step() === 1 ? step.set(2) : void create()))}>${derived(step, (cur) => (cur === 1 ? '다음: 내 클럽 →' : '커리어 시작'))}</button>
            </footer>
        </div></div>`;
    };

    const view = $switch(screen)
        .$case('sim', () => (simView ? simView() : html``))
        .$case('match', () => {
            if (!ctl) return html``;
            const c = career();
            const day = finishOdds && c ? today(careerCfg(c), c) : null;
            return MatchView(ctl, {
                onExit: matchExit,
                onSettings: () => showSettings.set(true),
                finishOdds,
                knockout: day?.kind === 'match' && !!day.cup,
            });
        })
        .$case('hub', () => {
            const c = career();
            if (!c) return html``;
            if (import.meta.env.DEV) (window as unknown as { __career: Career }).__career = c;
            return Hub(careerCfg(c), c, hubActions, hubNotice);
        })
        .$case('newCareer', NewCareer)
        .$case('setup', Setup)
        .$default(() => html`${$render(derived(career, Title))}${RadioPlayer({ floating: true })}`);
    // ------------------------------------------------------------ settings (one modal over any screen)
    const showSettings = grain(false);
    const settingsModal = $if(showSettings).$then(() => {
        const c = career();
        return SettingsModal({
            confirm: confirmation.confirm,
            onClose: () => showSettings.set(false),
            defaults: {
                get: () => {
                    const x = settings();
                    return {
                        timerSeconds: x.timerSeconds,
                        rounds: x.rounds,
                        difficulty: x.difficulty,
                        timeoutPolicy: x.timeoutPolicy,
                    };
                },
                set: (o) => {
                    settings.update((x) => ({ ...x, ...o }));
                    saveSettings(settings());
                },
            },
            career: c ? { name: userClub(c).name, settings: c.settings, save: () => saveCareer(c) } : undefined,
            onDeleteCareer: c
                ? () => {
                      deleteCareer();
                      showSettings.set(false);
                      screen.set('title');
                      career.set(null);
                  }
                : undefined,
        });
    });
    const keys = mounted<HTMLDivElement>(() => {
        // audio needs a user gesture; every button gets a tactile click
        const down = () => audio.unlock();
        window.addEventListener('keydown', down, { once: true });
        const click = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('button')) audio.play('click');
        };
        window.addEventListener('pointerdown', down);
        window.addEventListener('click', click);
        const unwatchScreen = screen.subscribe((s) => radio.setMatch(s === 'match'));
        return () => {
            unwatchScreen();
            window.removeEventListener('keydown', down);
            window.removeEventListener('pointerdown', down);
            window.removeEventListener('click', click);
        };
    });
    return html`<div class="app-root" ${keys}>${view}${settingsModal}${confirmation.dialog}</div>`;
};

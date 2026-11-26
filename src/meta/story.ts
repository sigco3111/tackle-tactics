/**
 * The life of the club between matches: morale, letters in the inbox (choices with
 * consequences), season quests, season statistics and the end-of-season awards.
 * Everything here hangs off the `Career` object and is driven by career.ts hooks.
 */
import type { ClassId, GameConfig } from '../config';
import type { Rng } from '../rng';
import type { Player } from '../types';
import { generatePlayer } from '../world/generate';
import { NATION_IDS, nationOf } from '../world/nations';
import type { Career, CareerClub, Fixture } from './career';
import { CUP_NAME, INTL_CUP_NAME, cupWinner, isCupFixture } from './cup';
import { gainXp, money, ovr } from './player';

// ------------------------------------------------------------------ types

export type SeasonLine = { apps: number; goals: number; assists: number; ratingSum: number; motm: number };
export type Choice = { label: string; hint: string };
export type Letter = {
    id: string;
    kind: string;
    from: string;
    title: string;
    body: string;
    choices: Choice[];
    subject?: string;
    amount?: number;
    trainingDay?: number;
    trainingClass?: ClassId;
    /** Transfer bids: the club making the offer. */
    buyer?: string;
};
export type Quest = { id: string; title: string; desc: string; target: number; progress: number; reward: number; done: boolean };
export type Award = { season: number; title: string; who: string };
export type PlayerMatchLine = { goals: number; assists: number; rating: number };

export type Story = {
    morale: number;
    inbox: Letter | null;
    quests: Quest[];
    seasonStats: Record<string, SeasonLine>;
    streak: number;
    awards: Award[];
    /** Letters already received this season (no repeats). */
    seenLetters: string[];
    /** The club's rival (see meta/prep `rivalOf`). */
    rival?: string;
    /** Consecutive matchdays a fit, good-enough player has missed out. */
    benched?: Record<string, number>;
    /** A start you promised a player for the next match. */
    promise?: { id: string; name: string };
    /** Letters that follow up an earlier choice, due on a day. */
    followUps?: Array<{ kind: string; day: number; subject?: string; amount?: number }>;
    lossRun?: number;
};

const MORALE = { start: 60, win: 9, draw: 2, loss: -9, min: 10, max: 100 };

const storyOf = (c: Career): Story => {
    const s = c as Career & { story?: Story };
    if (!s.story) s.story = { morale: MORALE.start, inbox: null, quests: [], seasonStats: {}, streak: 0, awards: [], seenLetters: [] };
    return s.story;
};
/** The story state of a career (created on first access, so old saves just work). */
export const story = Object.assign(storyOf, {
    recordFixture: (c: Career, lines: Record<string, PlayerMatchLine>) => recordFixture(c, lines),
});

const hashKey = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};

/** The club's rival: picked once per division stay, from the clubs in the same division. */
export const rivalOf = (c: Career): CareerClub | null => {
    const s = storyOf(c);
    const u = c.clubs[c.userClubId]!;
    const div = c.divisions.find((d) => d.clubs.includes(u.id));
    if (!div) return null;
    if (!s.rival || !div.clubs.includes(s.rival)) {
        const others = div.clubs.filter((id) => id !== u.id);
        if (!others.length) return null;
        s.rival = others[hashKey(`${c.seed}-${c.season}-${u.tier}`) % others.length]!;
    }
    return c.clubs[s.rival] ?? null;
};

export const moraleLabel = (m: number) =>
    m >= 85 ? '열광' : m >= 70 ? '활기참' : m >= 55 ? '안정' : m >= 40 ? '불안' : m >= 25 ? '저조' : '반란 직전';
export const shiftMorale = (c: Career, d: number) => {
    const s = story(c);
    s.morale = Math.max(MORALE.min, Math.min(MORALE.max, Math.round(s.morale + d)));
};

const line = (c: Career, id: string) => {
    const st = story(c).seasonStats;
    return (st[id] ??= { apps: 0, goals: 0, assists: 0, ratingSum: 0, motm: 0 });
};
export const seasonLine = (c: Career, id: string): SeasonLine | undefined => story(c).seasonStats[id];
export const avgRating = (l?: SeasonLine) => (l && l.apps ? l.ratingSum / l.apps : 0);

// ------------------------------------------------------------------ simulated scorers

const SCORE_W: Record<ClassId, number> = { striker: 5, winger: 3, midfielder: 2, defender: 0.6, keeper: 0 };
const ASSIST_W: Record<ClassId, number> = { midfielder: 3, winger: 3, striker: 1.5, defender: 1, keeper: 0.2 };

const weighted = (rng: Rng, items: Player[], w: (p: Player) => number) => {
    const total = items.reduce((a, p) => a + Math.max(0, w(p)), 0);
    let r = rng() * total;
    for (const p of items) if ((r -= Math.max(0, w(p))) <= 0) return p;
    return items[0];
};

/** Invent plausible per-player lines for a match that wasn't played on the board. */
export const simLines = (rng: Rng, club: CareerClub, goals: number, conceded: number): Record<string, PlayerMatchLine> => {
    const xi = club.lineup.map((id) => club.squad.find((p) => p.id === id)).filter(Boolean) as Player[];
    const out: Record<string, PlayerMatchLine> = {};
    for (const p of xi)
        out[p.id] = { goals: 0, assists: 0, rating: 6.2 + (rng() - 0.5) * 1.2 + (goals > conceded ? 0.3 : goals < conceded ? -0.3 : 0) };
    for (let g = 0; g < goals; g++) {
        const scorer = weighted(rng, xi, (p) => SCORE_W[p.cls] * (p.stats.shooting / 50));
        if (!scorer) continue;
        out[scorer.id]!.goals++;
        out[scorer.id]!.rating += 1;
        if (rng.chance(0.7)) {
            const a = weighted(
                rng,
                xi.filter((p) => p.id !== scorer.id),
                (p) => ASSIST_W[p.cls] * (p.stats.passing / 50),
            );
            if (a) {
                out[a.id]!.assists++;
                out[a.id]!.rating += 0.6;
            }
        }
    }
    for (const p of xi) if (p.cls === 'keeper' || p.cls === 'defender') out[p.id]!.rating -= conceded * 0.2;
    for (const l of Object.values(out)) l.rating = Math.round(Math.max(3, Math.min(10, l.rating)) * 10) / 10;
    return out;
};

export const recordLines = (c: Career, lines: Record<string, PlayerMatchLine>) => {
    story.recordFixture(c, lines);
};

const recordFixture = (c: Career, lines: Record<string, PlayerMatchLine>) => {
    const best = Object.entries(lines).sort((a, b) => b[1].rating - a[1].rating)[0]?.[0];
    for (const [id, l] of Object.entries(lines)) {
        const s = line(c, id);
        s.apps++;
        s.goals += l.goals;
        s.assists += l.assists;
        s.ratingSum += l.rating;
        if (id === best) s.motm++;
    }
};

// ------------------------------------------------------------------ quests

type QuestDef = { id: string; title: string; desc: (t: number) => string; target: number; reward: number };
const QUESTS: QuestDef[] = [
    { id: 'streak', title: '불붙은 연승', desc: (t) => `리그 ${t}연승을 달성하세요.`, target: 3, reward: 3 },
    { id: 'goals', title: '골 폭풍', desc: (t) => `이번 시즌 리그에서 ${t}골을 넣으세요.`, target: 12, reward: 2 },
    { id: 'cleans', title: '철옹성', desc: (t) => `리그에서 ${t}경기 무실점을 기록하세요.`, target: 3, reward: 2.5 },
    { id: 'bigwin', title: '선언적 승리', desc: () => '리그 경기에서 3골 차 이상으로 이기세요.', target: 1, reward: 2 },
    { id: 'scorer', title: '부적 같은 존재', desc: (t) => `한 선수가 리그에서 ${t}골을 넣게 하세요.`, target: 5, reward: 2 },
    { id: 'newclass', title: '만능 재주꾼', desc: () => '선수를 완전히 새로운 포지션으로 키우세요.', target: 1, reward: 1.5 },
    { id: 'motm', title: '스타의 활약', desc: (t) => `직접 플레이한 리그 경기에서 MOM을 ${t}번 받으세요.`, target: 3, reward: 2 },
    { id: 'unbeaten', title: '강철 의지', desc: (t) => `리그 ${t}경기 연속 무패를 기록하세요.`, target: 5, reward: 3 },
];

const newQuests = (rng: Rng): Quest[] => {
    const pool = [...QUESTS].sort(() => rng() - 0.5).slice(0, 3);
    return pool.map((q) => ({
        id: q.id,
        title: q.title,
        desc: q.desc(q.target),
        target: q.target,
        progress: 0,
        reward: q.reward,
        done: false,
    }));
};

export const bumpQuest = (
    cfg: GameConfig,
    c: Career,
    id: string,
    value: number,
    mode: 'set' | 'add' | 'max',
    reward: (amount: number, title: string) => void,
) => {
    for (const q of story(c).quests) {
        if (q.id !== id || q.done) continue;
        q.progress = mode === 'add' ? q.progress + value : mode === 'max' ? Math.max(q.progress, value) : value;
        if (q.progress >= q.target) {
            q.done = true;
            q.progress = q.target;
            const fee = cfg.career.matchFee[c.clubs[c.userClubId]!.tier]!;
            reward(Math.round(fee * q.reward), q.title);
            shiftMorale(c, 6);
        }
    }
};

// ------------------------------------------------------------------ letters (the writer's room)

type LetterDef = {
    id: string;
    from: string;
    title: string;
    when: (c: Career, u: CareerClub) => boolean;
    training?: true;
    body: (v: Vars) => string;
    choices: (v: Vars) => Choice[];
    /** Returns a one-line outcome for the news feed. */
    resolve: (choice: number, v: Vars, ctx: Ctx) => string;
};
type Vars = { p: Player | null; club: string; amount: number; fee: number; rival: string; trainingClass?: ClassId; buyer?: string };
type Ctx = { cfg: GameConfig; c: Career; u: CareerClub; rng: Rng; pay: (label: string, amount: number) => void };
export type Trainee = { player: Player; cls: ClassId };

const CLS_KO: Record<string, string> = { keeper: '골키퍼', defender: '수비수', midfielder: '미드필더', winger: '윙어', striker: '스트라이커' };
const LETTERS: LetterDef[] = [
    {
        id: 'bard',
        from: '음유시인 오도 루트라이트',
        title: '시대를 넘는 응원가',
        when: () => true,
        body: (v) =>
            `존경하는 감독님! ${v.club}의 이야기를 들었더니 제 류트가 노래하고 싶어 안달입니다. 소박하게 ${money(v.amount)}만 주시면 다 큰 대장장이도 앞치마에 눈물을 쏟을 만큼 벅찬 응원가를 지어 드리지요. 선수들은 매 경기 그 곡과 함께 입장할 겁니다. 거절하시면... 음유시인도 *무언가*에 대해서는 노래해야 하니까요.`,
        choices: (v) => [
            { label: `의뢰하기 (${money(v.amount)})`, hint: '사기 크게 상승' },
            { label: '정중히 거절', hint: '놀림 담은 발라드 위험' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                x.pay('클럽 응원가', -v.amount);
                shiftMorale(x.c, 12);
                return '새 응원가가 경기장에 울려 퍼집니다. 선수단의 어깨가 펴졌습니다.';
            }
            shiftMorale(x.c, -3);
            followUp(x.c, 'ballad', 4, { amount: v.amount });
            return '오도가 감독님의 "짠 지갑"에 대한 발라드를 썼습니다. 귀에 착 붙습니다. 짜증날 만큼요.';
        },
    },
    {
        id: 'extra',
        from: '주장',
        title: '추가 훈련',
        when: () => true,
        training: true,
        body: (v) =>
            `감독님, ${v.p!.name} 선수가 오늘 ${CLS_KO[v.trainingClass!] ?? v.trainingClass!} 훈련이 끝난 뒤에도 남아 있습니다. 내일 다른 선수들이 오기 전에 다시 하고 싶답니다. 물리치료사는 하루치로는 이미 충분하다고 합니다.`,
        choices: () => [
            { label: '계속하게 둔다', hint: '경험치 대폭, 부상 위험 약간' },
            { label: '쉬라고 지시한다', hint: '안전하지만 약간 김빠짐' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            if (ch === 1) {
                shiftMorale(x.c, -2);
                return `${p.name} 선수가 투덜대며 쉽니다.`;
            }
            const ready = gainXp(x.cfg, p, 90);
            if (x.rng.chance(0.22)) {
                p.injury = Math.max(p.injury ?? 0, 3);
                return `${p.name} 선수가 무리해서 어딘가를 다쳤습니다. 3일 결장.${ready ? ' 하지만 그 전에 레벨업 자격을 얻었습니다. 스쿼드에서 포지션을 고르세요.' : ''}`;
            }
            return ready
                ? `${p.name} 선수의 추가 훈련이 결실을 맺었습니다. 레벨업 준비 완료. 스쿼드에서 포지션을 고르세요.`
                : `${p.name} 선수가 많은 경험치를 쌓았습니다.`;
        },
    },
    {
        id: 'openTraining',
        from: '그라운드 관리인',
        title: '공개 훈련',
        when: () => true,
        training: true,
        body: (v) =>
            `서포터들이 오늘 훈련을 보러 정문에 모였습니다. 다음 훈련 때는 안으로 들어오고 싶어 합니다. 한편 지역 길드가 같은 시간에 비공개 코칭 세션을 열어 주면 ${money(v.amount)}을 내겠다고 합니다. 그런데 구장은 하나뿐입니다, 감독님.`,
        choices: (v) => [
            { label: '문을 연다', hint: '서포터가 선수단 사기를 끌어올림' },
            { label: '길드를 코칭한다', hint: `클럽에 ${money(v.amount)} 수입` },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                shiftMorale(x.c, 7);
                return '서포터들이 모든 드릴에 환호했습니다. 선수단은 신나게 훈련을 마쳤습니다.';
            }
            x.pay('길드 코칭 세션', v.amount);
            return `길드가 코칭 세션 대가로 ${money(v.amount)}을 지불했습니다.`;
        },
    },
    {
        id: 'trialist',
        from: '진흙투성이 낯선 이',
        title: '정문의 노크 소리',
        when: (_c, u) => u.squad.length < 20,
        body: (v) =>
            `한 젊은이가 새벽에 축구화를 목에 걸고 훈련장에 나타나 테스트를 부탁했습니다. 이름은 ${v.p!.name}, ${v.p!.age}세, 포지션은 ${CLS_KO[v.p!.cls] ?? v.p!.cls}. 선수들은 뭔가 있다고들 합니다. 주급은 소박할 겁니다.`,
        choices: (v) => [
            { label: '영입한다', hint: `이적료 없음, 경기일당 약 ${money(v.amount)}` },
            { label: '돌려보낸다', hint: '아무 일도 없음' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 1) return `${v.p!.name} 선수가 빗속으로 터덜터덜 걸어갑니다.`;
            const p = v.p!;
            p.number = Math.max(0, ...x.u.squad.map((q) => q.number)) + 1;
            x.u.squad.push(p);
            shiftMorale(x.c, 2);
            followUp(x.c, 'trialistBuzz', 8, { subject: p.id });
            return `${p.name} 선수가 악수 한 번으로 입단합니다. 클럽에 온 걸 환영합니다.`;
        },
    },
    {
        id: 'taunt',
        from: '가제트 신문',
        title: '라이벌의 도발',
        when: () => true,
        body: (v) =>
            `${v.rival}의 감독이 가제트 신문에 "빈 복도에서도 서로에게 공 한 번 못 돌릴 팀"이라고 말했습니다. 신문사가 내일 조간에 실을 감독님의 대답을 원합니다.`,
        choices: () => [
            { label: '공개적으로 맞받아친다', hint: '선수단을 자극함... 대개는' },
            { label: '의연하게 넘긴다', hint: '침착 유지' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 1) {
                shiftMorale(x.c, 1);
                return '아무 말도 하지 않습니다. 품위 있습니다. 조금 지루하기도 합니다.';
            }
            if (x.rng.chance(0.7)) {
                shiftMorale(x.c, 9);
                return `"그라운드에서 봅시다." 선수단이 그 기사를 탈의실 벽에 붙여 놓았습니다.`;
            }
            shiftMorale(x.c, -6);
            return `감독님의 대답이 ${v.rival}에게 보내는 연애편지처럼 잘못 인용되었습니다. 탈의실 분위기가 가차 없습니다.`;
        },
    },
    {
        id: 'sponsor',
        from: '황금 거위 주점',
        title: '스폰서 제안',
        when: () => true,
        body: (v) =>
            `안녕하십니까! 황금 거위 주점이 이번 시즌 남은 기간 동안 유니폼에 이름을 올리는 영광을 누리고 싶습니다. 오늘 바로 ${money(v.amount)}을 드리겠습니다. 저희 로고는 거위입니다. 금색입니다. 큽니다.`,
        choices: (v) => [
            { label: `황금을 받는다 (${money(v.amount)})`, hint: '당장 현금, 팬들은 불평' },
            { label: '유니폼을 깨끗하게 둔다', hint: '팬들이 좋아함' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                x.pay('유니폼 스폰서: 황금 거위', v.amount);
                shiftMorale(x.c, -4);
                followUp(x.c, 'goose', 6, { amount: Math.round((v.amount * 0.3) / 1000) * 1000 });
                return '유니폼에 거위가 올랐습니다. 정말 아주 큽니다.';
            }
            shiftMorale(x.c, 3);
            return '서포터즈 클럽이 감사의 의미로 파이를 보냈습니다.';
        },
    },
    {
        id: 'homesick',
        from: '클럽 물리치료사',
        title: '향수병에 걸린 선수',
        when: (_c, u) => u.squad.length > 0,
        body: (v) =>
            `${v.p!.name} 선수가 평소와 다릅니다. 모두들 고향이 그리운 거라고 하더군요. 저녁 스튜도 거의 손대지 않았습니다. 며칠 휴가를 주면 큰 도움이 되겠지만 훈련과 경기를 놓칠 수 있습니다.`,
        choices: () => [
            { label: '휴가를 준다', hint: '3일 결장, 사기 상승' },
            { label: '남게 한다', hint: '사기 하락' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                v.p!.injury = Math.max(v.p!.injury ?? 0, 3);
                shiftMorale(x.c, 6);
                return `${v.p!.name} 선수가 며칠간 고향에 갑니다. 선수단이 그 배려를 고마워합니다.`;
            }
            shiftMorale(x.c, -6);
            return `${v.p!.name} 선수가 시무룩하게 남습니다. 팀 분위기가 가라앉습니다.`;
        },
    },
    {
        id: 'scout',
        from: '스카우트 맥스',
        title: '길 위에서 들려온 소문',
        when: () => true,
        body: (v) =>
            `감독님, 특별한 걸 봤습니다. 황야 너머 마을에서 뛰는 아이인데, 아직 한참 거칠지만 잠재력이 말도 안 됩니다. 여비와 뇌물로 ${money(v.amount)}만 주시면 우리만 아는 자리에 그 이름을 이적 명단으로 올려 두겠습니다.`,
        choices: (v) => [
            { label: `출장비를 댄다 (${money(v.amount)})`, hint: '잠재력 높은 유망주가 시장에 등장' },
            { label: '지금은 아니야, 맥스', hint: '아무 일도 없음' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 1) return '맥스가 어깨를 으쓱하고 파이프로 돌아갑니다.';
            x.pay('스카우트 원정', -v.amount);
            const classes: ClassId[] = ['defender', 'midfielder', 'winger', 'striker'];
            const gem = generatePlayer(x.cfg, x.rng, x.rng.pick(classes), '', 0, `p${x.c.nextId++}`, {
                levelRange: [1, 3],
                age: [17, 18],
                nation: x.rng.pick([...NATION_IDS]),
            });
            gem.growth = x.cfg.career.growthRange[1] + 1 + x.rng() * 1.2;
            x.c.market.unshift(gem);
            return `맥스가 ${nationOf(gem.nation).name}에서 돌아왔습니다. ${gem.name}(${CLS_KO[gem.cls] ?? gem.cls}, ${gem.age}세)이(가) 시장에 나왔습니다. 잠재력 별 다섯 개. 서두르세요.`;
        },
    },
    {
        id: 'feast',
        from: '마을 의회',
        title: '수확의 달 축제',
        when: () => true,
        body: () =>
            '오늘 밤 온 마을이 수확의 달을 기리는 잔치를 엽니다. 의회가 선수단을 귀빈으로 초대했습니다. 멧돼지 구이가 나옵니다. 벌꿀술도 나옵니다. 그리고 어김없이 춤판이 벌어질 겁니다.',
        choices: () => [
            { label: '마음껏 즐기게 한다', hint: '사기 급상승, 누군가 과음할 수도' },
            { label: '일찍 자라, 친구들', hint: '안전하고 맨정신' },
        ],
        resolve: (ch, _v, x) => {
            if (ch === 1) {
                shiftMorale(x.c, -2);
                return '선수단이 숙소 창문으로 불꽃놀이를 구경합니다.';
            }
            shiftMorale(x.c, 12);
            const fit = x.u.squad.filter((p) => !p.injury);
            if (fit.length && x.rng.chance(0.3)) {
                const p = x.rng.pick(fit);
                p.injury = 2;
                return `전설적인 밤이었습니다. ${p.name} 선수가 춤추다 탁자에서 떨어져 2일 결장합니다.`;
            }
            return '전설적인 밤이었습니다. 아무도 어디서 떨어지지 않았습니다. 대체로요.';
        },
    },
    {
        // a real club wants one of your players: delivered by the transfer market, never drawn at random
        id: 'transferBid',
        from: '이적 제안',
        title: '우리 선수에 대한 제안',
        when: () => false,
        body: (v) =>
            `${v.rival}이(가) ${v.p!.name} 선수를 원하며 시장가보다 높은 ${money(v.amount)}을 제시했습니다. 그쪽 스카우트는 몇 주째 관중석에 앉아 있고, 회장은 참을성이 많은 사람이 아닙니다.`,
        choices: (v) => [
            { label: `판매한다 (${money(v.amount)})`, hint: `${v.p!.name} 선수가 ${v.rival}(으)로 이적` },
            { label: '팔지 않는다', hint: '선수단이 감독님의 의리를 알아봄' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            const buyer = v.buyer ? x.c.clubs[v.buyer] : undefined;
            if (ch === 1 || !buyer || !x.u.squad.includes(p)) {
                shiftMorale(x.c, 3);
                return `${v.rival}의 제안을 거절합니다. ${p.name} 선수는 남고 탈의실은 환영합니다.`;
            }
            x.u.squad = x.u.squad.filter((q) => q.id !== p.id);
            x.u.lineup = x.u.lineup.filter((id) => id !== p.id);
            p.number = Math.max(0, ...buyer.squad.map((q) => q.number)) + 1;
            buyer.squad.push(p);
            buyer.budget -= v.amount;
            buyer.lineup = []; // rebuilt before their next match
            x.pay(`${p.name} 선수를 ${buyer.name}에 판매`, v.amount);
            return `${p.name} 선수가 ${money(v.amount)}에 ${v.rival}(으)로 이적합니다.`;
        },
    },
    {
        id: 'healer',
        from: '약초사 헤다',
        title: '찜질약과 약속',
        when: (_c, u) => u.squad.some((p) => (p.injury ?? 0) >= 3),
        body: (v) =>
            `${v.p!.name} 선수가 누워 있다고 들었습니다. 이끼, 꿀, 그리고 말 못 할 재료 하나로 만든 제 찜질약은 부러진 기사도 고쳤답니다. ${money(v.amount)}이면 아침엔 뛰어다닐 겁니다. 아마도요.`,
        choices: (v) => [
            { label: `헤다에게 지불 (${money(v.amount)})`, hint: '아마 부상이 낫습니다' },
            { label: '물리치료사를 믿는다', hint: '자연 회복에 맡김' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 1) return '물리치료사는 고개를 끄덕입니다. 헤다는 아닙니다.';
            x.pay('헤다의 찜질약', -v.amount);
            if (x.rng.chance(0.8)) {
                delete v.p!.injury;
                return `${v.p!.name} 선수가 아침에는 뛰어다닙니다. 아무도 재료에 대해 묻지 않습니다.`;
            }
            return `${v.p!.name} 선수에게서 이끼 냄새가 납니다. 여전히 부상 중입니다.`;
        },
    },
    // ---- situational letters
    {
        id: 'minutes',
        from: '불만이 쌓인 선수',
        title: '출전 시간에 대하여',
        when: (c) => Object.values(story(c).benched ?? {}).some((n) => n >= 3) && !story(c).promise,
        body: (v) =>
            `감독님, ${v.p!.name}입니다. 벤치에 ${v.amount}경기째 앉아 있습니다. 열심히 훈련하고 준비도 됐습니다. 의자를 데우러 여기 온 게 아닙니다. 기회를 주세요.`,
        choices: () => [
            { label: '다음 경기 선발을 약속한다', hint: '어기면 탈의실이 알게 됨' },
            { label: '직접 쟁취하라고 한다', hint: '사기 소폭 하락' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            (story(x.c).benched ??= {})[p.id] = 0;
            if (ch === 0) {
                story(x.c).promise = { id: p.id, name: p.name };
                return `${p.name} 선수에게 다음 경기 선발을 약속합니다. 꼭 선발에 넣으세요.`;
            }
            shiftMorale(x.c, -3);
            return `${p.name} 선수가 이를 악물고 고개를 끄덕입니다. "그럼 직접 쟁취하겠습니다."`;
        },
    },
    {
        id: 'curse',
        from: '그림블 할멈',
        title: '집안에 저주가?',
        when: (c) => (story(c).lossRun ?? 0) >= 3,
        body: (v) =>
            `3연패라고? 그건 저주야, 얘야. 누가 저주 걸린 축구화를 센터 서클 밑에 묻어 놨어. 여기서도 냄새가 나. ${money(v.amount)}만 주면 파내서 제대로 된 주문을 외워 주지.`,
        choices: (v) => [
            { label: `지불한다 (${money(v.amount)})`, hint: '감독님은 안 믿어도 선수단은 믿음' },
            { label: '운은 우리가 만든다', hint: '웃어넘김' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                x.pay('저주 해제', -v.amount);
                shiftMorale(x.c, 9);
                return '그림블 할멈이 썩은 낡은 축구화를 파냅니다. 선수단이 환호합니다. 아무도 그게 어떻게 거기 있었는지 묻지 않습니다.';
            }
            if (x.rng.chance(0.5)) {
                shiftMorale(x.c, -3);
                return '선수들이 자꾸 센터 서클을 힐끔거립니다.';
            }
            return '웃어넘깁니다. 어쩐지 그게 도움이 됩니다.';
        },
    },
    {
        id: 'clearAir',
        from: '주장',
        title: '앙금 풀기',
        when: (c) => story(c).morale < 36,
        body: (v) =>
            `감독님, ${v.p!.name}입니다. 선수들이 가라앉아 있고 몇몇은 구석에서 수군거립니다. 제대로 모여 앉아 각자 할 말을 하고 뒤끝 없이 끝내는 게 좋겠습니다. 아니면 훈련장에서 땀으로 털어내도 됩니다. 결정은 감독님이 하십시오.`,
        choices: () => [
            { label: '미팅을 연다', hint: '대개 큰 효과, 과열될 수 있음' },
            { label: '뛰어서 털어낸다', hint: '전원 소량 경험치, 분위기는 그대로' },
        ],
        resolve: (ch, _v, x) => {
            if (ch === 0) {
                if (x.rng.chance(0.7)) {
                    shiftMorale(x.c, 13);
                    return '할 말을 했고 악수를 나눴습니다. 탈의실이 한결 가벼워졌습니다.';
                }
                shiftMorale(x.c, 3);
                return '분위기가 과열됐습니다. 의자가 날아갔습니다. 하지만 뭔가 조금은 달라졌습니다.';
            }
            for (const p of x.u.squad.filter((q) => !q.injury)) gainXp(x.cfg, p, 20);
            shiftMorale(x.c, -1);
            return '해질 때까지 달렸습니다. 행복해지진 않았어도 체력은 좋아졌습니다.';
        },
    },
    {
        id: 'veteran',
        from: '최고참 선수',
        title: '한 시즌만 더?',
        when: (_c, u) => u.squad.some((p) => p.age >= 32),
        body: (v) =>
            `${v.p!.name}입니다. 이제 ${v.p!.age}세인데 무릎에서 자갈길 달구지 소리가 납니다. 올해가 마지막일 수도 있겠다 싶었는데... 감독님이 아직 저를 필요로 하신다면 모르겠습니다.`,
        choices: () => [
            { label: '자네가 필요하네', hint: '사기 상승, 노화가 조금 더딤' },
            { label: '어린 선수들을 지도해 달라고 한다', hint: '젊은 선수들이 지금 경험치 획득' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            if (ch === 0) {
                shiftMorale(x.c, 5);
                p.peakAge += 1;
                return `${p.name} 선수가 씩 웃습니다. "그럼 한 시즌 더." 선수단이 열광합니다.`;
            }
            const kids = x.u.squad.filter((q) => q.age <= 21 && q.id !== p.id);
            for (const q of kids) gainXp(x.cfg, q, 45);
            return `${p.name} 선수가 어린 선수들을 품어 줍니다. ${kids.length}명이 벌써 한결 날카로워졌습니다.`;
        },
    },
    // ---- follow-ups (only ever arrive as consequences)
    {
        id: 'ballad',
        from: '음유시인 오도 루트라이트',
        title: '짠 지갑의 발라드',
        when: () => false,
        body: (v) =>
            `감독님! 감독님의 지갑에 대한 제 작은 발라드가 여기서 해안까지 주점마다 인기랍니다. 아이들이 부르고, 염소들도 흥얼거린다더군요. 더 다정한 2절을 ${money(v.amount)} 정도에 써 드릴 수 있습니다.`,
        choices: (v) => [
            { label: `다정한 2절을 산다 (${money(v.amount)})`, hint: '사기 상승' },
            { label: '부르게 둔다', hint: '사기 하락' },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                x.pay('다정한 2절', -v.amount);
                shiftMorale(x.c, 7);
                return '2절은 감독님을 "지갑을 넘어선 현명함"이라 부릅니다. 선수단이 버스에서 흥얼거립니다.';
            }
            shiftMorale(x.c, -4);
            return '원정 팬들이 그 발라드를 외웠습니다. 전부요.';
        },
    },
    {
        id: 'goose',
        from: '황금 거위 주점',
        title: '거위가 할 말이 있답니다',
        when: () => false,
        body: () =>
            '스폰서 계약 9조(거위 그림 밑의 작은 글씨)에 따라 선수단은 연례 거위 축제에 참석해야 합니다. 거위들이 나옵니다. 선수들은 부리를 써야 합니다. 거절하시면 계약금 일부를 돌려받겠습니다.',
        choices: (v) => [
            { label: '부리를 쓴다', hint: '돈은 지키고 체면은 잃음' },
            { label: '절대 안 된다', hint: `${money(v.amount)} 반환, 선수단은 환영` },
        ],
        resolve: (ch, v, x) => {
            if (ch === 0) {
                shiftMorale(x.c, -4);
                return '부리를 쓴 스트라이커의 사진이 이제 모든 주점 벽에 걸려 있습니다.';
            }
            x.pay('거위 축제 위약금', -v.amount);
            shiftMorale(x.c, 5);
            return '부리를 거절합니다. 선수단은 감독님을 어디든 따를 겁니다. 거위 축제만 빼고요.';
        },
    },
    {
        id: 'trialistBuzz',
        from: '스카우트 맥스',
        title: '테스트 선수가 눈길을 끕니다',
        when: () => false,
        body: (v) =>
            `${v.p!.name}, 정문에 나타났던 그 진흙투성이 아이가 훈련을 휩쓸고 있습니다. 고참 둘이 대체 어디서 찾아냈냐고 묻더군요. 기회를 주면 빨리 클 겁니다. 아니면 더 묵혀 두셔도 됩니다.`,
        choices: () => [
            { label: '속성으로 키운다', hint: '지금 경험치 대폭' },
            { label: '더 묵힌다', hint: '남은 선수 생활 동안 성장 보너스' },
        ],
        resolve: (ch, v, x) => {
            const p = v.p!;
            if (ch === 0) {
                const ready = gainXp(x.cfg, p, 120);
                shiftMorale(x.c, 2);
                return ready ? `${p.name} 선수가 벌써 레벨업 준비를 마쳤습니다. 대단한 발굴입니다.` : `${p.name} 선수가 모든 걸 스펀지처럼 흡수합니다.`;
            }
            p.growth = +(p.growth + 0.35).toFixed(2);
            return `${p.name} 선수에게 시간을 줍니다. 맥스는 인내가 보상받을 거라고 봅니다.`;
        },
    },
];

const followUp = (c: Career, kind: string, inDays: number, extra: { subject?: string; amount?: number } = {}) => {
    (story(c).followUps ??= []).push({ kind, day: c.day + inDays, ...extra });
};

/** A club's offer for one of the manager's players, delivered to the inbox (career.ts decides when). */
export const deliverBid = (c: Career, bid: { buyer: string; buyerName: string; player: Player; amount: number }) => {
    const s = story(c);
    if (s.inbox) return null;
    const def = LETTERS.find((l) => l.id === 'transferBid')!;
    const u = c.clubs[c.userClubId]!;
    const v: Vars = { p: bid.player, club: u.name, amount: bid.amount, fee: 0, rival: bid.buyerName, buyer: bid.buyer };
    s.inbox = {
        id: `bid-${c.season}-${c.day}`,
        kind: def.id,
        from: bid.buyerName,
        title: def.title,
        body: def.body(v),
        choices: def.choices(v),
        subject: bid.player.id,
        amount: bid.amount,
        buyer: bid.buyer,
    };
    (s.inbox as Letter & { rival?: string }).rival = bid.buyerName;
    return s.inbox;
};

/** Maybe deliver a new letter (one at a time, no repeats in a season). */
export const maybeLetter = (cfg: GameConfig, c: Career, rng: Rng, trainees: readonly Trainee[] = []) => {
    const s = story(c);
    if (s.inbox) return;
    const u = c.clubs[c.userClubId]!;
    const due = (s.followUps ?? []).find((x) => x.day <= c.day && (!x.subject || u.squad.some((p) => p.id === x.subject)));
    s.followUps = (s.followUps ?? []).filter((x) => x !== due && (!x.subject || u.squad.some((p) => p.id === x.subject)));
    let def: LetterDef;
    if (due) def = LETTERS.find((l) => l.id === due.kind)!;
    else {
        // situational letters are likelier when their moment comes
        const pool = LETTERS.filter((l) => (!l.training || trainees.length > 0) && !s.seenLetters.includes(l.id) && l.when(c, u));
        const urgent = pool.filter((l) => ['minutes', 'curse', 'clearAir'].includes(l.id));
        if (!pool.length || !rng.chance(urgent.length ? 0.5 : 0.24)) return;
        const training = pool.filter((l) => l.training);
        const priority = urgent.length && rng.chance(0.7) ? urgent : training;
        def = rng.pick(priority.length && (priority === urgent || rng.chance(0.5)) ? priority : pool);
    }
    const fee = cfg.career.matchFee[u.tier]!;
    const rivals = c.divisions.find((d) => d.clubs.includes(u.id))!.clubs.filter((id) => id !== u.id);
    const rival = c.clubs[s.rival && rivals.includes(s.rival) ? s.rival : rng.pick(rivals)]!.name;
    let p: Player | null = null;
    let amount = 0;
    let trainingClass: ClassId | undefined;
    switch (def.id) {
        case 'bard':
            amount = Math.round((fee * 0.6) / 1000) * 1000;
            break;
        case 'sponsor':
            amount = Math.round((fee * 2.2) / 1000) * 1000;
            break;
        case 'scout':
            amount = Math.round((fee * 0.8) / 1000) * 1000;
            break;
        case 'healer':
            p = rng.pick(u.squad.filter((q) => (q.injury ?? 0) >= 3));
            amount = Math.round((fee * 0.5) / 1000) * 1000;
            break;
        case 'extra': {
            const trainee = rng.pick(trainees);
            p = trainee.player;
            trainingClass = trainee.cls;
            break;
        }
        case 'openTraining':
            amount = Math.round((fee * 0.35) / 1000) * 1000;
            break;
        case 'homesick':
            p = rng.pick(u.squad);
            break;
        case 'ballad':
        case 'goose':
            amount = due?.amount ?? Math.round((fee * 0.4) / 1000) * 1000;
            break;
        case 'trialistBuzz':
            p = u.squad.find((q) => q.id === due?.subject) ?? null;
            break;
        case 'curse':
            amount = Math.round((fee * 0.4) / 1000) * 1000;
            break;
        case 'clearAir':
            p = [...u.squad].sort((a, b) => b.level - a.level)[0]!;
            break;
        case 'veteran':
            p = [...u.squad].sort((a, b) => b.age - a.age)[0]!;
            break;
        case 'minutes': {
            const [id, n] = Object.entries(s.benched ?? {}).sort((a, b) => b[1] - a[1])[0]!;
            p = u.squad.find((q) => q.id === id) ?? null;
            amount = n;
            if (!p) return;
            break;
        }
        case 'trialist': {
            const classes: ClassId[] = ['defender', 'midfielder', 'winger', 'striker'];
            p = generatePlayer(cfg, rng, rng.pick(classes), '', 0, `p${c.nextId++}`, {
                levelRange: cfg.career.tierLevels[u.tier],
                talentShift: cfg.career.tierTalent[u.tier],
                age: [17, 20],
                nation: c.nation,
            });
            amount = 600;
            break;
        }
    }
    const v: Vars = { p, club: u.name, amount, fee, rival, trainingClass };
    s.inbox = {
        id: `${def.id}-${c.season}-${c.day}`,
        kind: def.id,
        from: def.from,
        title: def.title,
        body: def.body(v),
        choices: def.choices(v),
        subject: p?.id,
        amount,
        trainingClass,
    };
    // stash the generated trialist so the choice can sign them
    if (def.id === 'trialist' && p) (s.inbox as Letter & { player?: Player }).player = p;
    (s.inbox as Letter & { rival?: string }).rival = rival;
    s.seenLetters.push(def.id);
    return s.inbox;
};

/** Apply the user's answer to the pending letter; returns the outcome line. */
export const answerLetter = (
    cfg: GameConfig,
    c: Career,
    rng: Rng,
    choice: number,
    pay: (label: string, amount: number) => void,
): string => {
    const s = story(c);
    const letter = s.inbox as (Letter & { player?: Player; rival?: string }) | null;
    if (!letter) return '';
    const def = LETTERS.find((l) => l.id === letter.kind)!;
    const u = c.clubs[c.userClubId]!;
    const p = letter.player ?? u.squad.find((q) => q.id === letter.subject) ?? null;
    const v: Vars = {
        p,
        club: u.name,
        amount: letter.amount ?? 0,
        fee: cfg.career.matchFee[u.tier]!,
        rival: letter.rival ?? 'a rival',
        trainingClass: letter.trainingClass,
        buyer: letter.buyer,
    };
    s.inbox = null;
    return def.resolve(choice, v, { cfg, c, u, rng, pay });
};

// ------------------------------------------------------------------ hooks called by career.ts

export const initStory = (c: Career, rng: Rng) => {
    const s = story(c);
    s.quests = newQuests(rng);
};

/** After every matchday: morale, streaks, quests, season stats. */
export const afterMatchday = (
    cfg: GameConfig,
    c: Career,
    rng: Rng,
    f: Fixture,
    gf: number,
    ga: number,
    lines: Record<string, PlayerMatchLine>,
    played: boolean,
    pay: (label: string, amount: number) => void,
    news: (t: string, tone: 'good' | 'bad' | 'info') => void,
) => {
    const s = story(c);
    rivalOf(c);
    const cup = isCupFixture(f);
    const outcome = cup ? (cupWinner(f) === c.userClubId ? 1 : -1) : Math.sign(gf - ga);
    shiftMorale(c, outcome > 0 ? MORALE.win : outcome === 0 ? MORALE.draw : MORALE.loss);
    s.lossRun = outcome < 0 ? (s.lossRun ?? 0) + 1 : 0;
    const u0 = c.clubs[c.userClubId]!;
    // the derby swings the mood harder, both ways
    if (s.rival && (f.home === s.rival || f.away === s.rival)) {
        const rival = c.clubs[s.rival]!;
        const sw = cfg.career.prep.derbySwing;
        if (outcome > 0) {
            shiftMorale(c, sw);
            news(`${rival.name}와의 더비에서 승리! 마을이 몇 주간 이 얘기로 떠들썩할 겁니다.`, 'good');
        } else if (outcome < 0) {
            shiftMorale(c, -sw);
            news(`${rival.name}에게 더비 패배. 마을 사람 누구도 이 일을 잊게 두지 않을 겁니다.`, 'bad');
        } else news(`${rival.name}와의 더비는 무승부로 끝났습니다.`, 'info');
    }
    // promises and playing time
    if (s.promise) {
        const kept = u0.lineup.includes(s.promise.id);
        shiftMorale(c, kept ? 4 : -10);
        news(
            kept
                ? `약속을 지켰습니다. ${s.promise.name} 선수가 선발로 나왔습니다.`
                : `${s.promise.name} 선수에게 선발을 약속하고 지키지 않았습니다. 탈의실이 알아챘습니다.`,
            kept ? 'good' : 'bad',
        );
        delete s.promise;
    }
    const starters = u0.lineup
        .map((id) => u0.squad.find((p) => p.id === id))
        .filter(Boolean)
        .map((p) => ovr(cfg, p!));
    const bar = starters.length ? [...starters].sort((a, b) => a - b)[Math.floor(starters.length / 3)]! : 0;
    const benched = (s.benched ??= {});
    for (const p of u0.squad) {
        const eligible = !p.injury && p.age >= 19 && p.cls !== 'keeper' && ovr(cfg, p) >= bar;
        benched[p.id] = eligible && !u0.lineup.includes(p.id) ? (benched[p.id] ?? 0) + 1 : 0;
    }
    if (cup) {
        maybeLetter(cfg, c, rng);
        return;
    }
    s.streak = gf > ga ? Math.max(1, s.streak + 1) : gf === ga ? (s.streak > 0 ? 0 : s.streak - 1) : 0;
    const unbeaten = c as Career & { unbeatenRun?: number };
    unbeaten.unbeatenRun = gf >= ga ? (unbeaten.unbeatenRun ?? 0) + 1 : 0;
    recordLines(c, lines);
    const reward = (amount: number, title: string) => {
        pay(`퀘스트 완료: ${title}`, amount);
        news(`퀘스트 완료: ${title}! +${money(amount)}, 선수단이 들떠 있습니다.`, 'good');
    };
    bumpQuest(cfg, c, 'streak', Math.max(0, s.streak), 'max', reward);
    bumpQuest(cfg, c, 'goals', gf, 'add', reward);
    if (ga === 0) bumpQuest(cfg, c, 'cleans', 1, 'add', reward);
    if (gf - ga >= 3) bumpQuest(cfg, c, 'bigwin', 1, 'add', reward);
    bumpQuest(cfg, c, 'unbeaten', unbeaten.unbeatenRun, 'max', reward);
    const u = c.clubs[c.userClubId]!;
    const topScorer = Math.max(0, ...u.squad.map((p) => s.seasonStats[p.id]?.goals ?? 0));
    bumpQuest(cfg, c, 'scorer', topScorer, 'max', reward);
    if (played) {
        const best = Object.entries(lines).sort((a, b) => b[1].rating - a[1].rating)[0];
        if (best && u.squad.some((p) => p.id === best[0])) bumpQuest(cfg, c, 'motm', 1, 'add', reward);
    }
    maybeLetter(cfg, c, rng);
};

export const afterTraining = (cfg: GameConfig, c: Career, rng: Rng, training: { trainees: readonly Trainee[] }) => {
    // morale drifts back towards "settled"
    const s = story(c);
    s.morale += Math.sign(60 - s.morale);
    return maybeLetter(cfg, c, rng, training.trainees);
};

/** Season awards + reset. Returns ceremony lines. */
export const seasonAwards = (c: Career): Array<{ title: string; who: string; detail: string; icon: 'cup' | 'medal' | 'boot' | 'star' }> => {
    const s = story(c);
    const u = c.clubs[c.userClubId]!;
    const out: Array<{ title: string; who: string; detail: string; icon: 'cup' | 'medal' | 'boot' | 'star' }> = [];
    if (c.cup?.champion) out.push({ title: CUP_NAME, who: c.clubs[c.cup.champion]!.name, detail: '컵 우승', icon: 'cup' });
    if (c.intl?.champion)
        out.push({ title: INTL_CUP_NAME, who: c.clubs[c.intl.champion]!.name, detail: '대륙 챔피언', icon: 'cup' });
    const div = c.divisions.find((d) => d.clubs.includes(u.id))!;
    // golden boot across the user's division
    const everyone = div.clubs.flatMap((id) => c.clubs[id]!.squad.map((p) => ({ p, club: c.clubs[id]!, l: s.seasonStats[p.id] })));
    const boot = everyone.filter((x) => x.l).sort((a, b) => b.l!.goals - a.l!.goals)[0];
    if (boot && boot.l!.goals > 0)
        out.push({ title: '득점왕', who: `${boot.p.name} (${boot.club.short})`, detail: `${boot.l!.goals}골`, icon: 'boot' });
    const mine = u.squad.map((p) => ({ p, l: s.seasonStats[p.id] })).filter((x) => x.l && x.l.apps >= 3);
    const pots = mine.sort((a, b) => avgRating(b.l) - avgRating(a.l))[0];
    if (pots)
        out.push({ title: '올해의 선수', who: pots.p.name, detail: `평균 평점 ${avgRating(pots.l).toFixed(2)}`, icon: 'star' });
    const done = s.quests.filter((q) => q.done).length;
    out.push({
        title: '완료한 퀘스트',
        who: `${s.quests.length}개 중 ${done}개`,
        detail: s.quests.map((q) => `${q.done ? '✓' : '✗'} ${q.title}`).join(' · '),
        icon: 'medal',
    });
    for (const a of out.filter((x) => x.icon !== 'medal')) s.awards.push({ season: c.season, title: a.title, who: a.who });
    return out;
};

export const resetSeason = (c: Career, rng: Rng) => {
    const s = story(c);
    s.seasonStats = {};
    s.seenLetters = [];
    s.quests = newQuests(rng);
};

/**
 * The training-ground tutorial: a handful of staged situations on a real match board. Each
 * lesson sets the pieces, hands one of your players the turn, and checks what happened. Nothing
 * here is special-cased in the engine; the controller just stages turns instead of running a match.
 */
import { MOVE_ABILITY_IDS, type Match } from '../engine/match';
import { hasAbility } from '../engine/abilities';
import type { Cell, MatchEvent, Piece } from '../types';

export type Cast = { me: Piece; mate: Piece; wing: Piece; def: Piece; fwd: Piece; gk: Piece; runner: Piece | null };

export type Lesson = {
    id: string;
    title: string;
    text: (k: Cast) => string;
    /** Set the board. Returns the piece that acts, null for a read-only lesson, undefined to skip. */
    stage: (m: Match, k: Cast) => Piece | null | undefined;
    /** true when the lesson is learned, otherwise what to try next. */
    done?: (ev: MatchEvent[], m: Match, k: Cast) => true | string;
    praise?: string;
};

const put = (m: Match, p: Piece, c: Cell) => {
    const o = m.pieceAt(c);
    if (o && o !== p) o.pos = { ...p.pos };
    p.pos = { ...c };
};
const give = (m: Match, p: Piece) => {
    m.state.ball = { kind: 'held', by: p.id };
};
const reset = (m: Match) => {
    m.kickoff(0);
    for (const p of m.state.pieces) {
        p.stamina = 100;
        p.cooldowns = {};
    }
};

export const castFor = (m: Match): Cast => {
    const of = (team: 0 | 1, cls: string) => m.state.pieces.filter((p) => p.team === team && p.player.cls === cls);
    const me = of(0, 'midfielder')[0] ?? m.state.pieces.find((p) => p.team === 0 && p.player.cls !== 'keeper')!;
    const mate = of(0, 'striker')[0] ?? of(0, 'midfielder')[1]!;
    const wing = of(0, 'winger')[0] ?? of(0, 'midfielder')[2] ?? mate;
    const runner = m.state.pieces.find((p) => p.team === 0 && MOVE_ABILITY_IDS.some((a) => hasAbility(m.cfg, p.player, a))) ?? null;
    return {
        me,
        mate,
        wing,
        runner,
        def: of(1, 'defender')[0]!,
        fwd: of(1, 'striker')[0] ?? of(1, 'midfielder')[0]!,
        gk: of(1, 'keeper')[0]!,
    };
};

const byMe = (ev: MatchEvent[], p: Piece, t: MatchEvent['t']) => ev.filter((e) => e.t === t && 'by' in e && e.by === p.id);

export const LESSONS: Lesson[] = [
    {
        id: 'move',
        title: '공간 찾기',
        text: (k) =>
            `${k.me.player.name} 선수입니다. 파란 칸은 이번 턴에 달릴 수 있는 모든 곳이니 하나를 클릭하세요. 붉은 빗금은 상대의 압박 구역이며, 공 없이 달리다가 이 구역에 들어서면 그 자리에서 멈춥니다.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.mate, { x: 24, y: 14 });
            give(m, k.mate);
            put(m, k.me, { x: 18, y: 9 });
            return k.me;
        },
        done: (ev, _m, k) => (ev.some((e) => e.t === 'move' && e.id === k.me.id) ? true : '파란 칸 중 하나를 클릭해서 달려 보세요.'),
        praise: '좋아요. 모든 선수는 라운드마다 한 번 움직이고, 그다음 행동할 수 있습니다.',
    },
    {
        id: 'pass',
        title: '패스하기',
        text: (k) =>
            `${k.me.player.name} 선수가 공을 가지고 있습니다. 한 턴은 이동, 행동의 두 단계입니다. 스페이스를 눌러 제자리에 머문 뒤 ${k.mate.player.name} 선수를 클릭해 패스하세요. 주황색 원은 공이 떨어질 수 있는 범위를 보여 줍니다. 긴 패스일수록 범위가 넓어지고, 패스 길 옆의 수비수가 끊어낼 수 있습니다.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.me, { x: 18, y: 14 });
            give(m, k.me);
            put(m, k.mate, { x: 25, y: 9 });
            return k.me;
        },
        done: (ev, m, k) => {
            if (!byMe(ev, k.me, 'kick').length) return '스페이스로 제자리에 머문 뒤, 동료를 클릭해 패스하세요.';
            const r = ev.find((e) => e.t === 'receive');
            return r && r.t === 'receive' && m.piece(r.by).team === 0
                ? true
                : '공을 빼앗겼어요! 옆에 아무도 없는 동료에게 짧게 패스하는 편이 안전합니다. 다시 해 보세요.';
        },
        praise: '성공입니다. 공간에 있는 선수에게 짧게 패스하면 거의 항상 도착합니다.',
    },
    {
        id: 'dribble',
        title: '공 몰고 달리기',
        text: () =>
            `이번엔 공을 몰고 가 봅시다. 분홍 칸은 아직 반응 행동이 남은 수비수 옆입니다. 밟으면 공짜 태클을 허용합니다. 분홍 칸을 피해 앞으로 드리블한 다음, 스페이스를 눌러 공을 지키세요.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.me, { x: 20, y: 14 });
            give(m, k.me);
            put(m, k.def, { x: 24, y: 14 });
            return k.me;
        },
        done: (ev, _m, k) => {
            if (ev.some((e) => e.t === 'tackle' && e.success)) return '태클당했어요! 이번엔 분홍 칸을 피해서 가 보세요.';
            return ev.some((e) => e.t === 'move' && e.id === k.me.id && e.dribble) ? true : '파란 칸을 클릭해서 앞으로 드리블하세요.';
        },
        praise: '잘했어요. 반응 행동을 이미 쓴 수비수는 자기 턴이 올 때까지 위협이 되지 않습니다.',
    },
    {
        id: 'tackle',
        title: '공 되찾기',
        text: (k) =>
            `${k.fwd.player.name} 선수가 ${k.me.player.name} 선수 바로 옆에서 공을 가지고 있습니다. 스페이스로 제자리에 머문 뒤 공을 가진 선수를 클릭(또는 T 키)해서 태클하세요. 성공 확률은 태클 능력과 드리블 능력의 대결로 정해지는 주사위 굴림이니, 타이밍을 잘 고르세요.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.fwd, { x: 21, y: 14 });
            give(m, k.fwd);
            put(m, k.me, { x: 20, y: 14 });
            return k.me;
        },
        done: (ev, _m, k) => (byMe(ev, k.me, 'tackle').length ? true : '제자리에 머문 뒤, 공을 가진 선수를 클릭하거나 T 키를 누르세요.'),
        praise: '이기든 지든 이렇게 맞서는 겁니다. 실패하면 다음 턴까지 자세가 무너집니다.',
    },
    {
        id: 'shoot',
        title: '슛',
        text: (k) =>
            `${k.me.player.name} 선수가 슛 거리 안에 있습니다. 제자리에 머문 뒤 골문 안의 칸을 클릭하세요. 주황색 띠는 슛이 향할 수 있는 범위로, 가깝고 실력이 좋을수록 좁아집니다. 골키퍼에게는 선방 판정이 주어집니다.`,
        stage: (m, k) => {
            reset(m);
            put(m, k.me, { x: 40, y: 13 });
            give(m, k.me);
            put(m, k.gk, { x: 49, y: 14 });
            return k.me;
        },
        done: (ev, _m, k) =>
            byMe(ev, k.me, 'kick').some((e) => e.t === 'kick' && e.kind === 'shot')
                ? true
                : '골문 안(골대 사이)을 클릭해서 슛하세요.',
        praise: '이것이 전체 흐름입니다. 공간을 만들고, 공을 옮기고, 슛을 날리세요.',
    },
    {
        id: 'ability',
        title: '특수 능력',
        text: (k) =>
            `${k.runner?.player.name ?? '이 선수'} 선수는 화면 아래 독에 이동 능력을 가지고 있습니다. 카드 위에 마우스를 올리면 미리 볼 수 있고, 클릭(또는 번호 키)한 뒤 칸을 클릭하세요. 능력은 사용 후 몇 라운드 동안 재충전됩니다.`,
        stage: (m, k) => {
            if (!k.runner) return undefined;
            reset(m);
            put(m, k.runner, { x: 16, y: 20 });
            put(m, k.mate, { x: 24, y: 14 });
            give(m, k.runner.id === k.mate.id ? k.me : k.mate);
            return k.runner;
        },
        done: (ev, _m, k) =>
            ev.some((e) => (e.t === 'move' && e.id === k.runner?.id && !!e.ability) || (e.t === 'ability' && e.by === k.runner?.id))
                ? true
                : '먼저 독에서 능력 카드를 고른 다음, 강조된 칸을 클릭하세요.',
        praise: '커리어에서 선수가 레벨업하면 포지션별로 더 많은 능력이 열립니다.',
    },
    {
        id: 'corner',
        title: '세트피스',
        text: () =>
            '코너킥입니다! 먼저 배치부터 하세요. 강조된 선수를 클릭한 다음 빈 칸을 클릭해서 마크맨에게서 벗어나게 합니다. 만족하면 스페이스를 누르세요(수비도 매번 대응합니다). 그다음 박스 안으로 크로스를 올리면, 공이 떨어지는 곳에서 2칸 이내의 동료가 헤딩을 시도합니다.',
        stage: (m) => {
            reset(m);
            m.awardCorner(0, 0);
            return m.carrier() ?? null;
        },
        done: (ev, m) => {
            const k = ev.find((e) => e.t === 'kick');
            return k && k.t === 'kick' && m.piece(k.by).team === 0 ? true : '박스 안의 칸을 겨냥해 공을 올리세요.';
        },
        praise: '코너킥은 선방, 블록, 걷어내기에서 나옵니다. 박스 근처 프리킥도 같은 방식입니다.',
    },
    {
        id: 'flow',
        title: '경기 진행 방식',
        text: () =>
            '매 라운드 모든 선수가 한 번씩 가장 빠른 선수부터 행동하며, 오른쪽 대기열에 다음 차례가 표시됩니다. 수비수는 라운드마다 반응 행동을 한 번 가지고 있어서, 내 턴이 아닐 때도 태클이나 인터셉트를 할 수 있습니다. 선수는 달릴수록 지칩니다(지친 선수 아래의 막대). B 키로 벤치를 열어 최대 3명까지 교체할 수 있고, F는 지시를 받을 선수 선택, P는 일시정지, H는 전술 노트를 엽니다.',
        stage: (m) => {
            reset(m);
            return null;
        },
    },
];

/**
 * Play-by-play: one short line per action, built straight from the engine's events (passes,
 * dribbles, tackles, shots, saves, fouls, cards, set pieces, subs). The live simulation shows these
 * alongside the commentators' lines. Quiet off-ball moves are skipped so the feed stays readable.
 */
import { dist } from '../engine/grid';
import type { Match } from '../engine/match';
import type { MatchEvent, TeamSide } from '../types';

/** `turnover` is any change of possession (tackle won, pass cut out or given away). */
export type PlayKind = 'pass' | 'carry' | 'duel' | 'turnover' | 'shot' | 'save' | 'goal' | 'foul' | 'card' | 'setpiece' | 'sub' | 'period';

/** What the highlights feed keeps: chances, set pieces, discipline and changes of possession. */
export const HIGHLIGHT_KINDS: ReadonlySet<PlayKind> = new Set([
    'turnover',
    'shot',
    'save',
    'goal',
    'foul',
    'card',
    'setpiece',
    'sub',
    'period',
]);
export type Play = { kind: PlayKind; text: string; team: TeamSide | null };

export const describePlays = (m: Match, events: MatchEvent[]): Play[] => {
    const out: Play[] = [];
    const who = (id: string) => m.piece(id);
    const name = (id: string) => who(id).player.name;
    const team = (id: string) => who(id).team;
    const short = (t: TeamSide) => m.state.clubs[t].short;
    const add = (kind: PlayKind, text: string, t: TeamSide | null) => out.push({ kind, text, team: t });

    for (let i = 0; i < events.length; i++) {
        const e = events[i]!;
        switch (e.t) {
            case 'move':
                // only the ball carrier's runs make the feed
                if (e.dribble && e.path.length > 1)
                    add(
                        'carry',
                        `${name(e.id)} 선수가 공을 ${e.path.length - 1}칸 몰고 갑니다${e.ability === 'sprint' ? ' (전력 질주)' : ''}`,
                        team(e.id),
                    );
                break;
            case 'trick':
                add(
                    'duel',
                    e.success ? `${name(e.by)} 선수가 트릭으로 ${name(e.on)} 선수를 벗겨 냅니다` : `${name(e.on)} 선수가 ${name(e.by)} 선수의 트릭을 읽었습니다`,
                    team(e.success ? e.by : e.on),
                );
                break;
            case 'tackle':
                add(
                    e.success ? 'turnover' : 'duel',
                    e.success
                        ? `${name(e.by)} 선수가 ${name(e.on)} 선수에게서 공을 따냅니다${e.reaction ? '' : ' (강한 태클)'}`
                        : `${name(e.on)} 선수가 ${name(e.by)} 선수의 태클을 버텨 냅니다`,
                    team(e.success ? e.by : e.on),
                );
                break;
            case 'kick': {
                const d = Math.round(dist(e.from, e.target));
                if (e.kind === 'shot') {
                    add('shot', `${name(e.by)} 선수가 ${d}칸 거리에서 슛`, team(e.by));
                    break;
                }
                // pass: say how it ended if the next events tell us
                const next = events.slice(i + 1);
                const caught = next.find((x) => x.t === 'intercept' && x.success);
                const recv = next.find((x) => x.t === 'receive' || x.t === 'header' || x.t === 'runOnto');
                const loose = next.find((x) => x.t === 'loose' || x.t === 'out');
                if (caught && caught.t === 'intercept')
                    add('turnover', `${name(e.by)} 선수의 패스를 ${name(caught.by)} 선수가 차단합니다`, team(caught.by));
                else if (recv && (recv.t === 'receive' || recv.t === 'header' || recv.t === 'runOnto')) {
                    const to = recv.by;
                    add(
                        team(to) === team(e.by) ? 'pass' : 'turnover',
                        team(to) === team(e.by)
                            ? `${name(e.by)} 선수가 ${name(to)} 선수에게 ${d > 14 ? '띄워 줍니다' : '패스합니다'}${recv.t === 'header' ? ' (헤딩으로 연결)' : ''}`
                            : `${name(e.by)} 선수의 패스가 ${name(to)} 선수에게 그대로 넘어갑니다`,
                        team(to),
                    );
                } else if (loose) add('pass', `${name(e.by)} 선수의 ${d > 14 ? '롱볼' : '패스'}이 흘러갑니다`, team(e.by));
                break;
            }
            case 'intercept':
                if (e.success && e.block) add('save', `${name(e.by)} 선수가 막아 냅니다!`, team(e.by));
                break;
            case 'save':
                add('save', e.held ? `${name(e.by)} 선수가 선방하고 잡아 냅니다` : `선방! ${name(e.by)} 선수가 쳐 냅니다`, team(e.by));
                break;
            case 'wide':
                add('shot', '골대 바깥으로 빗나감', e.team);
                break;
            case 'goal': {
                const [a, b] = m.state.score;
                add('goal', `골! ${name(e.scorer)} 선수 득점 (${short(e.team)}) · ${a}–${b}`, e.team);
                break;
            }
            case 'foul':
                add(
                    'foul',
                    `${name(e.by)} 선수가 ${name(e.on)} 선수에게 파울${e.penalty ? ': 페널티' : e.advantage ? ' (어드밴티지 적용)' : ''}`,
                    team(e.by),
                );
                break;
            case 'card':
                add('card', `${name(e.on)} 선수 ${e.card === 'red' ? '레드' : '옐로'}카드`, team(e.on));
                break;
            case 'setpiece':
                add('setpiece', `${short(e.team)} ${e.kind === 'corner' ? '코너킥' : '프리킥'}, 키커 ${name(e.taker)}`, e.team);
                break;
            case 'sub':
                add('sub', `${short(e.team)} 교체: ${name(e.off)} 아웃, ${name(e.on)} 인`, e.team);
                break;
            case 'pickup':
                add('carry', `${name(e.by)} 선수가 흐른 공을 잡습니다`, team(e.by));
                break;
            case 'kickoff':
                add('period', `킥오프: ${short(e.team)}`, e.team);
                break;
            case 'halftime':
                add('period', `전반 종료 · ${m.state.score[0]}–${m.state.score[1]}`, null);
                break;
            case 'fulltime':
                add('period', `경기 종료 · ${m.state.score[0]}–${m.state.score[1]}`, null);
                break;
            default:
                break;
        }
    }
    return out;
};

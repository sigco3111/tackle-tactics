/**
 * The voice of the match. Barnaby Quill has called matches in every muddy guild-league ground
 * from Mirewick to Kingsreach, and he has opinions. Lines are picked at random from variants,
 * never repeating the same line twice in a row.
 */
import type { Match } from '../engine/match';
import type { MatchEvent, TeamSide } from '../types';

export type Line = { text: string; tone: 'big' | 'good' | 'bad' | 'info'; team: TeamSide | null; caption?: string };

const pick = (arr: string[], last: Set<string>) => {
    const fresh = arr.filter((s) => !last.has(s));
    const s = (fresh.length ? fresh : arr)[Math.floor(Math.random() * (fresh.length ? fresh.length : arr.length))]!;
    last.add(s);
    if (last.size > 40) last.delete(last.values().next().value!);
    return s;
};
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? k);

const L = {
    kickoff: [
        '경기가 시작됩니다! {team} 팀이 공을 굴립니다.',
        '{team} 팀의 킥오프. 보드 위에서 말을 굴리는 90분이 지금 시작됩니다.',
        '휘슬이 울리고 {team} 팀이 킥오프합니다. 어딘가에서 전술가가 연필을 깎습니다.',
    ],
    goal: [
        '골! {p} 선수가 골망을 흔들고 {team} 팀이 춤을 춥니다!',
        '{p} 선수 득점! 올 시즌 이 리그에서 이보다 자신감 넘치는 마무리는 보기 어렵습니다.',
        '들어갔습니다! {p} 선수가 꽂아 넣었고 원정 응원석이 아주 조용해졌습니다.',
        '{team} 팀의 골! {p} 선수, 인사하세요. 아니, 두 번 하세요.',
        '{p} 선수! 아, 정말 아름답습니다. 골키퍼는 손도 못 썼습니다.',
    ],
    goalAssist: [
        '골! {a} 선수의 시야, {p} 선수의 마무리!',
        '{a} 선수가 자물쇠를 따고 {p} 선수가 문으로 걸어 들어갑니다. 골!',
        '대단한 공격입니다! {a} 선수에서 {p} 선수로, {team} 팀이 앞서갑니다!',
    ],
    goalHeader: ['헤더! {p} 선수가 그리핀처럼 솟구쳐 머리로 밀어 넣습니다!', '{p} 선수가 빚 받으러 온 듯 크로스에 달려듭니다! 골!'],
    goalPen: [
        '{p} 선수가 나서서... 골키퍼를 엉뚱한 주소로 보냅니다. 페널티 성공!',
        '{p} 선수의 서리처럼 차가운 마무리. 페널티킥이 깔끔하게 처리됩니다.',
    ],
    save: [
        '{k} 선수의 대단한 선방! 손끝과 분노의 결과입니다.',
        '{k} 선수가 막아냅니다! 발라드로 남을 만한 선방입니다.',
        '막혔습니다! {k} 선수가 {p} 선수의 마음을 읽고 먼저 도착했습니다.',
        '{k} 선수, 이게 선방입니다! 관중이 믿지 못합니다.',
    ],
    parry: ['{k} 선수가 쳐내는 게 전부입니다! 박스 안에 공이 흘렀습니다!', '{k} 선수가 손바닥으로 쳐냅니다. 하이에나들이 맴돕니다!'],
    wide: [
        '{p} 선수의 슛이 빗나갑니다. 옆 마을까지 날아갔습니다.',
        '{p} 선수의 슛이 골대를 벗어납니다. 어딘가에서 농부가 공을 돌려받겠군요.',
        '{p} 선수가 강하게 찼는데... 코너 플래그가 몸을 숙였습니다. 빗나갑니다.',
        '{p} 선수의 야심 찬 시도. 부정확했지만 야심은 있었습니다.',
    ],
    block: ['막혔습니다! {o} 선수가 모든 것을 던져 슛 앞을 막았습니다.', '{o} 선수가 몸을 던졌습니다. 성기사처럼 용감합니다.'],
    intercept: [
        '{o} 선수가 싸구려 소설책처럼 읽어 냅니다. 인터셉트.',
        '{o} 선수가 끊어 냅니다! 그 길은 처음부터 열려 있지 않았습니다.',
        '{o} 선수의 훌륭한 예측. 공의 주인이 바뀝니다.',
    ],
    steal: [
        '{o} 선수가 {p} 선수의 주머니를 털었습니다! 아주 깔끔합니다.',
        '{p} 선수가 춤추듯 뚫으려 했지만 {o} 선수는 그 춤 순서에 없었습니다. 공을 따냈습니다.',
        '타이밍! {o} 선수가 들어가 {p} 선수의 발끝에서 공을 가져갑니다.',
    ],
    tackle: ['{o} 선수의 강한 태클, 성공입니다!', '{o} 선수가 몸을 던져 공을 따내고 일어납니다. 교과서적입니다.'],
    missedTackle: ['{o} 선수가 달려들지만 허공만 움켜쥡니다.', '{o} 선수가 들어갔지만... {p} 선수는 이미 사라졌습니다! 쓰라린 장면입니다.'],
    dribble: ['{p} 선수가 {o} 선수를 제칩니다! 발놀림이 아름답습니다.', '{p} 선수가 {o} 선수를 바닥에 남겨 둔 채 무슨 일인지 궁금하게 만듭니다.'],
    trick: ['{p} 선수의 더미! {o} 선수가 완전히 속았습니다.', '아, {p} 선수의 시미! {o} 선수는 아직 반대쪽을 보고 있습니다.'],
    through: ['{p} 선수의 스루패스! {r} 선수가 빠져나갑니다!', '{p} 선수가 침투를 보았고 {r} 선수가 받아 냅니다. 위험합니다!'],
    cross: ['{p} 선수가 크로스를 올립니다...', '{p} 선수의 크로스가 들어옵니다!'],
    foul: ['{o} 선수의 냉혹한 파울. {p} 선수를 성문처럼 막아섰습니다.', '{o} 선수가 {p} 선수를 잡아당깁니다. 심판이 봤습니다.'],
    penalty: ['페널티! {o} 선수가 박스 안에서 {p} 선수를 넘어뜨렸습니다!', '아, {o} 선수... 페널티킥입니다.'],
    tackleFoul: [
        '{o} 선수가 {p} 선수의 뒤를 덮칩니다. {r} 심판이 휘슬을 붑니다.',
        '{o} 선수의 늦은 태클! {r} 심판이 휘슬을 꺼냅니다.',
        '{o} 선수가 {p} 선수만 잔뜩 맞히고 공은 건드리지 못했습니다. 프리킥.',
    ],
    advantage: ['{o} 선수가 {p} 선수를 걸었지만 {r} 심판이 플레이를 이어 가게 합니다. 어드밴티지!', '{o} 선수의 파울. {r} 심판이 그대로 진행시킵니다. 멋진 판정입니다.'],
    corner: [
        '{team} 팀의 코너킥. 덩치들이 전진합니다!',
        '{team} 팀이 코너킥을 얻었습니다. 세트피스 코치가 밥값을 할 순간입니다.',
        '코너킥. 모두가 박스 안으로, 팔꿈치를 세웁니다.',
    ],
    freekick: [
        '{team} 팀의 위험한 위치 프리킥. 벽이 세워집니다.',
        '{team} 팀이 사정권에서 프리킥을 얻었습니다. 누가 공 앞에 설까요?',
    ],
    escape: [
        '{p} 선수가 태클을 버텨 내고 빠져나갑니다!',
        '놓쳤습니다! {p} 선수가 수비진 전체의 중심을 무너뜨리고 빠져나갑니다.',
        '{p} 선수가 태클을 이겨 냅니다. 달릴 잔디가 아주 많이 남았습니다.',
    ],
    bonus: [
        '{p} 선수가 공을 따내고 다시 나아갑니다. 혼전에서 벗어났습니다!',
        '공을 따냈고, {p} 선수는 눈 깜짝할 새 사라졌습니다.',
        '{p} 선수가 공을 잡고 모두보다 한발 앞서 있습니다.',
    ],
    sub: [
        '{team} 팀 교체: {off} 선수 대신 {on} 선수가 들어옵니다.',
        '{off} 선수가 물러나고 {on} 선수가 들어옵니다. {team} 팀에 신선한 다리입니다.',
        '{team} 팀이 승부수를 던집니다. 지친 {off} 선수 대신 {on} 선수.',
    ],
    styleIntro: ['{team} 팀은 {style} 스타일로 나섭니다. {note}', '{team} 팀은 {style} 스타일로 경기할 것입니다. {note}'],
    chase: ['{team} 팀이 이제 사람을 앞으로 던집니다. 어쩔 수 없습니다.', '{team} 팀은 시간이 없습니다. 모두 올라갑니다!'],
    protect: ['{team} 팀이 문을 닫습니다. 열 명이 공 뒤에 있습니다.', '{team} 팀이 리드를 지키며 앉습니다. 보기엔 안 좋아도 통할지 모릅니다.'],
    refIntro: ['오늘의 심판은 {r}. {note}', '오늘은 {r} 심판이 휘슬을 쥡니다. {note}'],
    yellow: ['{o} 선수가 경고를 받습니다.', '{o} 선수에게 옐로카드. 침착하게 가야 합니다.'],
    red: ['레드카드! {o} 선수가 퇴장합니다. 길고 외로운 걸음입니다.', '두 번째 옐로, {o} 선수가 퇴장당합니다!'],
    command: ['{k} 선수가 수비를 정비합니다. 목소리가 뿔나팔 같습니다.', '{k} 선수가 소리치고 있습니다. 아주 크게. 효과가 있는 듯합니다.'],
    tempo: ['{p} 선수가 손가락을 튕기자 템포가 올라갑니다.', '{p} 선수가 지휘합니다. 다음은 {r} 선수 차례입니다.'],
    timeout: ['{p} 선수가 망설이다가... 순간이 지나가 버렸습니다.', '{p} 선수의 망설임. 시계는 누구도 기다려 주지 않습니다.'],
    halftime: ['전반 종료. {s}. 탈의실에는 오렌지와 거친 말이 오갑니다.', '휴식을 알리는 휘슬: {s}.'],
    fulltime: ['경기 종료! {s}.', '풀타임. {s}. 음유시인들이 짧게나마 노래할 겁니다.'],
};

export class Commentator {
    private recent = new Set<string>();
    constructor(private m: Match) {}

    private name = (id: string) => this.m.piece(id).player.name;
    private teamName = (t: TeamSide) => this.m.state.clubs[t].name;
    private line(key: keyof typeof L, v: Record<string, string>, tone: Line['tone'], team: TeamSide | null, caption?: string): Line {
        return { text: fill(pick(L[key], this.recent), v), tone, team, caption };
    }
    private scoreline = () =>
        `${this.m.state.clubs[0].short} ${this.m.state.score[0]}–${this.m.state.score[1]} ${this.m.state.clubs[1].short}`;

    /** Lines for one batch of engine events (most batches say nothing: silence is pacing). */
    style(team: TeamSide, style: string, note: string): Line[] {
        return [this.line('styleIntro', { team: this.teamName(team), style, note }, 'info', team)];
    }

    mood(team: TeamSide, mood: 'chase' | 'protect'): Line[] {
        return [this.line(mood, { team: this.teamName(team) }, 'info', team)];
    }

    /** Pre-match: who's refereeing and what that means. */
    referee(note: string): Line[] {
        return [this.line('refIntro', { r: this.m.state.referee.name, note }, 'info', null)];
    }

    call(events: MatchEvent[], assist?: string): Line[] {
        const out: Line[] = [];
        let throughBy: string | null = null;
        let lastShooter: string | null = null;
        for (const e of events) {
            switch (e.t) {
                case 'kickoff':
                    out.push(this.line('kickoff', { team: this.teamName(e.team) }, 'info', e.team));
                    break;
                case 'bonus':
                    out.push(this.line(e.reason === 'beat' ? 'escape' : 'bonus', { p: this.name(e.id) }, 'good', this.m.piece(e.id).team));
                    break;
                case 'sub':
                    out.push(this.line('sub', { team: this.teamName(e.team), on: this.name(e.on), off: this.name(e.off) }, 'info', e.team));
                    break;
                case 'setpiece':
                    out.push(
                        this.line(e.kind, { team: this.teamName(e.team) }, 'info', e.team, e.kind === 'corner' ? '코너킥' : '프리킥'),
                    );
                    break;
                case 'ability':
                    if (e.ability === 'through') throughBy = e.by;
                    if (e.ability === 'cross') out.push(this.line('cross', { p: this.name(e.by) }, 'info', this.m.piece(e.by).team));
                    if (e.ability === 'command') out.push(this.line('command', { k: this.name(e.by) }, 'info', this.m.piece(e.by).team));
                    if (e.ability === 'tempo' && e.target)
                        out.push(this.line('tempo', { p: this.name(e.by), r: this.name(e.target) }, 'info', this.m.piece(e.by).team));
                    break;
                case 'kick':
                    if (e.kind === 'shot') lastShooter = e.by;
                    break;
                case 'runOnto':
                    if (throughBy)
                        out.push(this.line('through', { p: this.name(throughBy), r: this.name(e.by) }, 'good', this.m.piece(e.by).team));
                    break;
                case 'intercept':
                    if (e.success) {
                        const o = this.m.piece(e.by);
                        out.push(this.line(e.block ? 'block' : 'intercept', { o: o.player.name }, 'info', o.team));
                    }
                    break;
                case 'tackle': {
                    const o = this.m.piece(e.by);
                    const p = this.m.piece(e.on);
                    if (e.success)
                        out.push(this.line(e.reaction ? 'steal' : 'tackle', { o: o.player.name, p: p.player.name }, 'info', o.team));
                    else if (e.reaction) out.push(this.line('dribble', { o: o.player.name, p: p.player.name }, 'good', p.team));
                    else out.push(this.line('missedTackle', { o: o.player.name, p: p.player.name }, 'info', p.team));
                    break;
                }
                case 'trick':
                    if (e.success)
                        out.push(this.line('trick', { p: this.name(e.by), o: this.name(e.on) }, 'good', this.m.piece(e.by).team));
                    break;
                case 'save': {
                    const k = this.m.piece(e.by);
                    out.push(
                        this.line(
                            e.held ? 'save' : 'parry',
                            { k: k.player.name, p: lastShooter ? this.name(lastShooter) : '슈터' },
                            'big',
                            k.team,
                            e.held ? '슈퍼 세이브' : '쳐냄',
                        ),
                    );
                    break;
                }
                case 'wide':
                    if (lastShooter) out.push(this.line('wide', { p: this.name(lastShooter) }, 'info', e.team));
                    break;
                case 'foul': {
                    const v = { o: this.name(e.by), p: this.name(e.on), r: this.m.state.referee.name };
                    const k = e.penalty ? 'penalty' : e.advantage ? 'advantage' : e.tackle ? 'tackleFoul' : 'foul';
                    // a plain free kick (the set-piece ones announce themselves with their own event)
                    const fk = !e.penalty && !e.advantage && !events.some((x) => x.t === 'setpiece');
                    out.push(
                        this.line(
                            k,
                            v,
                            e.penalty ? 'big' : 'info',
                            this.m.piece(e.on).team,
                            e.penalty ? '페널티' : fk ? '프리킥' : undefined,
                        ),
                    );
                    break;
                }
                case 'card':
                    out.push(
                        this.line(
                            e.card === 'red' ? 'red' : 'yellow',
                            { o: this.name(e.on) },
                            e.card === 'red' ? 'big' : 'info',
                            this.m.piece(e.on).team,
                            e.card === 'red' ? '퇴장' : undefined,
                        ),
                    );
                    break;
                case 'header':
                    lastShooter = e.by;
                    break;
                case 'goal': {
                    const p = this.name(e.scorer);
                    const v = { p, team: this.teamName(e.team), a: assist ? this.name(assist) : '' };
                    const headed = events.some((x) => x.t === 'header');
                    const pen = events.some((x) => x.t === 'foul' && x.penalty);
                    const key = pen ? 'goalPen' : headed ? 'goalHeader' : assist ? 'goalAssist' : 'goal';
                    out.push(this.line(key, v, 'big', e.team, '골'));
                    break;
                }
                case 'timeout':
                    out.push(this.line('timeout', { p: this.name(e.id) }, 'info', this.m.piece(e.id).team));
                    break;
                case 'halftime':
                    out.push(this.line('halftime', { s: this.scoreline() }, 'big', null));
                    break;
                case 'fulltime':
                    out.push(this.line('fulltime', { s: this.scoreline() }, 'big', null));
                    break;
            }
        }
        return out;
    }
}

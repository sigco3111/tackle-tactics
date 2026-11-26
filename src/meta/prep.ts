/**
 * Match prep: before a career fixture you read the opponent, pick a game plan and give a team
 * talk. The plan drives your auto-managed players and can out-think the opponent's style
 * (a morale edge for the match); the talk moves the squad's mood. Derbies against the club's
 * rival raise the stakes both ways.
 */
import type { GameConfig, TeamStyle } from '../config';
import { NATIONS } from '../world/nations';
import { leagueName } from '../world/leagues';
import { styleOf } from '../ai/brain';
import { pickReferee } from '../engine/match';
import { createRng } from '../rng';
import type { Referee } from '../types';
import { rollConditions, type Conditions } from '../world/stadium';
import { stadiumOf, table, type Career, type Fixture, cupOfFixture } from './career';
import { CUP_NAME, isCupFixture } from './cup';
import { moraleLabel, rivalOf, shiftMorale, story } from './story';

export type TeamTalk = 'calm' | 'fire' | 'demand';
export type Prep = { fixtureId: string; plan: TeamStyle; talk: TeamTalk; referee: Referee; conditions: Conditions; applied?: boolean };

/** Rock-paper-scissors between styles; Balanced neither counters nor is countered. */
export const COUNTERS: Record<TeamStyle, TeamStyle | null> = {
    press: 'possession',
    possession: 'deep',
    deep: 'direct',
    direct: 'press',
    balanced: null,
};
export const planEdge = (mine: TeamStyle, theirs: TeamStyle) => (COUNTERS[mine] === theirs ? 1 : COUNTERS[theirs] === mine ? -1 : 0);

export const TALKS: Record<TeamTalk, { label: string; note: string }> = {
    calm: { label: '침착하게', note: '분위기를 안정시킵니다. 역효과가 없습니다.' },
    fire: { label: '투지를 불태워라', note: '큰 상승효과. 하지만 이미 들뜬 선수단은 과열될 수 있습니다.' },
    demand: { label: '더 요구한다', note: '자신감 있는 선수단에는 통하고, 불안한 선수단에는 상처가 됩니다.' },
};

const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};

export { rivalOf };
export const isDerby = (c: Career, f: Fixture) => {
    const r = rivalOf(c);
    return !!r && (f.home === r.id || f.away === r.id) && (f.home === c.userClubId || f.away === c.userClubId);
};

/** The opponent in a fixture involving the user. */
export const opponentOf = (c: Career, f: Fixture) => c.clubs[f.home === c.userClubId ? f.away : f.home]!;

/** Prep for this fixture (created on first look, then stable until kick-off). */
export const prepFor = (cfg: GameConfig, c: Career, f: Fixture): Prep => {
    const holder = c as Career & { prep?: Prep };
    if (holder.prep?.fixtureId !== f.id) {
        const seed = hash(`${c.seed}-${f.id}`);
        const home = c.clubs[f.home]!;
        holder.prep = {
            fixtureId: f.id,
            plan: holder.prep?.plan ?? c.clubs[c.userClubId]!.style ?? 'balanced',
            talk: 'calm',
            referee: pickReferee(cfg, seed),
            conditions: rollConditions(createRng(seed), stadiumOf(c, home)),
        };
    }
    return holder.prep!;
};

/** Morale edge for the match itself (added to the club's morale on the board). */
export const matchEdge = (cfg: GameConfig, c: Career, f: Fixture, p: Prep) =>
    planEdge(p.plan, styleOf(opponentOf(c, f))) * cfg.career.prep.edge + (isDerby(c, f) ? cfg.career.prep.derbyLift : 0);

/** Apply the team talk once, at kick-off. Returns the news line. */
export const applyTalk = (cfg: GameConfig, c: Career, f: Fixture, p: Prep, rng: () => number): string => {
    if (p.applied) return '';
    p.applied = true;
    const t = cfg.career.prep.talk;
    const m = story(c).morale;
    const derby = isDerby(c, f) ? ' (더비를 앞두고)' : '';
    switch (p.talk) {
        case 'calm': {
            const d = Math.sign(60 - m) * Math.min(Math.abs(60 - m), t.calm);
            shiftMorale(c, d);
            return `차분한 한마디${derby}. 선수단이 안정됩니다.`;
        }
        case 'fire':
            if (m >= t.overheatAt && rng() < t.overheatChance) {
                shiftMorale(c, t.overheat);
                return `선수단을 독려했지만${derby} 이미 끓어오르던 상태였습니다. 머릿속이 조금 복잡해졌습니다.`;
            }
            shiftMorale(c, t.fire);
            return `천둥 같은 팀 토크${derby}. 선수들이 당장 나가고 싶어 합니다.`;
        case 'demand':
            if (m >= 55) {
                shiftMorale(c, t.demandUp);
                return `더 높은 수준을 요구했고${derby} 선수단이 그에 응답했습니다.`;
            }
            shiftMorale(c, t.demandDown);
            return `더 높은 수준을 요구했지만${derby} 불안한 선수단은 받아들이지 못했습니다.`;
    }
};

const ordinal = (n: number) => `${n}위`;

/** The story of a career fixture, for the pre-match intro: derby, table, form, mood, the plan. */
export const storyLines = (cfg: GameConfig, c: Career, f: Fixture, p: Prep): string[] => {
    const u = c.clubs[c.userClubId]!;
    const opp = opponentOf(c, f);
    const div = c.divisions.find((d) => d.clubs.includes(u.id));
    const lines: string[] = [];
    if (isDerby(c, f)) lines.push(`더비입니다. ${opp.name}. 마을은 일주일 내내 이 얘기뿐이었습니다.`);
    if (isCupFixture(f)) {
        const cup = cupOfFixture(c, f);
        const round = cup?.rounds[f.round];
        const where =
            cup?.key === 'intl'
                ? `${opp.name}은(는) ${NATIONS[opp.nation].adjective} 1부 리그 상대입니다.`
                : `${opp.name}은(는) ${leagueName(opp.nation, opp.tier)} 소속입니다.`;
        lines.push(`${cup?.name ?? CUP_NAME}${round ? ` · ${round.label}` : ''}. ${where} 무승부면 승부차기입니다.`);
    } else if (div) {
        const rows = table(div);
        const pos = (id: string) => rows.findIndex((r) => r.club === id) + 1;
        const played = rows.find((r) => r.club === u.id)?.p ?? 0;
        if (played > 0)
            lines.push(
                `${u.name} ${ordinal(pos(u.id))}, ${opp.name} ${ordinal(pos(opp.id))}. ${pos(u.id) <= 2 ? '승격권입니다. 지켜 내세요.' : pos(u.id) >= rows.length - 1 ? '강등권입니다. 승점이 전부입니다.' : '지금부터는 모든 승점이 소중합니다.'}`,
            );
        else lines.push(`시즌 첫 경기입니다. 모두가 0에서 시작합니다.`);
        const form = (id: string) =>
            div.fixtures
                .filter((x) => x.result && (x.home === id || x.away === id))
                .slice(-5)
                .map((x) => {
                    const [gh, ga] = x.result!;
                    const [mine, theirs] = x.home === id ? [gh, ga] : [ga, gh];
                    return mine > theirs ? '승' : mine === theirs ? '무' : '패';
                })
                .join('');
        if (form(u.id) || form(opp.id)) lines.push(`최근 폼: ${u.short} ${form(u.id) || '—'} · ${opp.short} ${form(opp.id) || '—'}.`);
    }
    lines.push(`선수단 분위기: ${moraleLabel(story(c).morale)}.`);
    const theirs = styleOf(opp);
    const edge = planEdge(p.plan, theirs);
    lines.push(
        `플랜: ${cfg.ai.styles[p.plan].label}으로 상대의 ${cfg.ai.styles[theirs].label}에 맞섭니다${edge > 0 ? '. 상대에게 치명적일 겁니다.' : edge < 0 ? '. 위험한 선택입니다.' : '.'}`,
    );
    return lines;
};

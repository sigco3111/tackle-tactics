import type { Rng } from '../rng';
import type { TeamSide } from '../types';
import type { Fixture } from './career';

/** The domestic knockout, open to every club in the manager's pyramid. */
export const CUP_NAME = '피라미드 컵';
/** The international knockout: the best two clubs of every nation's top flight. */
export const INTL_CUP_NAME = '챔피언스 컵';

export type CupKey = 'cup' | 'intl';
export type CupFixture = Fixture & { competition: 'cup'; penalties?: [number, number] };
export type CupRound = { day: number; label: string; fixtures: CupFixture[]; byes: string[] };
export type Cup = { key: CupKey; name: string; rounds: CupRound[]; champion?: string };

export const isCupFixture = (f: Fixture): f is CupFixture => 'competition' in f && f.competition === 'cup';

export const fixtureForClub = <F extends Fixture>(fixtures: readonly F[], club: string) =>
    fixtures.find((f) => f.home === club || f.away === club);

const draw = (key: CupKey, clubs: readonly string[], rng: Rng, season: number, round: number, byeCount = 0) => {
    const ids = [...clubs];
    for (let i = ids.length - 1; i > 0; i--) {
        const j = rng.int(0, i);
        [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    const byes = ids.splice(0, byeCount);
    const fixtures = Array.from({ length: ids.length / 2 }, (_, i): CupFixture => ({
        competition: 'cup',
        id: `s${season}-${key}-r${round}-${i}`,
        round,
        home: ids[2 * i]!,
        away: ids[2 * i + 1]!,
    }));
    return { fixtures, byes };
};

const roundLabel = (size: number) => {
    if (size === 2) return '결승';
    if (size === 4) return '준결승';
    if (size === 8) return '8강';
    return `${size}강`;
};

/** A knockout for `clubs`; round days are set by the career calendar (see scheduleSeason). */
export const createCup = (key: CupKey, name: string, rng: Rng, season: number, clubs: string[]): Cup => {
    const count = Math.ceil(Math.log2(clubs.length));
    const fullSize = 2 ** count;
    const byes = fullSize - clubs.length;
    const rounds = Array.from({ length: count }, (_, index): CupRound => ({
        day: 0,
        label: index === 0 && byes ? '예선 라운드' : roundLabel(fullSize / 2 ** index),
        fixtures: [],
        byes: [],
    }));
    if (rounds[0]) Object.assign(rounds[0], draw(key, clubs, rng, season, 0, byes));
    return { key, name, rounds };
};

export const cupWinner = (f: CupFixture): string | undefined => {
    const result = f.penalties ?? f.result;
    if (!result || result[0] === result[1]) return;
    return result[0] > result[1] ? f.home : f.away;
};

/** Five penalties each, followed by sudden death. Goals stay separate from the match score. */
export const recordCupScore = (rng: Rng, f: CupFixture, score: [number, number]) => {
    f.result = score;
    if (score[0] !== score[1]) return;
    const kick = () => Number(rng.chance(0.75));
    const penalties: [number, number] = [0, 0];
    for (let i = 0; i < 5 || penalties[0] === penalties[1]; i++) {
        penalties[0] += kick();
        penalties[1] += kick();
    }
    f.penalties = penalties;
};

export const advanceCup = (cup: Cup, round: CupRound, rng: Rng, season: number) => {
    const winners = round.fixtures.map(cupWinner);
    if (!winners.every((id) => id !== undefined)) return;
    const qualifiers = [...round.byes, ...winners];
    const index = cup.rounds.indexOf(round) + 1;
    const next = cup.rounds[index];
    if (next) {
        Object.assign(next, draw(cup.key, qualifiers, rng, season, index));
        return next;
    }
    cup.champion = qualifiers[0];
};

export const penaltyScore = (f: Fixture, side: TeamSide = 0) =>
    isCupFixture(f) && f.penalties ? `${f.penalties[side]}–${f.penalties[side === 0 ? 1 : 0]} 승부차기` : '';

/** Which competition a cup fixture belongs to (its id carries the cup's key). */
export const cupKeyOf = (f: Fixture): CupKey | null => (isCupFixture(f) ? (f.id.includes('-intl-') ? 'intl' : 'cup') : null);

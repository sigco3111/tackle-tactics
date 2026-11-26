import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../src/config';
import { createRng } from '../src/rng';
import type { Club } from '../src/types';
import { MatchController, type SimLine } from '../src/ui/controller';
import { generateClub } from '../src/world/generate';

const controller = (seed: number) => {
    const rng = createRng(seed);
    const names = new Set<string>();
    const clubs: [Club, Club] = [
        generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', '4-3-3', names),
        generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', '4-4-2', names),
    ];
    return new MatchController(cfg, clubs, { controllers: ['human', 'ai'], difficulty: 'normal', seed });
};

describe('live simulation', () => {
    it('plays a whole match on the engine and narrates it play by play', () => {
        const ctl = controller(3);
        const lines: SimLine[] = [];
        for (let turns = 0; !ctl.match.state.over && turns < 5000; turns++) lines.push(...ctl.simTurn());
        expect(ctl.match.state.over).toBe(true);
        const kinds = new Set(lines.map((l) => l.kind));
        for (const k of ['pass', 'shot', 'talk', 'period'] as const) expect(kinds.has(k)).toBe(true);
        // the feed's goals match the scoreboard, and the stats saw the same match
        const [a, b] = ctl.match.state.score;
        expect(lines.filter((l) => l.kind === 'goal')).toHaveLength(a + b);
        expect(ctl.stats.goals).toHaveLength(a + b);
        expect(lines.some((l) => l.kind === 'period' && /경기 종료/.test(l.text))).toBe(true);
    });

    it('finishes a match already under way', () => {
        const ctl = controller(4);
        for (let i = 0; i < 120; i++) ctl.simTurn();
        const round = ctl.match.state.round;
        expect(round).toBeGreaterThan(1);
        while (!ctl.match.state.over) ctl.simTurn();
        expect(ctl.match.state.round).toBeGreaterThanOrEqual(round);
    });
});

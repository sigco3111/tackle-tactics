import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../src/config';
import { Match } from '../src/engine/match';
import { createRng } from '../src/rng';
import { generateClub } from '../src/world/generate';

const setup = () => {
    const rng = createRng(8);
    const names = new Set<string>();
    const a = generateClub(cfg, rng, 'home', 'blue', 'keeper_pink', '4-3-3', names);
    const b = generateClub(cfg, rng, 'away', 'yellow', 'keeper_black', '4-4-2', names);
    return new Match(cfg, [a, b], 8);
};

describe('substitutions', () => {
    it('swap a player for a bench player on the same cell and turn slot', () => {
        const m = setup();
        const off = m.state.pieces.find((p) => p.team === 0 && p.player.cls === 'midfielder' && p.id !== m.active().id)!;
        const on = m.bench(0).find((p) => p.cls !== 'keeper')!;
        const at = { ...off.pos };
        const slot = m.state.order.indexOf(off.id);
        expect(m.subBlock(0, off.id, on.id)).toBeNull();
        expect(m.substitute(0, off.id, on.id)).toEqual([{ t: 'sub', team: 0, off: off.id, on: on.id }]);
        const piece = m.piece(on.id);
        expect(piece.pos).toEqual(at);
        expect(piece.stamina).toBe(100);
        expect(m.state.order[slot]).toBe(on.id);
        expect(m.subsLeft(0)).toBe(cfg.subs.max - 1);
        expect(m.bench(0).some((p) => p.id === on.id)).toBe(false);
    });

    it('keepers only swap with keepers', () => {
        const m = setup();
        const keeper = m.keeperOf(0)!;
        const outfielder = m.bench(0).find((p) => p.cls !== 'keeper')!;
        expect(m.subBlock(0, keeper.id, outfielder.id)).toMatch(/골키퍼/);
    });

    it('waiting for the ball to move on is a timing reason, not a lasting one', () => {
        const m = setup();
        const carrier = m.carrier()!;
        const on = m.bench(carrier.team).find((p) => (p.cls === 'keeper') === (carrier.player.cls === 'keeper'))!;
        expect(m.subBlock(carrier.team, carrier.id, on.id)).toBe('공을 가진 선수는 교체할 수 없습니다');
        // a queued change only checks the lasting reasons
        expect(m.subBlock(carrier.team, carrier.id, on.id, false)).toBeNull();
    });
});

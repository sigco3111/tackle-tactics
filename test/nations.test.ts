import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../src/config';
import { newCareer } from '../src/meta/career';
import { createRng } from '../src/rng';
import { NATION_IDS, NATIONS } from '../src/world/nations';

const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };

describe('nations', () => {
    it('every nation can name a whole pyramid with distinct towns', () => {
        for (const id of NATION_IDS) {
            const places = NATIONS[id].places(createRng(1));
            expect(new Set(places).size).toBe(places.length);
            expect(places.length).toBeGreaterThanOrEqual(cfg.career.divisions * cfg.career.clubsPerDivision);
        }
    });

    it('names are printable: Hangul syllables, Latin-1 club abbreviations and digits only', () => {
        for (const id of NATION_IDS) {
            const rng = createRng(3);
            const n = NATIONS[id];
            const text = [
                ...n.places(rng),
                ...Array.from({ length: 200 }, () => n.playerName(rng)),
                ...n.places(rng).map((p) => n.clubName(rng, p)),
            ].join(' ');
            expect(`${id}: ${text}`).toMatch(/^[a-z]+: [\u0020-\u00ff\uac00-\ud7a3]*$/);
        }
    });

    it('a career is set in the chosen nation: local clubs, mostly local players, a market from everywhere', () => {
        const c = newCareer(cfg, 7, settings, { nation: 'nordhavn' });
        expect(c.nation).toBe('nordhavn');
        const players = Object.values(c.clubs).flatMap((club) => club.squad);
        expect(players.every((p) => p.nation)).toBe(true);
        // every club, at home or abroad, is mostly its own nation's players
        const clubs = Object.values(c.clubs);
        const local = clubs.flatMap((club) => club.squad.map((p) => p.nation === club.nation)).filter(Boolean).length / players.length;
        expect(local).toBeGreaterThan(0.7);
        expect(local).toBeLessThan(0.9);
        // the manager's pyramid is the chosen nation; every other nation has a full pyramid too
        expect(c.divisions.flatMap((d) => d.clubs).every((id) => c.clubs[id]!.nation === 'nordhavn')).toBe(true);
        expect(Object.keys(c.world)).toHaveLength(NATION_IDS.length - 1);
        for (const pyramid of Object.values(c.world)) expect(pyramid).toHaveLength(cfg.career.divisions);
        expect(new Set(c.market.map((p) => p.nation)).size).toBeGreaterThanOrEqual(8);
        expect(c.market.length).toBe(cfg.career.market.size);
    });
});

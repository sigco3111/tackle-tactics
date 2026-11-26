import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../src/config';
import {
    careerRng,
    expandGround,
    groundUpgrade,
    newCareer,
    playMatchday,
    simulateScore,
    stadiumOf,
    today,
    trainingDay,
    userClub,
} from '../src/meta/career';

const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };
const look = { name: 'Riverside Park', pattern: 'checker' as const, bands: 12, condition: 'frost' as const, flag: 'checked' as const };

describe('starting division and the ground', () => {
    it('starts in the chosen division with the chosen ground', () => {
        const c = newCareer(cfg, 41, settings, { tier: 1, ground: { look, size: 'grand' } });
        const u = userClub(c);
        expect(u.tier).toBe(1);
        expect(u.budget).toBe(cfg.career.startingBudget[1]);
        const st = stadiumOf(c, u);
        expect(st).toMatchObject({ ...look, size: 'grand', capacity: cfg.career.ground.grand.capacity, fans: 'home' });
    });

    it('a ground bigger than the division allows falls back to what it does allow', () => {
        const c = newCareer(cfg, 42, settings, { ground: { look: { ...look, name: '' }, size: 'grand' } });
        const st = stadiumOf(c, userClub(c));
        expect(st.size).toBe('village');
        // an empty name gets one from the club's town
        expect(st.name.length).toBeGreaterThan(3);
    });

    it('home matches pay gate receipts', () => {
        const c = newCareer(cfg, 43, settings);
        for (let guard = 0; guard < 40; guard++) {
            const t = today(cfg, c);
            if (t.kind === 'match' && t.fixture.home === c.userClubId) {
                const rng = careerRng(c);
                const score = simulateScore(cfg, rng, c, t.fixture);
                c.rngState = rng.state();
                playMatchday(cfg, c, { score, knocks: {}, played: userClub(c).lineup });
                break;
            }
            if (t.kind === 'match') {
                const rng = careerRng(c);
                playMatchday(cfg, c, { score: simulateScore(cfg, rng, c, t.fixture), knocks: {}, played: userClub(c).lineup });
                c.rngState = rng.state();
            } else trainingDay(cfg, c);
        }
        expect(c.ledger.some((l) => l.label.startsWith('입장 수입') && l.amount > 0)).toBe(true);
    }, 60_000);

    it('expanding needs the division and the money, then costs it', () => {
        const c = newCareer(cfg, 44, settings);
        const u = userClub(c);
        expect(groundUpgrade(cfg, c)).toMatchObject({ size: 'town', blocked: expect.stringContaining('League Two') });
        expect(expandGround(cfg, c)).toContain('League Two');
        u.tier = 3;
        u.budget = 100_000;
        expect(groundUpgrade(cfg, c)!.blocked).toMatch(/필요/);
        u.budget = 1_000_000;
        expect(expandGround(cfg, c)).toBeNull();
        expect(stadiumOf(c, u)).toMatchObject({ size: 'town', capacity: cfg.career.ground.town.capacity });
        expect(u.budget).toBe(1_000_000 - cfg.career.ground.town.cost);
    });
});

import { describe, expect, it } from 'vitest';
import { defaultConfig as cfg } from '../src/config';
import { abilitiesOf, classLevel, passivesOf, pendingPerks } from '../src/engine/abilities';
import { chooseLevelUp, choosePerk, newCareer, userClub } from '../src/meta/career';
import { autoLevel, gainXp, levelsReady, levelUp, levelUpOptions, xpToNext } from '../src/meta/player';
import { createRng } from '../src/rng';
import type { Player } from '../src/types';
import { generatePlayer } from '../src/world/generate';

const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };
const winger = (seed = 1): Player => {
    const p = generatePlayer(cfg, createRng(seed), 'winger', '', 7, `w${seed}`, { levelRange: [1, 1] });
    p.levels = { winger: 1 };
    p.level = 1;
    p.perks = [];
    p.xp = 0;
    return p;
};

describe('progression', () => {
    it('XP is banked; nothing levels up until a class is chosen', () => {
        const p = winger();
        const need = xpToNext(cfg, p);
        expect(gainXp(cfg, p, need - 1)).toBe(false);
        expect(gainXp(cfg, p, 1)).toBe(true);
        expect(p.level).toBe(1);
        expect(levelsReady(cfg, p)).toBe(1);
        // the manager can put the level into a brand-new outfield class
        expect(levelUp(cfg, createRng(2), p, 'striker')).toBe(true);
        expect(p.levels).toEqual({ winger: 1, striker: 1 });
        expect(p.xp).toBe(0);
        expect(levelUp(cfg, createRng(2), p, 'winger')).toBe(false);
    });

    it('keepers stay keepers; outfielders can take any outfield class', () => {
        const k = generatePlayer(cfg, createRng(3), 'keeper', '', 1, 'k');
        expect(levelUpOptions(k)).toEqual(['keeper']);
        expect(levelUpOptions(winger()).sort()).toEqual(['defender', 'midfielder', 'striker', 'winger']);
    });

    it('a perk tier offers two options; the pick stays and the other is gone', () => {
        const p = winger();
        p.xp = 10_000;
        levelUp(cfg, createRng(4), p, 'winger');
        expect(classLevel(p, 'winger')).toBe(2);
        expect(pendingPerks(cfg, p)).toEqual([{ cls: 'winger', level: 2, options: ['sprint', 'trick'] }]);
        expect(abilitiesOf(cfg, p)).toEqual([]);
        p.perks!.push('trick');
        expect(pendingPerks(cfg, p)).toEqual([]);
        expect(abilitiesOf(cfg, p)).toContain('trick');
        expect(abilitiesOf(cfg, p)).not.toContain('sprint');
    });

    it('AI players level in their main class and pick perks themselves', () => {
        const p = winger(5);
        p.xp = 10_000;
        const n = autoLevel(cfg, createRng(6), p);
        expect(n).toBeGreaterThan(3);
        expect(Object.keys(p.levels)).toEqual(['winger']);
        expect(pendingPerks(cfg, p)).toEqual([]);
        expect(abilitiesOf(cfg, p).length + passivesOf(cfg, p).length).toBe(
            cfg.perkTiers.winger.filter((t) => t.level <= p.levels.winger!).length,
        );
    });

    it('generated players come with different picks (variety across the league)', () => {
        const sets = new Set<string>();
        for (let s = 0; s < 30; s++) {
            const p = generatePlayer(cfg, createRng(100 + s), 'winger', '', 7, `g${s}`, { levelRange: [8, 8] });
            sets.add([...abilitiesOf(cfg, p), ...passivesOf(cfg, p)].sort().join('+'));
        }
        expect(sets.size).toBeGreaterThan(1);
    });

    it('the manager chooses the class and perk through the career', () => {
        const c = newCareer(cfg, 9, settings);
        const p = userClub(c).squad.find((q) => q.cls !== 'keeper')!;
        p.xp = xpToNext(cfg, p);
        const cls = levelUpOptions(p).find((x) => classLevel(p, x) === 0)!;
        expect(chooseLevelUp(cfg, c, p.id, cls)).toMatch(/새 포지션/);
        expect(classLevel(p, cls)).toBe(1);
        // reach the first tier in that class and pick from it
        p.xp = 10_000;
        chooseLevelUp(cfg, c, p.id, cls);
        const tier = pendingPerks(cfg, p).find((t) => t.cls === cls)!;
        expect(choosePerk(cfg, c, p.id, tier.options[1]!)).toMatch(/learns/);
        expect(choosePerk(cfg, c, p.id, tier.options[0]!)).toBeNull();
    });
});

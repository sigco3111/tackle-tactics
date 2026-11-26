/**
 * Squad training: eight drills, one per attribute. The manager picks two a day. Every class has
 * three core attributes; a player's fit is how many of the two drills hit their class's core,
 * and fit scales the XP. Each drill also has a small chance to lift its attribute directly.
 */
import type { ClassId, GameConfig, StatId } from '../config';
import { classLevel } from '../engine/abilities';
import type { Rng } from '../rng';
import type { Player } from '../types';

export const DRILLS: Record<StatId, { label: string; note: string }> = {
    speed: { label: '속도', note: '스프린트 출발' },
    pace: { label: '주력', note: '장거리 러닝' },
    passing: { label: '패스', note: '론도' },
    shooting: { label: '슈팅', note: '마무리 훈련' },
    dribbling: { label: '드리블', note: '콘 드리블' },
    tackling: { label: '태클', note: '태클 박스' },
    reflexes: { label: '반사신경', note: '반응 선방' },
    composure: { label: '침착성', note: '압박 게임' },
};
export const DRILL_IDS = Object.keys(DRILLS) as StatId[];

/** The two drills of a training day. */
export type Drills = [StatId, StatId];
export const DEFAULT_DRILLS: Drills = ['passing', 'composure'];

export const drillsLabel = (d: Drills) => `${DRILLS[d[0]].label} + ${DRILLS[d[1]].label}`;

/** Pick a drill: it replaces the older of the two (picking one already chosen changes nothing). */
export const pickDrill = (d: Drills, s: StatId): Drills => (d.includes(s) ? d : [d[1], s]);

/** The classes a drill belongs to (its attribute is in their core). */
export const drillClasses = (cfg: GameConfig, s: StatId) =>
    (Object.keys(cfg.training.core) as ClassId[]).filter((cls) => cfg.training.core[cls].includes(s));

const hits = (cfg: GameConfig, cls: ClassId, d: Drills) => d.filter((s) => cfg.training.core[cls].includes(s)).length;

/**
 * How well the drills fit a player, 0..2: hits in their main class's core, or half the hits of
 * another class they have levels in, whichever is better.
 */
export const drillFit = (cfg: GameConfig, p: Player, d: Drills) => {
    let fit = hits(cfg, p.cls, d);
    for (const cls of Object.keys(p.levels) as ClassId[])
        if (cls !== p.cls && classLevel(p, cls) > 0) fit = Math.max(fit, hits(cfg, cls, d) / 2);
    return fit;
};

/** The same forecast drives the squad preview and the session itself. */
export const trainingGain = (cfg: GameConfig, p: Player, d: Drills) => {
    if (p.injury) return null;
    const { xp, fit: mult } = cfg.training;
    const fit = drillFit(cfg, p, d);
    const aptitude = Math.max(0, Math.min(1, (p.stats[d[0]] + p.stats[d[1]]) / 200));
    // fit 0 → low, 1 → normal, 2 → high, halves in between
    const m = fit <= 1 ? mult[0] + (mult[1] - mult[0]) * fit : mult[1] + (mult[2] - mult[1]) * (fit - 1);
    return { cls: p.cls, fit, amount: Math.round((xp.base + aptitude * xp.attributes) * m) };
};

/** The drills' direct effect: each may lift its attribute by one point. Returns what went up. */
export const drillStats = (cfg: GameConfig, rng: Rng, p: Player, d: Drills): StatId[] => {
    const up: StatId[] = [];
    for (const s of d) {
        if (p.stats[s] >= cfg.world.statCeil || rng() >= cfg.training.statChance) continue;
        p.stats[s] += 1;
        up.push(s);
    }
    return up;
};

/**
 * Grounds and matchday conditions. A club's stadium is generated once from a seed (its size
 * leaning on the division), the conditions are rolled per match. Pure data: the match view
 * draws it, the config turns weather into a small gameplay effect.
 */
import { createRng, type Rng } from '../rng';

export type StadiumSize = 'village' | 'town' | 'city' | 'grand';
export type MowPattern = 'stripes' | 'checker' | 'hoops' | 'plain';
export type PitchCondition = 'lush' | 'dry' | 'muddy' | 'frost';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'snow' | 'fog';

export type Stadium = {
    name: string;
    size: StadiumSize;
    capacity: number;
    /** 0..1 how full the stands usually are. */
    fill: number;
    fans: 'home' | 'away' | 'mixed';
    pattern: MowPattern;
    /** Bands for stripes/hoops. */
    bands: number;
    condition: PitchCondition;
    /** 0..1 how worn the goalmouths and centre circle are. */
    wear: number;
    flag: 'red' | 'yellow' | 'checked';
};

export type Conditions = { time: TimeOfDay; weather: Weather };

/** Name suffixes fit the ground: nobody calls a village meadow a "Stadium". */
const SUFFIX: Record<StadiumSize, string[]> = {
    village: ['초원구장', '그린구장', '필드', '레인 구장', '공원구장', '폴드 구장', '피치'],
    town: ['파크', '그라운드', '레인 구장', '필드', '로드 구장', '폴드 구장'],
    city: ['파크', '그라운드', '스타디움', '로드 구장', '아레나'],
    grand: ['아레나', '스타디움', '볼 경기장', '콜로세움', '파크'],
};
const SIZE_INFO: Record<StadiumSize, { tiers: number; cap: [number, number] }> = {
    village: { tiers: 0, cap: [400, 1500] },
    town: { tiers: 1, cap: [2500, 8000] },
    city: { tiers: 2, cap: [9000, 24000] },
    grand: { tiers: 3, cap: [30000, 60000] },
};
export const standTiers = (s: Stadium) => SIZE_INFO[s.size].tiers;

const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};

/** Divisions 0 (top) .. 4 (bottom) lean towards bigger or smaller grounds; undefined = anything. */
export const generateStadium = (
    seedKey: string,
    place: string,
    tier?: number,
    force: { size?: StadiumSize; condition?: PitchCondition } = {},
): Stadium => {
    const rng = createRng(hash(seedKey));
    const sizes: StadiumSize[] = ['village', 'town', 'city', 'grand'];
    // bottom division: villages and towns · middle: towns and cities · top: cities and grand stadiums
    const lean = tier === undefined ? rng.int(0, 3) : Math.max(0, Math.min(3, Math.round((4 - tier) * 0.75) + rng.int(0, 1)));
    const size = force.size ?? sizes[Math.max(0, Math.min(3, lean))]!;
    const info = SIZE_INFO[size];
    const nameStyle = rng();
    const name =
        nameStyle < 0.7
            ? `${place} ${rng.pick(SUFFIX[size])}`
            : `${rng.pick(['올드', '뉴', '로열', '로어', '어퍼'])} ${rng.pick(SUFFIX[size])}`;
    return {
        name,
        size,
        capacity: Math.round(rng.int(info.cap[0], info.cap[1]) / 100) * 100,
        fill: Math.min(1, 0.35 + rng() * 0.65),
        fans: rng.pick(['home', 'home', 'mixed', 'away'] as const),
        pattern: rng.pick(['stripes', 'stripes', 'stripes', 'checker', 'hoops', 'plain'] as const),
        bands: rng.pick([8, 10, 10, 12, 14]),
        condition: force.condition ?? rng.pick(['lush', 'lush', 'lush', 'dry', 'muddy', 'frost'] as const),
        wear: Math.round(rng() * 100) / 100,
        flag: rng.pick(['red', 'yellow', 'checked'] as const),
    };
};

/** Roll the matchday conditions; a frosty ground likes snow, a muddy one rain. */
export const rollConditions = (rng: Rng, st: Stadium, force: Partial<Conditions> = {}): Conditions => {
    const time = rng.pick(['day', 'day', 'day', 'dusk', 'night', 'night'] as const);
    let weather: Weather = rng.pick(['clear', 'clear', 'clear', 'clear', 'rain', 'fog'] as const);
    if (st.condition === 'frost' && rng.chance(0.5)) weather = 'snow';
    if (st.condition === 'muddy' && rng.chance(0.4)) weather = 'rain';
    return { time: force.time ?? time, weather: force.weather ?? weather };
};

export const conditionsLabel = (c: Conditions) =>
    `${{ day: '오후', dusk: '해질녘', night: '조명 아래 밤' }[c.time]} · ${{ clear: '맑음', rain: '비', snow: '눈', fog: '안개' }[c.weather]}`;

export const sizeLabel = (s: StadiumSize) =>
    ({ village: '마을 구장', town: '소도시 구장', city: '대도시 스타디움', grand: '대형 스타디움' })[s];

// ------------------------------------------------------------------ the manager's own ground

export const STADIUM_SIZES: StadiumSize[] = ['village', 'town', 'city', 'grand'];
export const MOW_PATTERNS: MowPattern[] = ['stripes', 'checker', 'hoops', 'plain'];
export const PITCH_CONDITIONS: PitchCondition[] = ['lush', 'dry', 'muddy', 'frost'];
export const CORNER_FLAGS: Array<Stadium['flag']> = ['red', 'yellow', 'checked'];

/** What the manager can change about their ground at any time (the size has to be built). */
export type GroundLook = Pick<Stadium, 'name' | 'pattern' | 'bands' | 'condition' | 'flag'>;

export const defaultGroundLook = (place: string): GroundLook => ({
    name: `${place} 초원구장`,
    pattern: 'stripes',
    bands: 10,
    condition: 'lush',
    flag: 'red',
});

/** A ground built to the manager's look: home fans, kept in good nick. */
export const customStadium = (look: GroundLook, size: StadiumSize, capacity: number): Stadium => ({
    ...look,
    name: look.name.trim() || '초원구장',
    size,
    capacity,
    fill: 0.6,
    fans: 'home',
    wear: 0.2,
});

export const patternLabel = (p: MowPattern) => ({ stripes: '줄무늬', checker: '체크', hoops: '가로줄', plain: '단색' })[p];
export const conditionLabel = (c: PitchCondition) => ({ lush: '푸른 잔디', dry: '메마른', muddy: '질척한', frost: '서리 낀' })[c];

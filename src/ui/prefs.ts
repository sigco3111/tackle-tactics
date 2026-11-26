/** Player preferences (display, sound, pacing, guidance). Persisted per browser, applied live. */
import { grain } from '@grainular/grains';

export type FontPreset = 'broadcast' | 'arcade' | 'terminal' | 'clean';
export type AiSpeed = 'fast' | 'normal' | 'slow';
export type RadioPosition = { right: number; bottom: number };
/** Which of your players ask for orders: everyone, those near the ball, or only the key duels. */
export type ControlMode = 'all' | 'near' | 'key';
export type Prefs = {
    /** 1 = default; larger = bigger UI (smaller logical canvas). */
    uiScale: number;
    /** How the 1600×900 stage is scaled to the window: sharp (CSS zoom, laid out at screen size) or
     *  smooth (a transform, drawn once and scaled). Auto: sharp on Linux, whose engine blurs transforms. */
    scaling: 'auto' | 'sharp' | 'smooth';
    font: FontPreset;
    reduceMotion: boolean;
    aiSpeed: AiSpeed;
    controlMode: ControlMode;
    sfxVolume: number;
    crowdVolume: number;
    muted: boolean;
    tips: boolean;
    tipsSeen: string[];
    /** Camera leans in when players crowd the ball. */
    autoZoom: boolean;
    /** Draw zones of control during your turns. */
    showZoc: boolean;
    /** Show the pre-match intro (commentators, ground, line-ups, the story). */
    matchIntro: boolean;
    /** The in-game radio (src/ui/radio.ts). */
    radioOn: boolean;
    radioVolume: number;
    /** During matches: full volume, quieter under the crowd, or silent. */
    radioInMatch: 'on' | 'quiet' | 'off';
    /** Songs switched off in Settings (keyed "Artist - Title", so adding songs doesn't shift them). */
    radioDisabled: string[];
    /** The floating radio player is folded down to its ♫ button. */
    radioCollapsed: boolean;
    /** Radio offsets in logical stage pixels, or null for the default corner. */
    radioPosition: RadioPosition | null;
};

export const UI_SCALES = [0.85, 1, 1.15, 1.3, 1.5];
export const FONTS: Array<{ id: FontPreset; label: string; note: string }> = [
    { id: 'broadcast', label: '방송', note: '압축형 스포츠 제목, 또렷한 본문 (기본)' },
    { id: 'arcade', label: '아케이드', note: '전부 픽셀 글꼴, 레트로 느낌' },
    { id: 'terminal', label: '터미널', note: '레트로 모니터 글자' },
    { id: 'clean', label: '깔끔', note: '가독성 최우선' },
];
export const AI_SPEED: Record<AiSpeed, number> = { fast: 0.45, normal: 1, slow: 1.7 };
export const CONTROL_MODES: Array<{ id: ControlMode; label: string; note: string }> = [
    { id: 'all', label: '전체 선수', note: '매 라운드 11명 모두에게 명령합니다.' },
    {
        id: 'near',
        label: '공 근처',
        note: '공에서 10칸 이내의 선수와 가장 가까운 3명이 명령을 받고, 나머지는 포메이션을 유지합니다.',
    },
    { id: 'key', label: '핵심 대결', note: '공 소유자, 공에서 5칸 이내의 선수, 가장 가까운 3명.' },
];
/** Distance (cells) from the ball inside which a player asks for orders, per mode. */
export const CONTROL_RADIUS: Record<ControlMode, number> = { all: 999, near: 10, key: 5 };
/** However far away the ball is, this many of your closest players still ask for orders. */
export const CONTROL_MIN_NEAREST = 3;

const KEY = 'tackle-tactics:prefs';
const DEFAULTS: Prefs = {
    uiScale: 1,
    scaling: 'auto',
    font: 'broadcast',
    reduceMotion: false,
    aiSpeed: 'normal',
    controlMode: 'near',
    sfxVolume: 0.7,
    crowdVolume: 0.5,
    muted: false,
    tips: true,
    tipsSeen: [],
    autoZoom: true,
    showZoc: true,
    matchIntro: true,
    radioOn: true,
    radioVolume: 0.6,
    radioInMatch: 'quiet',
    radioDisabled: [],
    radioCollapsed: false,
    radioPosition: null,
};

const load = (): Prefs => {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
    } catch {
        return DEFAULTS;
    }
};

export const prefs = grain<Prefs>(load());
prefs.subscribe((p) => {
    try {
        localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
        /* ignore */
    }
});
export const setPref = <K extends keyof Prefs>(k: K, v: Prefs[K]) => prefs.update((p) => ({ ...p, [k]: v }));

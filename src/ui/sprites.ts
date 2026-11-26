import type { GameConfig } from '../config';
import type { Facing, Piece, Player } from '../types';
import { defaultConfig } from '../config';
import { pickHairIndex } from '../world/generate';
import { castUrl } from './castPack';
import { isRecolored, recolored } from './recolor';

/** Keepers and outfielders have different strips; map requests onto what exists. */
const KEEPER_MAP: Record<string, string> = {
    dribble: 'run',
    kick: 'gk_punt',
    pass: 'gk_throw',
    trap: 'gk_catch',
    slide_tackle: 'run',
    fall: 'sad',
    tired: 'idle',
    header: 'gk_punch',
    get_up: 'idle',
    clap: 'gk_ready',
    juggle: 'idle',
};
const OUTFIELD_MAP: Record<string, string> = {
    gk_ready: 'idle',
    gk_hold: 'idle',
    gk_catch: 'trap',
    gk_punch: 'header',
    gk_punt: 'kick',
    gk_throw: 'pass',
};

export const resolveAnim = (p: Piece, anim: string) =>
    p.player.cls === 'keeper' ? (KEEPER_MAP[anim] ?? anim) : (OUTFIELD_MAP[anim] ?? anim);

const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};

/** A player's looks: stored on new players, derived from their id for older saves. */
export const lookOf = (p: Player): { skin: number; hair: number } => {
    if (p.skin !== undefined && p.hair !== undefined) return { skin: p.skin, hair: p.hair };
    const h = hash(p.id);
    return { skin: h % defaultConfig.looks.skinTones, hair: pickHairIndex(defaultConfig.looks.hairWeights, ((h >>> 8) % 1000) / 1000) };
};

export const stripUrl = (sprite: string, anim: string, facing: Facing, player?: Player) => {
    const src = castUrl(`assets/cast/${sprite}/${anim}_${facing}.png`);
    if (!player) return src;
    const l = lookOf(player);
    return recolored(src, l.skin, l.hair);
};

export const spriteStyle = (cfg: GameConfig, sprite: string, anim: string, facing: Facing, player?: Player) => {
    const s = cfg.sprites;
    const frames = cfg.animFrames[anim] ?? 8;
    const R = s.renderPx;
    return [
        `background-image:url(${stripUrl(sprite, anim, facing, player)})`,
        `background-size:${frames * R}px ${R}px`,
        `--strip:${frames * R}px`,
        `--frames:${frames}`,
        `animation-duration:${frames * s.msPerFrame}ms`,
        `animation-timing-function:steps(${frames})`,
        ...(anim === 'fall' || anim === 'get_up' ? ['animation-iteration-count:1'] : []),
    ].join(';');
};

/** Strips worth preparing before kickoff so nobody flickers into their real colours. */
const warmAnims = (keeper: boolean) =>
    keeper
        ? ['gk_ready', 'idle', 'run', 'gk_hold', 'celebrate', 'gk_catch', 'gk_punch', 'gk_punt', 'gk_throw', 'sad']
        : ['idle', 'run', 'dribble', 'celebrate', 'kick', 'slide_tackle', 'pass', 'header', 'trap', 'fall', 'sad', 'tired', 'clap', 'juggle'];
export const prewarmPlayer = (sprite: string, player: Player, keeper: boolean) => {
    for (const a of warmAnims(keeper)) for (const f of ['down', 'left', 'right', 'up'] as Facing[]) stripUrl(sprite, a, f, player);
};

/** Every warm strip of these players is recoloured and decoded (so no first-use gap at kickoff). */
export const warmStripsReady = (players: Array<{ sprite: string; player: Player; keeper: boolean }>, onReady: () => void) => {
    let all = true;
    for (const { sprite, player, keeper } of players) {
        const l = lookOf(player);
        for (const a of warmAnims(keeper))
            for (const f of ['down', 'left', 'right', 'up'] as Facing[]) {
                const src = castUrl(`assets/cast/${sprite}/${a}_${f}.png`);
                const url = stripUrl(sprite, a, f, player);
                if (!isRecolored(src, l.skin, l.hair) || !imageReady(url, onReady)) all = false;
            }
    }
    return all;
};

const readyUrls = new Set<string>();
const loadingUrls = new Set<string>();

/** True once the browser has this image decoded; starts loading it if not, and calls `onReady` when done. */
export const imageReady = (url: string, onReady: () => void) => {
    if (readyUrls.has(url)) return true;
    if (!loadingUrls.has(url)) {
        loadingUrls.add(url);
        const img = new Image();
        const done = () => {
            loadingUrls.delete(url);
            readyUrls.add(url);
            onReady();
        };
        img.addEventListener('load', () => void img.decode().then(done, done));
        // a failed load is not "ready": forget it so the next check retries
        img.addEventListener('error', () => loadingUrls.delete(url));
        img.src = url;
    }
    return false;
};

/** Paint every warm strip once, almost invisibly, so the first real use is not a blank frame while the browser decodes it. */
export const paintWarm = (players: Array<{ sprite: string; player: Player; keeper: boolean }>) => {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;overflow:hidden;display:flex;flex-wrap:wrap;align-content:flex-start;opacity:0.02;pointer-events:none;z-index:2147483647';
    const seen = new Set<string>();
    for (const { sprite, player, keeper } of players)
        for (const a of warmAnims(keeper))
            for (const f of ['down', 'left', 'right', 'up'] as Facing[]) {
                const url = stripUrl(sprite, a, f, player);
                if (seen.has(url)) continue;
                seen.add(url);
                const d = document.createElement('div');
                d.style.cssText = `flex:none;width:12px;height:12px;background:url(${url}) 0 0 / auto 52px no-repeat`;
                box.appendChild(d);
            }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 1500);
};

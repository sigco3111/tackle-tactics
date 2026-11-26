/**
 * Runtime palette swapping for the pack's character sprites.
 *
 * The art uses exact 3-tone ramps (base, shade, highlight) for skin and hair, separate from kit
 * and outline colours. We load a strip once, replace the ramp it uses with the player's ramps on a
 * canvas, and cache the result as an object URL. Requests are async: until a variant is ready the
 * original strip is shown, and `recolorVersion` bumps so views can re-render.
 */
import { grain } from '@grainular/grains';

type Ramp = [string, string, string]; // base, shade, highlight

/** Ramps found in the source art (used to recognise what to replace). */
const SOURCE_SKIN: Ramp[] = [
    ['e8b496', 'c98f74', 'f6d2b6'],
    ['dba37c', 'b8805f', 'efc29c'],
    ['c08660', '9a6446', 'd9a47a'],
    ['9e6a4a', '7a4c34', 'b98462'],
    ['7e523c', '5a382a', '9a6a4e'],
];
const SOURCE_HAIR: Ramp[] = [
    ['38323f', '262230', '4e4658'],
    ['6a4834', '4e3428', '8a6248'],
    ['c09a52', '93703a', 'e0c27a'],
    ['8e4632', '6a3226', 'ad6248'],
];

/** Target palettes. Skin spans light to deep; hair is mostly natural with a few rare fantasy dyes. */
export const SKIN_TONES: Ramp[] = [
    ['f3c9ad', 'd9a68a', 'fde2cf'],
    ['e8b496', 'c98f74', 'f6d2b6'],
    ['dba37c', 'b8805f', 'efc29c'],
    ['c08660', '9a6446', 'd9a47a'],
    ['a8714e', '86553a', 'c28b66'],
    ['9e6a4a', '7a4c34', 'b98462'],
    ['7e523c', '5a382a', '9a6a4e'],
    ['6a412e', '4a2b1f', '86563f'],
    ['4e3024', '36201a', '6a4232'],
];
export const HAIR_COLORS: Ramp[] = [
    ['38323f', '262230', '4e4658'],
    ['4a3426', '33231a', '644634'],
    ['6a4834', '4e3428', '8a6248'],
    ['8e4632', '6a3226', 'ad6248'],
    ['c8642a', '9a4a1c', 'e2843e'],
    ['c09a52', '93703a', 'e0c27a'],
    ['e6dcb8', 'bdb08c', 'f8f2dc'],
    ['9a9aa4', '74747e', 'b8b8c2'],
    // rare dyes (fantasy league: anything goes)
    ['3a7ac8', '28569a', '5c9ae0'],
    ['8a4ac0', '663290', 'a86ad8'],
];

export const recolorVersion = grain(0);

const cache = new Map<string, string>();
const pending = new Set<string>();
let bumpQueued = false;

const hex = (h: string) => [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] as const;
const key24 = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

const bump = () => {
    if (bumpQueued) return;
    bumpQueued = true;
    requestAnimationFrame(() => {
        bumpQueued = false;
        recolorVersion.update((n) => n + 1);
    });
};

/** Build the colour map for a strip: whichever source ramps it uses → the requested targets. */
const buildMap = (data: Uint8ClampedArray, skin: Ramp, hair: Ramp) => {
    const present = new Set<number>();
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]) present.add(key24(data[i]!, data[i + 1]!, data[i + 2]!));
    const map = new Map<number, readonly [number, number, number]>();
    const add = (sources: Ramp[], target: Ramp) => {
        for (const src of sources) {
            if (!present.has(key24(...hex(src[0])))) continue;
            src.forEach((c, i) => map.set(key24(...hex(c)), hex(target[i]!)));
        }
    };
    add(SOURCE_SKIN, skin);
    add(SOURCE_HAIR, hair);
    return map;
};

const generate = (src: string, skin: number, hair: number, k: string) => {
    pending.add(k);
    const img = new Image();
    img.addEventListener('load', () => {
        try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(img, 0, 0);
            const im = ctx.getImageData(0, 0, c.width, c.height);
            const d = im.data;
            const map = buildMap(d, SKIN_TONES[skin]!, HAIR_COLORS[hair]!);
            if (map.size) {
                for (let i = 0; i < d.length; i += 4) {
                    if (!d[i + 3]) continue;
                    const to = map.get(key24(d[i]!, d[i + 1]!, d[i + 2]!));
                    if (to) {
                        d[i] = to[0];
                        d[i + 1] = to[1];
                        d[i + 2] = to[2];
                    }
                }
                ctx.putImageData(im, 0, 0);
            }
            c.toBlob((blob) => {
                pending.delete(k);
                if (!blob) return;
                cache.set(k, URL.createObjectURL(blob));
                bump();
            });
        } catch {
            pending.delete(k);
        }
    });
    img.addEventListener('error', () => pending.delete(k));
    img.src = src;
};

/** URL of `src` recoloured to (skin, hair); the original until the variant is ready. */
export const recolored = (src: string, skin: number, hair: number): string => {
    const k = `${src}|${skin}|${hair}`;
    const hit = cache.get(k);
    if (hit) return hit;
    if (!pending.has(k)) generate(src, skin, hair, k);
    return src;
};

/** True once the recoloured variant of `src` is built (or can't be). */
export const isRecolored = (src: string, skin: number, hair: number) => cache.has(`${src}|${skin}|${hair}`);

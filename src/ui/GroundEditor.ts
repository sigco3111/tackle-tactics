/**
 * The manager's ground: a live mini pitch plus the things that can be changed (name, mowing
 * pattern, stripe count, pitch, corner flags) and, when building a new career, the size. Built once
 * with attribute bindings, so nothing redraws while you click through the options.
 */
import { combined, derived, type Grain, type WritableGrain } from '@grainular/grains';
import { $if, attr, html, on } from '@grainular/nord';
import type { GameConfig } from '../config';
import {
    CORNER_FLAGS,
    MOW_PATTERNS,
    PITCH_CONDITIONS,
    STADIUM_SIZES,
    conditionLabel,
    patternLabel,
    sizeLabel,
    type GroundLook,
    type MowPattern,
    type PitchCondition,
    type StadiumSize,
} from '../world/stadium';

/** Grass in two shades per pitch condition (light, dark). */
const GRASS: Record<PitchCondition, [string, string]> = {
    lush: ['#3f8a3a', '#347630'],
    dry: ['#8a9a48', '#7a8a3e'],
    muddy: ['#5f6b34', '#4f5a2c'],
    frost: ['#a9c2b0', '#94ad9b'],
};

/** The mowing pattern as a CSS background (the preview's take on the match pitch). */
const turf = (look: GroundLook) => {
    const [a, b] = GRASS[look.condition];
    const w = `${(100 / look.bands).toFixed(3)}%`;
    const mud = look.condition === 'muddy' ? `radial-gradient(ellipse at 50% 50%, #5a4528cc 0 9%, transparent 22%), ` : '';
    const pattern = (p: MowPattern) =>
        p === 'stripes'
            ? `repeating-linear-gradient(90deg, ${a} 0 ${w}, ${b} ${w} calc(${w} * 2))`
            : p === 'hoops'
              ? `repeating-linear-gradient(0deg, ${a} 0 ${(100 / Math.round(look.bands * 0.6)).toFixed(3)}%, ${b} ${(100 / Math.round(look.bands * 0.6)).toFixed(3)}% ${(200 / Math.round(look.bands * 0.6)).toFixed(3)}%)`
              : p === 'checker'
                ? `repeating-conic-gradient(${a} 0 25%, ${b} 0 50%) 0 0 / 20% 25%`
                : a;
    return `background:${mud}${pattern(look.pattern)}`;
};

const FLAG_BG: Record<GroundLook['flag'], string> = {
    red: '#d23a3a',
    yellow: '#f2c230',
    checked: 'repeating-conic-gradient(#222 0 25%, #f2efe6 0 50%) 0 0 / 50% 50%',
};

export type SizeChoice = {
    /** Can this size be chosen right now? */
    allowed: (s: StadiumSize) => boolean;
    /** Why not (shown on a locked card). */
    lockedNote: (s: StadiumSize) => string;
    /** Changes when what's allowed changes (e.g. the starting division). */
    watch: Grain<unknown>;
};

export const GroundEditor = (
    cfg: GameConfig,
    look: WritableGrain<GroundLook>,
    size: WritableGrain<StadiumSize>,
    choice?: SizeChoice,
    placeholder = 'e.g. Riverside Park',
) => {
    const set = <K extends keyof GroundLook>(k: K, v: GroundLook[K]) => look.update((l) => ({ ...l, [k]: v }));
    const seg = <T extends string>(key: keyof GroundLook, values: readonly T[], label: (v: T) => string, swatch?: (v: T) => string) =>
        html`<div class="seg ground-seg">${values.map((v) => {
            const on_ = derived(look, (l) => l[key] === v);
            return html`<button type="button" ${attr({ class: derived(on_, (x) => (x ? 'on' : '')), 'aria-pressed': derived(on_, String) })} ${on('click', () => set(key, v as never))}>${swatch ? html`<i class="g-sw" style="${swatch(v)}"></i>` : html``}${label(v)}</button>`;
        })}</div>`;

    const preview = html`<div class="g-preview">
        <div class="g-pitch" ${attr({ style: derived(look, turf) })}>
            <i class="g-lines"></i><i class="g-circle"></i>
            ${(['tl', 'tr', 'bl', 'br'] as const).map((corner) => html`<i class="g-flag ${corner}" ${attr({ style: derived(look, (l) => `background:${FLAG_BG[l.flag]}`) })}></i>`)}
        </div>
        <div class="g-caption">
            <label class="g-name">구장 이름 <input type="text" maxlength="28" placeholder="${placeholder}" ${attr({ value: derived(look, (l) => l.name) })} ${on('input', (e) => set('name', (e.target as HTMLInputElement).value))} /></label>
            <span>${derived(size, (s) => `${sizeLabel(s)} · ${cfg.career.ground[s].capacity.toLocaleString('en')}석`)}</span>
        </div>
    </div>`;

    const sizeCards = choice
        ? html`<h4>규모</h4><div class="g-sizes">${STADIUM_SIZES.map((s) => {
              const ok = derived(choice.watch, () => choice.allowed(s));
              const cls = derived(combined([size, ok]), ([cur, can]) => `g-size${cur === s ? ' on' : ''}${can ? '' : ' locked'}`);
              return html`<button type="button" ${attr({ class: cls, disabled: derived(ok, (can) => !can), title: derived(ok, (can) => (can ? sizeLabel(s) : choice.lockedNote(s))) })} ${on('click', () => ok() && size.set(s))}>
                  <b>${sizeLabel(s).replace(/ (구장|스타디움)$/, '')}</b><small>${cfg.career.ground[s].capacity.toLocaleString('en')}석</small>
                  <em>${derived(ok, (can) => (can ? `+${Math.round(cfg.career.ground[s].gate * 100)}% 입장 수익` : choice.lockedNote(s)))}</em>
              </button>`;
          })}</div>`
        : html``;

    const bands = derived(look, (l) => l.pattern === 'stripes' || l.pattern === 'hoops');
    return html`<div class="ground-editor">
        ${preview}
        ${sizeCards}
        <h4>잔디 깎기</h4>
        ${seg('pattern', MOW_PATTERNS, patternLabel)}
        ${$if(bands).$then(
            () =>
                html`<label class="g-bands">줄 수 <input type="range" min="6" max="16" step="2" ${attr({ value: derived(look, (l) => String(l.bands)) })} ${on('input', (e) => set('bands', Number((e.target as HTMLInputElement).value)))} /><b>${derived(look, (l) => String(l.bands))}</b></label>`,
        )}
        <div class="g-row">
            <div><h4 title="질척한 구장은 비를, 서리 낀 구장은 눈을 부릅니다">피치</h4>${seg('condition', PITCH_CONDITIONS, conditionLabel, (c) => `background:${GRASS[c][0]}`)}</div>
            <div><h4>코너 깃발</h4>${seg(
                'flag',
                CORNER_FLAGS,
                (f) => ({ red: '빨강', yellow: '노랑', checked: '체크' })[f as 'red'] ?? f,
                (f) => `background:${FLAG_BG[f]}`,
            )}</div>
        </div>
    </div>`;
};

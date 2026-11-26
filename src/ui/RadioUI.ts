/**
 * Radio controls for the title screen, career header and match toolbar.
 */
import { combined, derived, type WritableGrain } from '@grainular/grains';
import { $if, attr, html, mounted, on } from '@grainular/nord';
import { prefs, setPref, type RadioPosition } from './prefs';
import { announce, nowPlaying, radio, radioPlaying, STATION } from './radio';
import { stageSize, viewScale } from './stage';

const moveRadio = mounted<HTMLDivElement>((node) => {
    const margin = 8;
    let position = prefs().radioPosition;
    let drag: { id: number; x: number; y: number; right: number; bottom: number; moved: boolean } | null = null;

    const place = (requested: RadioPosition): RadioPosition => {
        const { w, h } = stageSize();
        const right = Math.max(margin, Math.min(requested.right, w - node.offsetWidth - margin));
        const bottom = Math.max(margin, Math.min(requested.bottom, h - node.offsetHeight - margin));
        node.style.right = `${right}px`;
        node.style.bottom = `${bottom}px`;
        return { right, bottom };
    };
    const fit = () => {
        if (position) place(position);
    };
    const start = (e: PointerEvent) => {
        if (drag || e.button !== 0 || !(e.target instanceof Element) || !e.target.closest('.radio-grip')) return;
        // where it sits now, in logical stage pixels (computed style is logical whatever the scaling)
        const css = getComputedStyle(node);
        drag = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            right: parseFloat(css.right) || 0,
            bottom: parseFloat(css.bottom) || 0,
            moved: false,
        };
    };
    const move = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.moved) {
            // Preserve an ordinary click on the collapsed player.
            if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
            node.setPointerCapture(e.pointerId);
            node.classList.add('dragging');
            drag.moved = true;
        }
        // pointer movement in screen pixels → stage pixels (same under transform and zoom)
        const s = viewScale();
        position = place({
            right: drag.right - (e.clientX - drag.x) / s,
            bottom: drag.bottom - (e.clientY - drag.y) / s,
        });
    };
    const finish = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        const { moved } = drag;
        drag = null;
        if (!moved) return;
        node.classList.remove('dragging');
        setPref('radioPosition', position);
    };

    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    node.addEventListener('pointerdown', start, options);
    window.addEventListener('pointermove', move, options);
    window.addEventListener('pointerup', finish, options);
    window.addEventListener('pointercancel', finish, options);
    node.addEventListener(
        'lostpointercapture',
        (e) => {
            if (e.target === node) finish(e);
        },
        options,
    );
    const resize = new ResizeObserver(fit);
    resize.observe(node);
    const unsubscribe = stageSize.subscribe(fit);
    fit();
    return () => {
        listeners.abort();
        resize.disconnect();
        unsubscribe();
    };
});

const radioOn = derived(prefs, (p) => p.radioOn);
const radioOff = derived(radioOn, (enabled) => !enabled);
const active = derived(combined([radioOn, radioPlaying]), ([enabled, playing]) => enabled && playing);
const trackInfo = combined([nowPlaying, radioOn]);

const Transport = () => {
    const label = derived(active, (playing) => (playing ? '음악 일시정지' : '음악 재생'));
    const toggle = () => {
        const enabled = radioOn();
        const playing = radioPlaying();
        if (!enabled) radio.setOn(true);
        if (enabled || !playing) radio.toggle();
    };
    return html`
        <button type="button" class="ghost rc-btn" aria-label="이전 곡" title="이전 곡" ${on('click', () => radio.prev())}>⏮</button>
        <button type="button" class="ghost rc-btn" ${attr({ 'aria-label': label, title: label })} ${on('click', toggle)}>${derived(active, (playing) => (playing ? '❚❚' : '▶'))}</button>
        <button type="button" class="ghost rc-btn" aria-label="다음 곡" title="다음 곡 (N)" ${on('click', () => radio.next())}>⏭</button>`;
};

export const MatchRadioControls = () => {
    const title = derived(trackInfo, ([track, enabled]) => (enabled ? (track?.title ?? '음악') : '라디오 꺼짐'));
    return html`<div class="radio-controls match-radio" id="match-radio-controls" role="group" aria-label="음악 재생">
        <span class="radio-track" ${attr({ title })}><span aria-hidden="true">♫</span> ${title}</span>
        ${Transport()}
    </div>`;
};

export const MatchRadioButton = (open: WritableGrain<boolean>) => {
    if (!radio.hasTracks()) return html``;
    return html`<button type="button" class="match-radio" title="음악" aria-label="음악" ${attr({
        'aria-expanded': derived(open, String),
        'aria-controls': derived(open, (visible) => (visible ? 'match-radio-controls' : undefined)),
    })} ${on('click', () => open.update((v) => !v))}>♫</button>`;
};

export const RadioPlayer = ({ floating = false } = {}) => {
    if (!radio.hasTracks()) return html``;
    const grip = floating ? 'radio-grip' : '';
    const title = derived(trackInfo, ([track, enabled]) => (enabled ? (track?.title ?? STATION) : '라디오 꺼짐'));
    const artist = derived(trackInfo, ([track, enabled]) =>
        !enabled ? 'R 키로 다시 켭니다' : track ? (track.artist ?? STATION) : '아무 곳이나 클릭하면 재생됩니다',
    );
    const fresh = derived(combined([announce, radioOn]), ([track, enabled]) => (enabled ? track : null));
    const collapsed = derived(prefs, (p) => p.radioCollapsed);
    const Collapsed = () => html`<div ${attr({ class: derived(radioOff, (off) => `radio-dock collapsed ${off ? 'off' : ''}`) })}>
        ${$if(derived(fresh, Boolean)).$then(() => html`<div class="radio-toast"><small>재생 중</small><b>${derived(fresh, (track) => track?.title ?? '')}</b><span>${derived(fresh, (track) => track?.artist ?? STATION)}</span></div>`)}
        <button ${attr({ class: derived(active, (playing) => `radio-fab radio-grip ${playing ? 'live' : ''}`), title: derived(title, (name) => `라디오: ${name} · 클릭해서 열기, 드래그해서 이동`) })} ${on('click', () => setPref('radioCollapsed', false))}>♫</button>
    </div>`;
    const Expanded = () => {
        const cls = derived(combined([radioOff, fresh]), ([off, track]) => `radio-dock ${off ? 'off' : ''} ${track ? 'fresh' : ''}`);
        const toggleLabel = derived(radioOff, (off) => (off ? '라디오 켜기' : '라디오 끄기'));
        const speaker = derived(radioOff, (off) =>
            off
                ? 'M11 6h2v2h2V6h2v2h-2v2h2v2h-2v-2h-2v2h-2v-2h2V8h-2z'
                : 'M11 6h2v2h1v2h-1v2h-2v-2h1V8h-1z M14 3h2v2h1v8h-1v2h-2v-2h1V5h-1z',
        );
        return html`<div ${attr({ class: cls })} role="group" aria-label="음악 재생">
            <i class="np-icon ${grip}" aria-hidden="true" ${attr({ title: floating ? '드래그해서 라디오 이동' : undefined })}>♫</i>
            <div class="rc-text ${grip}"><small>${derived(fresh, (track) => (track ? '재생 중' : '라디오'))}</small><b ${attr({ title })}>${title}</b><span ${attr({ title: artist })}>${artist}</span></div>
            ${Transport()}
            <button type="button" class="ghost rc-btn radio-mute" ${attr({ 'aria-label': toggleLabel, title: derived(toggleLabel, (label) => `${label} (R)`) })} ${on('click', () => radio.setOn(!radioOn()))}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">
                    <path d="M1 6h4V5h2V3h2v12H7v-2H5v-1H1z" />
                    <path ${attr({ d: speaker })} />
                </svg>
            </button>
            ${floating ? html`<button type="button" class="ghost rc-btn" aria-label="플레이어 숨기기" title="플레이어 숨기기" ${on('click', () => setPref('radioCollapsed', true))}>⌄</button>` : html``}
        </div>`;
    };
    return floating ? html`<div class="radio-window" ${moveRadio}>${$if(collapsed).$then(Collapsed).$else(Expanded)}</div>` : Expanded();
};

/** N: next song, R: radio on/off — anywhere, except while typing. */
export const installRadioKeys = () => {
    window.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === 'n' || e.key === 'N') radio.next();
        else if (e.key === 'r' || e.key === 'R') radio.setOn(!prefs().radioOn);
        else return;
        e.preventDefault();
    });
};

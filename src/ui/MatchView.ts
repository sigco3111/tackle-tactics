import { combined, derived, grain } from '@grainular/grains';
import { $each, $if, $render, $switch, attr, createDirective, html, mounted, on } from '@grainular/nord';
import { isLightKit, kitColor } from './kits';
import { Playbook } from './Playbook';
import { atmosphere, pitchSurface, stadiumProps } from './StadiumView';
import { conditionsLabel, generateStadium } from '../world/stadium';
import { HalftimeReport, MatchReport } from './Report';
import { Dialog } from './Dialog';
import { distinct } from './value';
import { MatchRadioButton, MatchRadioControls } from './RadioUI';
import { audio } from './audio';
import { CONTROL_MODES, prefs, setPref } from './prefs';
import { stageSize, viewScale } from './stage';
import {
    abilitiesOf,
    abilityDef,
    allAbilities,
    classLabel,
    classLevel,
    cooldownLeft,
    passivesOf,
    type AbilityId,
} from '../engine/abilities';
import { attackGoalX, cheb, dist, disc, fromKey, goalRows, inPitch, isGoalCell, key } from '../engine/grid';
import type { KickAbility, MoveAbility } from '../engine/match';
import { movePoints, tackleChance } from '../engine/rules';
import type { Cell, Piece, TeamSide } from '../types';
import { KICK_MODES, MOVE_MODES, TARGET_MODES, type MatchController } from './controller';
import { imageReady, prewarmPlayer, resolveAnim, spriteStyle, stripUrl, paintWarm, warmStripsReady } from './sprites';
import { groundSvg, turnArrowSvg } from './pixelShapes';

/** Static SVG markup (the pixel markers), set once. */
const rawSvg = (markup: string) => createDirective((n) => void (n.innerHTML = markup));
import { recolorVersion } from './recolor';
import { COMMENTATORS, dangerMan, introText } from './intro';

type OverlayKind = 'move' | 'path' | 'danger' | 'scatter' | 'target' | 'active' | 'tackle' | 'pick' | 'run' | 'zone';
type Overlay = { k: string; x: number; y: number; kind: OverlayKind; label?: string };

export { isLightKit, kitColor };

const statBar = (label: string, v: number) =>
    html`<div class="stat"><span>${label}</span><i style="--v:${v}%"></i><b>${String(v)}</b></div>`;

type MatchViewOptions = { onExit: () => void; onSettings?: () => void; finishOdds?: () => number; knockout?: boolean };

export const MatchView = (ctl: MatchController, { onExit, onSettings, finishOdds, knockout }: MatchViewOptions) => {
    const m = ctl.match;
    const artReady = grain(false);
    const artSlow = grain(false);
    const cfg = ctl.cfg;
    const { cols, rows, margin } = cfg.pitch;
    const C = cfg.camera.cellPx;
    const W = (cols + margin * 2) * C;
    const H = (rows + margin * 2) * C;
    const px = (x: number) => (x + margin) * C; // cell → world px (top-left)
    const cx = (x: number) => px(x) + C / 2;
    const [gTop, gBottom] = goalRows(cfg);

    const viewport = stageSize;
    const stadium = ctl.opts.stadium ?? generateStadium(`quick-${ctl.opts.seed}`, m.state.clubs[0].name.split(' ')[0]!);
    const conditions = ctl.opts.conditions ?? { time: 'day' as const, weather: 'clear' as const };
    const showPlaybook = grain(false);
    const showBench = grain(false);
    const showMusic = grain(false);
    const exitPrompt = grain<{ chance: number; wasPaused: boolean } | null>(null);
    /** The bench panel: the pair being picked, the changes planned so far, and the last problem. */
    type Pair = { off: string; on: string };
    const noPick = () => ({ off: null, on: null, plan: [] as Pair[], msg: null });
    const benchPick = grain<{ off: string | null; on: string | null; plan: Pair[]; msg: string | null }>(noPick());
    /** The bench stops the clock: the game pauses while it's open (and resumes unless you had paused it yourself). */
    const benchPause = grain(false);
    showBench.subscribe((open) => {
        if (open && !ctl.paused()) {
            benchPause.set(true);
            ctl.paused.set(true);
        } else if (!open && benchPause()) {
            benchPause.set(false);
            ctl.paused.set(false);
        }
        if (!open) benchPick.set(noPick());
    });

    // ------------------------------------------------------------ cached reach per tick
    let reachCache: { tick: number; id: string; ability?: string; map: ReturnType<typeof m.reachable> } | null = null;
    const reachFor = (p: Piece, ability?: MoveAbility) => {
        const t = ctl.tick();
        if (!reachCache || reachCache.tick !== t || reachCache.id !== p.id || reachCache.ability !== ability)
            reachCache = { tick: t, id: p.id, ability, map: m.reachable(p, ability) };
        return reachCache.map;
    };
    const shownMode = () => ctl.mode() ?? ctl.preview();
    const moveMode = (): MoveAbility | undefined => {
        const md = shownMode();
        return md && MOVE_MODES.includes(md) ? (md as MoveAbility) : undefined;
    };
    const kickMode = (): KickAbility | undefined => {
        const md = shownMode();
        return md && KICK_MODES.includes(md) ? (md as KickAbility) : undefined;
    };

    // ------------------------------------------------------------ overlays
    const overlays = derived(
        combined([ctl.tick, ctl.hover, ctl.flightZone, ctl.awaitingHuman, ctl.mode, ctl.preview, ctl.setupSel]),
        ([, hover, flight, awaiting, selected, preview]) => {
            const mode = selected ?? preview;
            const out = new Map<string, Overlay>();
            const put = (c: Cell, kind: OverlayKind) => out.set(`${c.x},${c.y}`, { k: `${kind}:${c.x},${c.y}`, x: c.x, y: c.y, kind });
            const showable = (c: Cell) => inPitch(cfg, c) || isGoalCell(cfg, c);
            if (m.state.over) return [];
            const sp = m.state.setPiece;
            if (sp?.stage === 'setup') {
                // placing: the legal zone, who can move, where the picked player would go
                if (awaiting && ctl.isHuman(sp.next)) {
                    for (const c of m.placeZone(sp.next)) if (!m.pieceAt(c)) put(c, 'move');
                    for (const q of m.state.pieces) if (m.canPlacePiece(q)) put(q.pos, 'pick');
                    const sel = ctl.setupSel();
                    if (sel) put(m.piece(sel).pos, 'active');
                    if (sel && hover && m.canPlace(sel, hover)) put(hover, 'target');
                }
                return [...out.values()];
            }
            const p = m.active();
            const carrier = m.carrier();
            const isCarrier = carrier?.id === p.id;

            if (awaiting && m.state.phase === 'move') {
                const ability = moveMode();
                const reach = reachFor(p, ability);
                const danger = isCarrier ? m.dangerCells(p.team) : new Set<string>();
                for (const k of reach.keys()) put(fromKey(k), danger.has(k) ? 'danger' : 'move');
                if (hover) {
                    const r = reach.get(key(hover));
                    if (r) for (const c of r.path.slice(1)) put(c, danger.has(key(c)) ? 'danger' : 'path');
                }
            }
            if (awaiting && m.state.phase === 'act') {
                if (isCarrier) {
                    const ability = kickMode();
                    const taking = sp?.stage === 'take' && sp.taker === p.id;
                    if (taking && hover && !ability && m.kickKind(p, hover) === 'pass' && m.inOwnBox((1 - p.team) as TeamSide, hover)) {
                        for (const c of disc(hover, cfg.abilities.cross.headRadius)) if (inPitch(cfg, c)) put(c, 'run');
                    }
                    if (ability === 'cross' || (taking && !ability)) {
                        // the box is the cross's target zone
                        for (let y = 0; y < rows; y++)
                            for (let x = 0; x < cols; x++) if (m.inOwnBox((1 - p.team) as TeamSide, { x, y })) put({ x, y }, 'zone');
                    }
                    const aim =
                        hover ??
                        (ability && ['placed', 'power', 'chip'].includes(ability)
                            ? { x: p.team === 0 ? cols : -1, y: Math.floor((rows - 1) / 2) }
                            : null);
                    if (aim && hover === null && ability) {
                        const r = m.kickRadius(p, aim, ability);
                        for (const c of disc(aim, r)) if (showable(c)) put(c, 'scatter');
                    }
                    if (hover && m.kickKind(p, hover, ability)) {
                        const r = m.kickRadius(p, hover, ability);
                        for (const c of disc(hover, r)) if (showable(c)) put(c, 'scatter');
                        if (ability === 'through')
                            for (const c of disc(hover, cfg.abilities.through.runRadius))
                                if (inPitch(cfg, c) && !out.has(key(c))) put(c, 'run');
                        if (ability === 'cross')
                            for (const c of disc(hover, cfg.abilities.cross.headRadius))
                                if (inPitch(cfg, c) && out.get(key(c))?.kind !== 'scatter') put(c, 'run');
                        put(hover, 'target');
                        if (m.kickKind(p, hover, ability) === 'shot') {
                            // the exact chance the engine will roll for this shot
                            const label = `${String(Math.round(m.shotOdds(p, hover, ability).goal * 100))}%`;
                            out.set(key(hover), { k: `target:${key(hover)}:${label}`, x: hover.x, y: hover.y, kind: 'target', label });
                        }
                    }
                }
                if (mode === 'mark') for (const o of m.markTargets(p)) put(o.pos, 'pick');
                if (mode === 'tempo') for (const q of m.tempoTargets(p)) put(q.pos, 'pick');
                if (carrier && carrier.team !== p.team && (m.canTackle(p) || m.abilityUsable(p, 'slide'))) {
                    // the exact odds the engine will roll: standing tackle if adjacent, else the slide
                    const label = `${String(odds(p, carrier, !m.canTackle(p)))}%`;
                    out.set(key(carrier.pos), {
                        k: `tackle:${key(carrier.pos)}:${label}`,
                        x: carrier.pos.x,
                        y: carrier.pos.y,
                        kind: 'tackle',
                        label,
                    });
                }
            }
            if (flight) {
                for (const c of disc(flight.target, flight.radius)) if (showable(c)) put(c, 'scatter');
            }
            if (!ctl.moveMs.has(p.id)) put(p.pos, 'active'); // don't run ahead of the walking sprite
            return [...out.values()];
        },
    );

    /**
     * Zones of control, from the active player's point of view: opponents' adjacent cells stop
     * off-ball runs (and threaten a tackle/intercept if their reaction is ready); your own team's
     * cover shows where *their* runs will stop.
     */
    const zoc = derived(combined([ctl.tick, ctl.awaitingHuman, prefs]), ([, awaiting, pr]) => {
        if (!pr.showZoc || !awaiting || m.state.over)
            return [] as Array<{ k: string; x: number; y: number; kind: 'opp' | 'spent' | 'own' }>;
        const me = m.active();
        const out = new Map<string, { k: string; x: number; y: number; kind: 'opp' | 'spent' | 'own' }>();
        const rank = { own: 0, spent: 1, opp: 2 } as const;
        const put = (x: number, y: number, kind: 'opp' | 'spent' | 'own') => {
            if (!inPitch(cfg, { x, y })) return;
            const k = `${x},${y}`;
            const cur = out.get(k);
            if (!cur || rank[kind] > rank[cur.kind]) out.set(k, { k: `${kind}:${k}`, x, y, kind });
        };
        for (const q of m.state.pieces) {
            const theirs = q.team !== me.team;
            const r = theirs && q.status.markOn === me.id ? 2 : 1;
            const kind = theirs ? (m.canReact(q) ? 'opp' : 'spent') : 'own';
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx || dy) put(q.pos.x + dx, q.pos.y + dy, kind);
        }
        return [...out.values()];
    });

    // danger outline when targeting: which opponents can still react
    const reactors = derived(ctl.tick, () => {
        if (m.state.over) return [] as Piece[];
        const p = m.active();
        return m.opponents(p.team).filter((o) => m.canReact(o));
    });

    // ------------------------------------------------------------ camera
    const zoomBias = grain(1);
    /**
     * Free camera: a pan offset (viewport px) on top of the automatic framing. Drag the pitch, use the
     * arrow keys, C recentres; it also recentres when the turn passes to another player or a kick flies.
     */
    const pan = grain({ x: 0, y: 0 });
    const dragging = grain(false);
    const clampPan = (x: number, y: number) => {
        const k = cfg.camera.scale * zoomBias();
        const mx = (W * k) / 2;
        const my = (H * k) / 2;
        return { x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
    };
    const nudge = (dx: number, dy: number) => pan.update((o) => clampPan(o.x + dx, o.y + dy));
    let framedFor = '';
    const recenterOnTurn = () => {
        // a new player on the ball or a kick in the air: give the camera back to the game
        const frame = m.state.over ? '' : `${m.active().id}${ctl.followBall ? ':ball' : ''}`;
        if (frame !== framedFor) {
            framedFor = frame;
            const o = pan();
            if (o.x || o.y) pan.set({ x: 0, y: 0 });
        }
    };
    /** How much the camera leans in: crowded balls get a closer look (Settings → auto zoom). */
    const autoZoom = (): { zoom: number; focus: Cell | null } => {
        if (!prefs().autoZoom || m.state.over) return { zoom: 1, focus: null };
        const b = m.ballCell();
        const crowd = m.state.pieces.filter((q) => cheb(q.pos, b) <= 3).length;
        const a = m.active();
        if (crowd < 4 || cheb(a.pos, b) > 8) return { zoom: 1, focus: null };
        return { zoom: 1 + 0.13 * Math.min(crowd - 3, 4), focus: { x: (a.pos.x + b.x) / 2, y: (a.pos.y + b.y) / 2 } };
    };
    const camera = derived(combined([ctl.tick, viewport, zoomBias, prefs, pan, dragging]), ([, vp, bias, , off, drag]) => {
        const p = m.state.over ? undefined : m.active();
        const az = autoZoom();
        // during a kick the camera rides with the ball, on the ball's own timing and easing
        const riding = ctl.followBall && !prefs().reduceMotion;
        const sp = m.state.setPiece;
        // set pieces: frame the ball and the box together
        const spFocus = sp
            ? {
                  x: (sp.spot.x + (attackGoalX(cfg, sp.team) < 0 ? cfg.pitch.boxDepth / 2 : cols - 1 - cfg.pitch.boxDepth / 2)) / 2,
                  y: (sp.spot.y + (rows - 1) / 2) / 2,
              }
            : null;
        const f = riding ? (ctl.ballAt ?? m.ballCell()) : (spFocus ?? az.focus ?? p?.pos);
        const ride = riding
            ? `transition:transform ${Math.max(ctl.ballMs, 260)}ms cubic-bezier(.3,.6,.4,1), transform-origin ${Math.max(ctl.ballMs, 260)}ms cubic-bezier(.3,.6,.4,1)`
            : '';
        const fx = f ? (f.x + margin) * C + C / 2 : W / 2;
        const fy = f ? (f.y + margin) * C + C / 2 : H / 2;
        return [
            `transform-origin:${fx}px ${fy}px`,
            `transform:translate(${vp.w / 2 - fx + off.x}px, ${vp.h / 2 - fy + off.y}px) scale(${cfg.camera.scale * az.zoom * bias})`,
            `width:${W}px`,
            `height:${H}px`,
            // while dragging, the pitch follows the mouse directly
            drag ? 'transition:none' : ride,
        ]
            .filter(Boolean)
            .join(';');
    });

    // ------------------------------------------------------------ static pitch
    /**
     * Goals as upright sprites standing on the pitch like the players (same art pack). The art's posts
     * span ~193px from the far post (y≈35) to the near post (y≈228); it is scaled so that span matches
     * the goal mouth.
     */
    const goalSprite = (side: 'left' | 'right') => {
        const base = (cfg.pitch.goalWidth * C) / 193;
        const sx = base * cfg.sprites.goalScaleX;
        const sy = base * cfg.sprites.goalScaleY;
        const postX = side === 'left' ? 95 : 33;
        const anchorX = side === 'left' ? px(0) : px(0) + cols * C;
        // the sprite's base sits on the ground, placed so the middle of the posts lines up with the mouth
        const midY = (35 + 228) / 2;
        const anchorY = px(gTop) + (cfg.pitch.goalWidth * C) / 2 + (256 - midY) * sy;
        const w = 128 * sx;
        const h = 256 * sy;
        const box = `left:${-postX * sx}px;top:${-h}px;width:${w}px;height:${h}px`;
        const art = derived(ctl.net, (n) =>
            n === side
                ? `${box};background-image:url(assets/fx/goal_${side}_net_billow.png);background-size:${24 * w}px ${h}px;--strip:${24 * w}px;animation:strip 1.2s steps(24) 1 forwards`
                : `${box};background-image:url(assets/props/goal_${side}.png);background-size:${w}px ${h}px;animation:none`,
        );
        return html`<div class="goal-sprite" style="left:${String(anchorX)}px;top:${String(anchorY)}px;z-index:${String(Math.round(anchorY))}"><div class="stand"><div class="goal-art" ${attr({ style: art })}></div></div></div>`;
    };

    const pitchSvg = () => {
        const L = px(0);
        const T = px(0);
        const PW = cols * C;
        const PH = rows * C;
        const midY = T + PH / 2;
        const box = (left: boolean, depth: number, width: number) => {
            const h = width * C;
            const x = left ? L : L + PW - depth * C;
            return `<rect x="${x}" y="${midY - h / 2}" width="${depth * C}" height="${h}" />`;
        };
        const spot = (x: number) => `<circle cx="${x}" cy="${midY}" r="2.5" class="fill" />`;
        const arc = (left: boolean) => {
            const sx = left ? L + cfg.pitch.penaltySpot * C : L + PW - cfg.pitch.penaltySpot * C;
            const edge = left ? L + cfg.pitch.boxDepth * C : L + PW - cfg.pitch.boxDepth * C;
            const r = cfg.pitch.circleRadius * C;
            const dy = Math.sqrt(Math.max(0, r * r - (edge - sx) ** 2));
            return `<path d="M ${edge} ${midY - dy} A ${r} ${r} 0 0 ${left ? 1 : 0} ${edge} ${midY + dy}" />`;
        };
        const stripes = pitchSurface(stadium, { L, T, PW, PH, C, W, H, S: 1 });
        return `${stripes}
        <svg class="lines" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
          <rect x="${L}" y="${T}" width="${PW}" height="${PH}" />
          <line x1="${L + PW / 2}" y1="${T}" x2="${L + PW / 2}" y2="${T + PH}" />
          <circle cx="${L + PW / 2}" cy="${midY}" r="${cfg.pitch.circleRadius * C}" />
          ${spot(L + PW / 2)}
          ${box(true, cfg.pitch.boxDepth, cfg.pitch.boxWidth)}${box(false, cfg.pitch.boxDepth, cfg.pitch.boxWidth)}
          ${box(true, cfg.pitch.sixDepth, cfg.pitch.sixWidth)}${box(false, cfg.pitch.sixDepth, cfg.pitch.sixWidth)}
          ${spot(L + cfg.pitch.penaltySpot * C)}${spot(L + PW - cfg.pitch.penaltySpot * C)}
          ${arc(true)}${arc(false)}
        </svg>`;
    };

    const pitchLayer = createDirective<HTMLDivElement>((node) => {
        node.innerHTML = pitchSvg();
    });

    // Grid: the source of truth for positions & clicks. Built once, imperatively (1.5k cells).
    const gridLayer = createDirective<HTMLDivElement>((node) => {
        const frag = document.createDocumentFragment();
        for (let y = 0; y < rows; y++)
            for (let x = -1; x <= cols; x++) {
                if ((x === -1 || x === cols) && (y < gTop || y > gBottom)) continue;
                const d = document.createElement('div');
                d.className = x === -1 || x === cols ? 'cell goalcell' : 'cell';
                d.dataset.x = String(x);
                d.dataset.y = String(y);
                d.style.left = `${px(x)}px`;
                d.style.top = `${px(y)}px`;
                frag.appendChild(d);
            }
        node.appendChild(frag);
        const cellOf = (e: Event): Cell | null => {
            const t = e.target as HTMLElement;
            if (!t.dataset || t.dataset.x === undefined) return null;
            return { x: Number(t.dataset.x), y: Number(t.dataset.y) };
        };
        const over = (e: Event) => {
            const c = cellOf(e);
            const h = ctl.hover();
            if (c && (!h || h.x !== c.x || h.y !== c.y)) ctl.hover.set(c);
        };
        const click = (e: Event) => {
            const c = cellOf(e);
            if (c) ctl.clickCell(c);
        };
        const leave = () => ctl.hover.set(null);
        node.addEventListener('mouseover', over);
        node.addEventListener('click', click);
        node.addEventListener('mouseleave', leave);
        return () => {
            node.removeEventListener('mouseover', over);
            node.removeEventListener('click', click);
            node.removeEventListener('mouseleave', leave);
        };
    });

    /** A teammate whose card you opened with a right-click (cleared when the turn moves on). */
    const inspected = grain<string | null>(null);

    // ------------------------------------------------------------ tokens
    const restingAnim = (p: Piece) => {
        const holding = m.carrier()?.id === p.id;
        if (p.player.cls === 'keeper') return holding ? 'gk_hold' : 'gk_ready';
        if (p.staggered || p.stamina < cfg.fatigue.exhausted) return 'tired';
        return 'idle';
    };
    const currentAnim = (p: Piece) => {
        const o = ctl.anim.get(p.id);
        const name = o && o.until > performance.now() ? o.name : restingAnim(p);
        return resolveAnim(p, name);
    };

    const Token = (p: Piece) => {
        const R = cfg.sprites.renderPx;
        const feet = (cfg.sprites.feetY / cfg.sprites.framePx) * R;
        const wrap = derived(ctl.tick, () => {
            const ms = ctl.moveMs.get(p.id) ?? 0;
            const at = ctl.shownPos(p);
            return `left:${cx(at.x)}px;top:${px(at.y) + C / 2}px;z-index:${Math.round(px(at.y) + C / 2) + 1};transition:left ${ms}ms linear, top ${ms}ms linear`;
        });
        const cls = derived(combined([ctl.tick, ctl.hover, inspected]), ([, hover, seen]) => {
            const active = !m.state.over && m.active().id === p.id;
            const hovered = !!hover && hover.x === p.pos.x && hover.y === p.pos.y;
            const carrier = m.carrier();
            const holds = carrier?.id === p.id;
            const crowd = !!carrier && !holds && cheb(p.pos, carrier.pos) <= 2;
            return `token team${p.team}${active ? ' active' : ''}${p.staggered ? ' staggered' : ''}${!p.reactionReady ? ' spent' : ''}${holds ? ' carrier' : ''}${crowd ? ' crowd' : ''}${hovered ? ' hovered' : ''}${seen === p.id ? ' inspected' : ''}`;
        });
        // Restart the strip from frame 0 whenever a new animation starts (the element persists, so
        // without this the CSS animation keeps its old phase). Swapping between two identically
        // defined keyframes restarts it; the key changes per animation request, not per tick.
        let animKey = '';
        let animSeq = 0;
        let shown = '';
        let laidKey = '';
        let curUrl = '';
        let curW = 0;
        let under: { url: string; w: number } | null = null;
        const sprite = derived(ctl.tick, () => {
            const name = currentAnim(p);
            const o = ctl.anim.get(p.id);
            const key = `${name}|${p.facing}|${o && o.until > performance.now() ? o.until : 0}`;
            // keep the previous pose until the new strip is decoded: a not-yet-loaded strip would draw nothing
            if (key !== animKey || !shown) {
                if (!imageReady(stripUrl(p.player.sprite, name, p.facing, p.player), ctl.bump) && shown) return shown;
                animKey = key;
                animSeq++;
            }
            const url = stripUrl(p.player.sprite, name, p.facing, p.player);
            const w = (cfg.animFrames[name] ?? 8) * R;
            if (key !== laidKey) {
                // the first paint of a swapped-in image can be a blank frame: keep the old strip underneath for two frames
                if (curUrl && curUrl !== url) {
                    under = { url: curUrl, w: curW };
                    requestAnimationFrame(() => requestAnimationFrame(() => { under = null; ctl.bump(); }));
                }
                laidKey = key;
            }
            curUrl = url;
            curW = w;
            const layers = under ? `;background-image:url(${url}),url(${under.url});background-size:${w}px ${R}px,${under.w}px ${R}px` : '';
            shown = `${spriteStyle(cfg, p.player.sprite, name, p.facing, p.player)}${layers};animation-name:${animSeq % 2 ? 'strip' : 'strip-b'};width:${R}px;height:${R}px;left:${-R / 2}px;top:${-feet}px`;
            return shown;
        });
        const kit = kitColor(m.state.clubs[p.team].kit);
        const stamina = derived(ctl.tick, () => p.stamina);
        const tokenStam = $if(derived(stamina, (n) => n < cfg.fatigue.tired)).$then(
            () =>
                html`<div ${attr({ class: derived(stamina, (n) => `tok-stam ${n < cfg.fatigue.exhausted ? 'low' : ''}`) })}><i ${attr({ style: derived(stamina, (n) => `width:${Math.round(n * 2)}%`) })}></i></div>`,
        );
        const badges = derived(ctl.tick, () => {
            const s = p.status;
            const b: string[] = [];
            if (p.yellows) b.push('▮');
            if (s.commanded) b.push('▲');
            if (s.markOn) b.push('⌖');
            if (s.pressured) b.push('⊳');
            if (s.fouled) b.push('F');
            if (s.grounded || s.groundedNext) b.push('↓');
            return b.join('');
        });
        return html`<div ${attr({ class: cls, style: wrap })}>
            <div class="ground-wrap" style="--kit:${kit}" ${rawSvg(groundSvg)}></div>
            <div class="stand">
                <div class="sprite" ${attr({ style: sprite })}></div>
                <div class="tag" style="--kit:${kit}">${String(p.player.number)}<span class="badges">${badges}</span></div>
                <div class="tok-name">${p.player.name}</div>
                <div class="turn-mark" ${rawSvg(turnArrowSvg)}></div>
                ${tokenStam}
            </div>
        </div>`;
    };

    const ballStyle = derived(ctl.tick, () => {
        const b = m.state.ball;
        let x: number;
        let y: number;
        if (b.kind === 'held') {
            const h = m.piece(b.by);
            const off = h.facing === 'right' ? 0.38 : h.facing === 'left' ? -0.38 : 0;
            const offY = h.facing === 'down' ? 0.3 : h.facing === 'up' ? -0.2 : 0.12;
            const at = ctl.shownPos(h);
            x = cx(at.x) + off * C;
            y = px(at.y) + C / 2 + offY * C;
        } else {
            x = cx(b.at.x);
            y = px(b.at.y) + C / 2;
        }
        if (ctl.ballAt) {
            x = cx(ctl.ballAt.x);
            y = px(ctl.ballAt.y) + C / 2;
        }
        const ms = ctl.ballMs;
        return `left:${x}px;top:${y}px;z-index:${Math.round(y) + 2};transition:left ${ms}ms cubic-bezier(.3,.6,.4,1), top ${ms}ms cubic-bezier(.3,.6,.4,1)`;
    });

    /** A held ball is just the ball at its carrier's feet; a loose one gets the pulsing ring. */
    const ballClass = derived(ctl.tick, () => (m.state.ball.kind === 'held' && !ctl.ballAt ? 'ball held' : 'ball loose'));

    // ------------------------------------------------------------ HUD pieces
    const club = (t: TeamSide) => m.state.clubs[t];
    const scoreText = (t: TeamSide) => derived(ctl.tick, () => String(m.state.score[t]));
    const roundText = derived(ctl.tick, () => {
        const half = m.state.round <= Math.floor(cfg.match.rounds / 2) ? '전반' : '후반';
        return `${m.state.round} / ${cfg.match.rounds} 라운드 · ${half}`;
    });
    const noTimer = cfg.match.timerSeconds <= 0;
    const timerStyle = derived(
        combined([ctl.timer, ctl.awaitingHuman]),
        ([t, a]) => `transform:scaleX(${a ? t : 0});${t < 0.3 ? 'background:var(--danger)' : ''}`,
    );

    /** Every ability of the player's classes, locked ones greyed with their unlock level. */
    const kitList = (p: Piece) => {
        const classes = Object.keys(p.player.levels);
        const ids = allAbilities(cfg).filter((id) => classes.includes(abilityDef(cfg, id).cls));
        const owned = abilitiesOf(cfg, p.player);
        const passives = passivesOf(cfg, p.player);
        return html`<div class="kitlist">
            ${ids.map((id) => {
                const a = abilityDef(cfg, id);
                const have = owned.includes(id);
                const cd = cooldownLeft(p, id, m.state.round);
                const passed = classLevel(p.player, a.cls) >= a.unlock;
                const tip = `${a.label}: ${a.desc}${have ? '' : passed ? ' (선택 안 함: 이 레벨에서 다른 선택지를 골랐습니다)' : ` (${cfg.classes[a.cls].short} ${a.unlock} 레벨에서 선택 가능, 현재 ${classLevel(p.player, a.cls)})`}`;
                return html`<span class="chip ${have ? '' : 'locked'}" data-tip="${tip}">${a.label}${have ? (cd ? html` <b>${String(cd)}</b>` : html``) : html` <i>${passed ? '—' : `${cfg.classes[a.cls].short}${String(a.unlock)}`}</i>`}</span>`;
            })}
            ${passives.map((id) => html`<span class="chip passive" data-tip="${cfg.passives[id].label} (패시브): ${cfg.passives[id].desc}">${cfg.passives[id].label}</span>`)}
        </div>`;
    };

    const activePiece = distinct(derived(ctl.tick, () => (m.state.over ? null : m.active())));
    /** The player card follows the active player, or a teammate you right-clicked. */
    const cardPiece = distinct(
        derived(combined([activePiece, inspected]), ([active, id]) => (id ? (m.state.pieces.find((x) => x.id === id) ?? active) : active)),
    );
    const activeCard = derived(cardPiece, (p) => {
        if (!p) return html`<div class="card"></div>`;
        const looking = p.id !== m.active().id;
        const s = p.player.stats;
        const kit = kitColor(club(p.team).kit);
        const human = ctl.isHuman(p.team);
        const sprite = derived(recolorVersion, () => spriteStyle(cfg, p.player.sprite, 'idle', 'down', p.player));
        const readiness = derived(ctl.tick, () => `이동 ${movePoints(cfg, p)} · 반응 ${p.reactionReady ? '가능' : '소진'}`);
        const stamina = derived(ctl.tick, () => Math.round(p.stamina));
        return html`<div class="card${looking ? ' inspecting' : ''}" style="--kit:${kit}">
            ${looking ? html`<div class="inspect-bar"><span>살펴보는 중</span><button class="ghost" ${on('click', () => inspected.set(null))}>뒤로 <kbd>Esc</kbd></button></div>` : html``}
            <div class="card-head">
                <div class="portrait"><div class="sprite still" ${attr({ style: sprite })}></div></div>
                <div>
                    <div class="pname">#${String(p.player.number)} ${p.player.name}</div>
                    <div class="pmeta">${classLabel(cfg, p.player)} · ${club(p.team).short} · ${human ? '나' : 'AI'}</div>
                    <div class="pmeta">${readiness}</div>
                    <div class="pmeta stam">체력 <span ${attr({ class: derived(stamina, (n) => `stam-bar ${n < cfg.fatigue.exhausted ? 'low' : n < cfg.fatigue.tired ? 'mid' : ''}`) })}><i ${attr({ style: derived(stamina, (n) => `width:${n}%`) })}></i></span> ${derived(stamina, String)}</div>
                </div>
            </div>
            ${human ? html`` : $render(derived(ctl.tick, () => kitList(p)))}
            <div class="stats">
                ${statBar('SPD', s.speed)}${statBar('PAC', s.pace)}${statBar('PAS', s.passing)}${statBar('SHO', s.shooting)}
                ${statBar('DRI', s.dribbling)}${statBar('TAC', s.tackling)}${statBar('REF', s.reflexes)}${statBar('COM', s.composure)}
            </div>
        </div>`;
    });

    const hint = derived(
        combined([ctl.tick, ctl.awaitingHuman, ctl.hover, ctl.mode, ctl.tip, ctl.setupSel]),
        ([, awaiting, hover, mode]) => {
            if (m.state.over) return '경기 종료.';
            const sp = m.state.setPiece;
            if (sp?.stage === 'setup') {
                const what = sp.kind === 'corner' ? '코너킥' : '프리킥';
                if (!awaiting)
                    return `${what}: ${club(sp.next).short} ${sp.next === sp.team ? '선수들을 앞으로 올립니다' : '수비를 정비합니다'}…`;
                const left = sp.left[sp.next];
                const role =
                    sp.next === sp.team
                        ? '마크맨을 따돌리세요. 골문 근처 공간에 달리는 선수를 두세요.'
                        : '상대 공격수를 골문 쪽에서 막으세요. 위험한 선수부터 커버하세요.';
                return `${what} 배치 (${left}번 남음). ${role} 강조된 선수를 클릭한 뒤 칸을 클릭하세요. 만족하면 스페이스를 누르세요.`;
            }
            const p = m.active();
            if (m.state.bonusTurn === p.id && awaiting && !mode) {
                return m.state.phase === 'move'
                    ? '추가 턴: 몰려 있는 곳에서 공을 빼내세요(또는 스페이스로 제자리 유지).'
                    : '추가 턴: 패스하거나, 스페이스로 공을 지키세요. 슛은 정상 턴까지 기다려야 합니다.';
            }
            if (sp?.stage === 'take' && sp.taker === p.id && awaiting) {
                return sp.kind === 'corner'
                    ? '코너킥: 박스 안을 겨냥하세요. 공이 떨어지는 곳에서 2칸 이내의 동료가 헤딩을 시도합니다. 짧게 이어 가도 됩니다.'
                    : '프리킥: 벽 위로 슛하거나, 박스로 올리거나, 짧게 이어 가세요. 아무도 태클할 수 없습니다.';
            }
            if (ctl.tip()) return '말로 코치가 할 말이 있습니다. 엔터로 계속하세요. 시계는 멈춰 있습니다.';
            if (!awaiting)
                return ctl.isHuman(p.team)
                    ? ctl.needsOrders(p)
                        ? '진행 중…'
                        : `${p.player.name} 선수는 스스로 대형을 유지합니다 (포커스: F)`
                    : `${club(p.team).short} 생각 중…`;
            const isCarrier = m.carrier()?.id === p.id;
            // the armed bar says what to click; the hint just restates the plan in words
            if (mode) {
                if (isCarrier && hover && m.state.phase === 'act' && m.kickKind(p, hover, mode as KickAbility) === 'shot')
                    return `${abilityDef(cfg, mode).label}: ${shotHint(p, hover, mode).replace(/^슛: /, '')}`;
                const what = MOVE_MODES.includes(mode)
                    ? '강조된 칸을 클릭'
                    : KICK_MODES.includes(mode)
                      ? '마우스로 조준하고 클릭해서 차기'
                      : '강조된 선수를 클릭';
                return `${abilityDef(cfg, mode).label}: ${what}. 다시 누르면 취소됩니다.`;
            }
            if (m.state.phase === 'move') {
                if (p.status.fouled) return '파울을 당했습니다: 프리킥. 제자리에 머문 뒤(스페이스) 패스하거나 슛하세요.';
                return isCarrier
                    ? '드리블: 칸을 클릭하세요(분홍 = 수비수가 반응할 수 있음). 자신을 클릭하거나 스페이스로 제자리에 머문 채 패스/슛할 수 있습니다.'
                    : '이동: 파란 칸을 클릭하세요. 자신을 클릭하거나 스페이스로 위치를 유지합니다.';
            }
            if (isCarrier) {
                if (hover) {
                    const kind = m.kickKind(p, hover);
                    if (kind === 'shot') return shotHint(p, hover);
                    if (kind === 'pass')
                        return `패스 ${dist(p.pos, hover) > cfg.ball.loftThreshold ? '(띄운 공: 출발과 착지 때만 경합 가능)' : '(낮은 공: 경로 전체에서 경합 가능)'}`;
                }
                return '원하는 칸에 패스하거나, 골문을 겨냥해 슛하세요. 스페이스는 공을 지킵니다.';
            }
            const c = m.carrier();
            if (c && c.team !== p.team && (m.canTackle(p) || m.abilityUsable(p, 'slide'))) {
                const how = m.canTackle(p) ? '태클' : '슬라이딩 태클';
                return `${how} ${String(odds(p, c, !m.canTackle(p)))}%: 성공하면 한 번 더 행동하고, 실패하면 상대가 빠져나갈 무료 턴을 얻습니다. 스페이스로 턴을 마칩니다.`;
            }
            return '능력을 쓰거나, 스페이스로 턴을 마치세요.';
        },
    );

    /** A shot's chance to score and why: on target, the keeper, blocks on the way. */
    const shotHint = (p: Piece, at: Cell, ability?: AbilityId) => {
        const o = m.shotOdds(p, at, ability as KickAbility | undefined);
        const pc = (v: number) => `${String(Math.round(v * 100))}%`;
        const block = o.block >= 0.01 ? `, ${pc(o.block)} 확률로 수비에 막힘` : '';
        return `슛: 득점 확률 ${pc(o.goal)}. 유효슛 ${pc(o.onTarget)}, 키퍼 선방 ${pc(o.save)}${block}. 주황색 구역이 공이 갈 수 있는 범위입니다.`;
    };
    /** Tackle odds as the engine rolls them (active challenge; a slide adds its bonus). */
    const odds = (p: Piece, c: Piece, slide = false) =>
        Math.round(tackleChance(cfg, p, c, true, slide ? cfg.abilities.slide.bonus : 0) * 100);
    const slideOdds = (p: Piece, id: AbilityId, st: string) => {
        const c = m.carrier();
        return id === 'slide' && st === 'ready' && c && c.team !== p.team ? ` · ${String(odds(p, c, true))}%` : '';
    };
    type Lane = 'before' | 'after';
    const laneOf = (id: AbilityId): Lane => (abilityDef(cfg, id).phase === 'act' ? 'after' : 'before');
    /** What arming the ability asks of you next. */
    const kindOf = (id: AbilityId) =>
        MOVE_MODES.includes(id)
            ? '칸 선택'
            : KICK_MODES.includes(id)
              ? '킥 조준'
              : TARGET_MODES.includes(id)
                ? '선수 선택'
                : '즉시 발동';
    const infoFor = grain<AbilityId | null>(null);

    const phaseAbilities = (p: Piece) => {
        const phase = m.state.phase;
        return abilitiesOf(cfg, p.player).filter((id) =>
            phase === 'move' ? abilityDef(cfg, id).phase !== 'act' : abilityDef(cfg, id).phase === 'act',
        );
    };

    const inputPhase = derived(combined([ctl.tick, ctl.awaitingHuman]), ([, awaiting]) => {
        if (!awaiting || m.state.over) return 'idle';
        return m.state.setPiece?.stage === 'setup' ? 'placing' : m.state.phase;
    });
    const inTurn = derived(inputPhase, (phase) => phase === 'move' || phase === 'act');
    const phaseStep = $if(inTurn).$then(
        () => html`<div class="steps">
        <span ${attr({ class: derived(inputPhase, (phase) => (phase === 'move' ? 'on' : 'done')) })}>1 · 이동</span><i></i>
        <span ${attr({ class: derived(inputPhase, (phase) => (phase === 'act' ? 'on' : '')) })}>2 · 행동</span>
    </div>`,
    );

    const Placement = () => {
        const text = derived(ctl.tick, () => {
            const sp = m.state.setPiece;
            if (sp?.stage !== 'setup') return { title: '', hint: '' };
            const left = sp.left[sp.next];
            return {
                title: `${sp.kind === 'corner' ? '코너킥' : '프리킥'} · ${sp.next === sp.team ? '공격' : '수비'}`,
                hint: `배치 ${left}번 남음 · 이후 상대 팀이 대응합니다`,
            };
        });
        return html`<div class="dock-row setup-dock">
            <div class="setup-info"><b>${derived(text, (t) => t.title)}</b><span>${derived(text, (t) => t.hint)}</span></div>
            <div class="core"><button class="primary" ${on('click', () => ctl.pass())}>배치 완료 <kbd>Space</kbd></button></div>
        </div>`;
    };
    const TurnActions = () => {
        const owned = derived(activePiece, (p) => (p ? abilitiesOf(cfg, p.player) : []));
        const nowLane = derived(inputPhase, (phase): Lane => (phase === 'move' ? 'before' : 'after'));
        /** One group per turn step; its header matches the 1 · Move / 2 · Act steps above. */
        const group = (which: Lane) => {
            const ids = derived(owned, (list) => list.filter((id) => laneOf(id) === which));
            const cls = derived(nowLane, (lane) => `dock-group ${lane === which ? 'now' : 'later'}`);
            return $if(derived(ids, (list) => list.length > 0)).$then(
                () => html`<div ${attr({ class: cls })}>
                <span class="dock-label">${which === 'before' ? '1 · 이동' : '2 · 행동'}</span>
                <div class="slots">${$each(ids)
                    .$withKey((id) => id)
                    .$as(AbilitySlot)}</div>
            </div>`,
            );
        };
        const AbilitySlot = (id: AbilityId) => {
            const a = abilityDef(cfg, id);
            const state = derived(combined([ctl.tick, ctl.mode]), ([, mode]) => {
                if (m.state.over) return { state: 'later', label: '', odds: '', key: '', cooldown: 0 };
                const p = m.active();
                const phase = m.state.phase;
                const reason = m.blockReason(p, id);
                const cooldown = cooldownLeft(p, id, m.state.round);
                const inLane = laneOf(id) === (phase === 'move' ? 'before' : 'after');
                const status = mode === id ? 'armed' : !inLane ? 'later' : cooldown > 0 ? 'wait' : reason ? 'blocked' : 'ready';
                const label =
                    status === 'armed'
                        ? '준비됨'
                        : status === 'later'
                          ? phase === 'move'
                              ? '이동한 뒤'
                              : '이동 전에만'
                          : status === 'wait'
                            ? `${String(cooldown)}라운드 후 사용 가능`
                            : status === 'blocked'
                              ? (reason ?? '지금은 불가')
                              : '사용 가능';
                const index = inLane ? phaseAbilities(p).indexOf(id) + 1 : 0;
                return { state: status, label, odds: slideOdds(p, id, status), key: index ? String(index) : '', cooldown };
            });
            const enter = on('mouseenter', () => {
                infoFor.set(id);
                if (state().state === 'ready') ctl.preview.set(id);
            });
            const leave = on('mouseleave', () => {
                infoFor.set(null);
                ctl.preview.set(null);
            });
            // the cost, always visible: how long it recharges after use
            const cost = a.cooldown
                ? html`<span class="cost" title="사용 후 ${String(a.cooldown)}라운드 동안 재충전">쿨 ${String(a.cooldown)}</span>`
                : html`<span class="cost free" title="쿨다운 없음: 매 턴 사용 가능">무료</span>`;
            const keyLabel = derived(state, (s) => s.key);
            return html`<button ${attr({ class: derived(state, (s) => `aslot ${s.state}`) })} ${enter} ${leave} ${on('click', () => ctl.useAbility(id))}>
                <span class="hk" ${attr({ hidden: derived(keyLabel, (k) => !k) })}>${keyLabel}</span>
                <b class="nm">${a.label}</b>
                <span class="kind"><span>${kindOf(id)}${derived(state, (s) => s.odds)}</span>${cost}</span>
                <span class="st">${derived(state, (s) => s.label)}</span>
                ${$if(derived(state, (s) => s.state === 'wait')).$then(
                    () => html`<span class="cd"><b>${derived(state, (s) => String(s.cooldown))}</b></span>`,
                )}
            </button>`;
        };
        const passives = derived(activePiece, (p) => (p ? passivesOf(cfg, p.player) : []));
        const hold = derived(ctl.tick, () => {
            if (m.state.over) return '';
            const carrying = m.carrier()?.id === m.active().id;
            return m.state.phase === 'move' ? (carrying ? '제자리 킥' : '대기') : carrying ? '공 지키기' : '턴 종료';
        });
        const standingOdds = derived(ctl.tick, () => {
            const carrier = m.carrier();
            if (m.state.over || m.state.phase !== 'act' || !carrier) return null;
            const p = m.active();
            return m.canTackle(p) ? odds(p, carrier) : null;
        });
        return html`<div class="dock-row turn-dock">
            ${group('before')}${group('after')}
            ${$if(derived(owned, (list) => !list.length)).$then(() => html`<div class="dock-group"><span class="dock-label">능력</span><span class="no-abilities">아직 없습니다. 이 선수가 레벨업하면 열립니다.</span></div>`)}
            ${$if(derived(passives, (list) => list.length > 0)).$then(
                () =>
                    html`<div class="dock-group passives"><span class="dock-label">상시 적용</span><div class="passive-list">${$each(passives).$as((id) => html`<span class="passive" title="${cfg.passives[id].desc}">${cfg.passives[id].label}</span>`)}</div></div>`,
            )}
            <div class="dock-group core">
                <span class="dock-label">턴</span>
                <div class="slots">
                    ${$if(derived(standingOdds, (chance) => chance !== null)).$then(() => html`<button class="tbtn warn" title="공을 빼앗을 확률" ${on('click', () => ctl.input({ t: 'act', d: { kind: 'tackle' } }))}><b>태클 ${derived(standingOdds, String)}%</b><kbd>T</kbd></button>`)}
                    <button class="tbtn" ${on('click', () => ctl.pass())}><b>${hold}</b><kbd>Space</kbd></button>
                    <button class="tbtn ghost" title="이 행동을 AI가 대신 수행" ${on('click', () => ctl.input({ t: 'auto' }))}><b>자동</b><kbd>A</kbd></button>
                </div>
            </div>
        </div>`;
    };
    const actions = $switch(distinct(derived(inputPhase, (phase) => (phase === 'move' || phase === 'act' ? 'turn' : phase))))
        .$case('placing', Placement)
        .$case('turn', TurnActions)
        .$default(() => html`<div class="dock-row"></div>`);

    /** Explains the hovered or armed ability, above the dock (instead of a tiny tooltip). */
    const abilityInfo = derived(combined([infoFor, ctl.mode, ctl.awaitingHuman, ctl.tick]), ([hovered, , awaiting]) => {
        if (!awaiting || m.state.over) return html``;
        const p = m.active();
        // a card can be re-rendered away under the mouse (new turn): only explain this player's abilities
        const owned = abilitiesOf(cfg, p.player);
        // hover only: once armed, the slot and the hint line say what to do
        const id = hovered && owned.includes(hovered) ? hovered : null;
        if (!id) return html``;
        const a = abilityDef(cfg, id);
        const reason = m.blockReason(p, id);
        const cd = cooldownLeft(p, id, m.state.round);
        return html`<div class="ab-info">
            <div class="ab-head"><div><b>${a.label}</b><small>${laneOf(id) === 'before' ? '이동 전' : '이동 후'} · ${kindOf(id)}${a.cooldown ? ` · ${a.cooldown}라운드 재충전` : ''}</small></div></div>
            <p>${a.desc}</p>
            <p class="how"><b>사용법:</b> ${a.how}</p>
            ${id === 'slide' && m.carrier() && m.carrier()!.team !== p.team ? html`<p class="odds">공을 빼앗을 확률: <b>${String(odds(p, m.carrier()!, true))}%</b>${m.canTackle(p) ? ` (일반 태클: ${String(odds(p, m.carrier()!))}%)` : ''}</p>` : html``}
            ${cd > 0 ? html`<p class="why">재충전 중: ${String(cd)}라운드 후 사용 가능.</p>` : reason ? html`<p class="why">지금은 불가: ${reason}.</p>` : html``}
        </div>`;
    });

    /** The next dozen to act; a tackle winner's extra turn sits in front of the normal order. */
    const queueIds = () =>
        m.state.over
            ? []
            : m.state.bonusTurn
              ? [m.state.bonusTurn, ...m.state.order.slice(m.state.turnIndex + 1, m.state.turnIndex + 12)]
              : m.state.order.slice(m.state.turnIndex, m.state.turnIndex + 12);
    const controlMode = derived(prefs, (p) => p.controlMode);
    const queueKey = distinct(derived(ctl.tick, () => queueIds().join(',')));
    const queueItems = derived(queueKey, () => {
        const ids = queueIds();
        return ids.map((id, i) => ({ id, key: ids.indexOf(id) === i ? id : `${id}#${i}` }));
    });
    // each portrait is built once per player and kept; only its markers update
    const queueItem = (q: { id: string; key: string }) => {
        const p = m.piece(q.id);
        const cls = derived(combined([ctl.tick, controlMode]), () => {
            const auto = ctl.isHuman(p.team) && !ctl.needsOrders(p);
            return `qitem ${queueIds()[0] === q.id && !q.key.includes('#') ? 'now' : ''} ${auto ? 'auto' : ''}`;
        });
        const sprite = derived(recolorVersion, () => spriteStyle(cfg, p.player.sprite, 'idle', 'down', p.player));
        return html`<div ${attr({ class: cls })} style="--kit:${kitColor(club(p.team).kit)}" title="${p.player.name}">
            <div class="sprite still" ${attr({ style: sprite })}></div>
            <span>${cfg.classes[p.player.cls].short}${String(p.player.number)}</span>
        </div>`;
    };
    const queue = html`<div class="queue">${$each(queueItems)
        .$withKey((q) => q.key)
        .$as(queueItem)}</div>`;

    const log = html`<div class="log"><h5>해설 <small>B. 퀼</small></h5><ul>
        ${$each(derived(ctl.commentary, (lines) => lines.slice(0, 8)))
            .$withKey((line) => line.id)
            .$as(
                (line) =>
                    html`<li class="${line.team === null ? '' : `t${line.team}`} ${line.tone}"><b>${String(line.minute)}'</b> ${line.text}</li>`,
            )}
    </ul></div>`;

    const caption = derived(ctl.caption, (c) =>
        c
            ? html`<div class="caption ${c.team === null ? '' : `t${c.team}`}" style="--kit:${c.team === null ? 'var(--gold)' : kitColor(club(c.team).kit)}">
        <b>${c.title}</b><span>${c.text}</span></div>`
            : html``,
    );

    const shakeClass = derived(
        combined([ctl.shake, dragging]),
        ([n, drag]) => `viewport ${n ? (n % 2 ? 'shake-a' : 'shake-b') : ''}${drag ? ' dragging' : ''}`,
    );

    const ballImgStyle = derived(ctl.ballArc, (a) => {
        if (!a) return '';
        // spins while travelling (faster for shots); lofted balls also rise and fall
        const turns = Math.max(1, Math.round((a.ms / 1000) * 6 * a.spin));
        const spin = `ball-spin ${Math.round(a.ms / turns)}ms steps(4) ${turns}`;
        return a.height
            ? `--arc-h:${-a.height}px;animation:${a.id % 2 ? 'arc-a' : 'arc-b'} ${a.ms}ms cubic-bezier(.3,.6,.4,1) both, ${spin}`
            : `animation:${spin}`;
    });

    const burst = (b: { id: number; at: { x: number; y: number }; kind: 'confetti' | 'dust'; colors: string[] }) => {
        const n = b.kind === 'confetti' ? 26 : 9;
        const parts = Array.from({ length: n }, (_, i) => {
            const ang = (i / n) * Math.PI * 2 + Math.random() * 0.5;
            const r = b.kind === 'confetti' ? 40 + Math.random() * 90 : 10 + Math.random() * 18;
            const dx = Math.cos(ang) * r;
            const dy = -Math.abs(Math.sin(ang)) * r * (b.kind === 'confetti' ? 1.4 : 0.6) - 10;
            return html`<i style="--dx:${dx.toFixed(0)}px;--dy:${dy.toFixed(0)}px;--c:${b.colors[i % b.colors.length]!};animation-delay:${String(Math.round(Math.random() * 120))}ms"></i>`;
        });
        return html`<div class="burst ${b.kind}" style="left:${cx(b.at.x)}px;top:${px(b.at.y) + C / 2}px"><div class="stand">${parts}</div></div>`;
    };

    const tipPanel = derived(ctl.tip, (t) =>
        t
            ? html`<div class="tip">
        <div class="coach"><div class="sprite" style="${spriteStyle(cfg, 'coach', 'shout', 'down')};width:96px;height:96px;background-size:${String((cfg.animFrames.shout ?? 12) * 96)}px 96px;--strip:${String((cfg.animFrames.shout ?? 12) * 96)}px"></div></div>
        <div class="tip-body"><small>말로 코치</small><h3>${t.title}</h3><p>${t.text}</p>
            <div class="tip-actions"><button class="ghost" ${on('click', () => ctl.dismissTip(true))}>팁 그만 보기</button><button class="primary" ${on('click', () => ctl.dismissTip())}>알겠습니다 <kbd>Enter</kbd></button></div></div>
    </div>`
            : html``,
    );

    const lessonPanel = derived(combined([ctl.lesson, ctl.tutorialDone]), ([l, done]) => {
        const coach = html`<div class="coach"><div class="sprite" style="${spriteStyle(cfg, 'coach', 'shout', 'down')};width:96px;height:96px;background-size:${String((cfg.animFrames.shout ?? 12) * 96)}px 96px;--strip:${String((cfg.animFrames.shout ?? 12) * 96)}px"></div></div>`;
        if (done)
            return html`<div class="tip lesson done">${coach}<div class="tip-body"><small>훈련 완료</small><h3>준비됐습니다.</h3>
            <p>이게 게임의 전부입니다. 공간을 만들고, 공을 움직이고, 공간을 막고, 시간과 싸우세요. 다음 단계로는 쉬운 AI와 빠른 경기를 해 보고, 그다음 커리어를 시작해 보세요.</p>
            <div class="tip-actions"><button class="primary" ${on('click', onExit)}>메뉴로 돌아가기</button></div></div></div>`;
        if (!l) return html``;
        return html`<div class="tip lesson">${coach}<div class="tip-body"><small>레슨 ${String(l.i + 1)} / ${String(l.n)} · 말로 코치</small><h3>${l.title}</h3><p>${l.text}</p>
            ${l.retry ? html`<p class="lesson-retry">${l.retry}</p>` : html``}${l.praise ? html`<p class="lesson-praise">✓ ${l.praise}</p>` : html``}
            <div class="tip-actions"><button class="ghost" ${on('click', onExit)}>훈련 나가기</button>${l.info ? html`<button class="primary" ${on('click', () => ctl.nextLesson())}>계속 <kbd>Enter</kbd></button>` : html``}</div></div></div>`;
    });

    // ------------------------------------------------------------ pre-match intro
    const introLines = introText(
        cfg,
        m,
        [ctl.teamStyle(0), ctl.teamStyle(1)],
        ctl.opts.stadium,
        ctl.opts.conditions,
        ctl.opts.seed,
        ctl.opts.story,
    );
    const avatar = (sprite: string) =>
        html`<div class="portrait intro-face"><div class="sprite still" style="${spriteStyle(cfg, sprite, 'idle', 'down')}"></div></div>`;
    const surname = (name: string) => name.split(' ').at(-1)!;
    const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;
    /** Both squads at their kick-off spots on a miniature pitch. */
    const introPitch = () => {
        const P = cfg.pitch;
        const feet = (cfg.sprites.feetY / cfg.sprites.framePx) * cfg.sprites.renderPx;
        const R = cfg.sprites.renderPx;
        const box = (depth: number, width: number, left: boolean, cls: string) =>
            html`<i class="${cls}" style="${left ? 'left' : 'right'}:0;top:${pct((P.rows - width) / 2, P.rows)};width:${pct(depth, P.cols)};height:${pct(width, P.rows)}"></i>`;
        const men = m.state.pieces.map((p) => {
            const c = club(p.team);
            const kit = p.player.cls === 'keeper' ? c.keeperKit : c.kit;
            const danger = dangerMan(m, p.team) === p;
            const anim = p.player.cls === 'keeper' ? 'gk_ready' : 'idle';
            return html`<div class="ip-man${danger ? ' danger' : ''}" title="${`${p.player.number} ${p.player.name} · ${cfg.classes[p.player.cls].label}${danger ? ' · danger man' : ''}`}" style="left:${pct(p.pos.x + 0.5, P.cols)};top:${pct(p.pos.y + 0.5, P.rows)}">
                <div class="sprite" style="${spriteStyle(cfg, p.player.sprite, anim, p.team === 0 ? 'right' : 'left', p.player)};width:${R}px;height:${R}px;left:${-R / 2}px;top:${-feet}px"></div>
                <b class="ip-num${isLightKit(kit) ? ' light' : ''}" style="--kit:${kitColor(kit)}">${danger ? '★' : ''}${String(p.player.number)}</b>
            </div>`;
        });
        return html`<div class="ip-turf"><div class="ip-field" style="aspect-ratio:${P.cols} / ${P.rows}">
            ${box(P.boxDepth, P.boxWidth, true, 'ip-box')}${box(P.boxDepth, P.boxWidth, false, 'ip-box')}
            ${box(P.sixDepth, P.sixWidth, true, 'ip-box')}${box(P.sixDepth, P.sixWidth, false, 'ip-box')}
            <i class="ip-circle" style="width:${pct(P.circleRadius * 2, P.cols)}"></i>
            ${men}
        </div></div>`;
    };
    const introSide = (t: TeamSide) => {
        const c = club(t);
        const danger = dangerMan(m, t);
        return html`<div class="intro-side" style="--kit:${kitColor(c.kit)}">
            <h3><i class="kit-dot"></i>${c.name}${ctl.isHuman(t) ? html` <em class="you">나</em>` : html``}</h3>
            <p>${c.formationId} · ${cfg.ai.styles[ctl.teamStyle(t)].label}</p>
            ${danger ? html`<p class="danger">★ ${danger.player.name} <span>${cfg.classes[danger.player.cls].short}</span></p>` : html``}
        </div>`;
    };
    const introOverlay = () => {
        const [h, a] = m.state.clubs;
        const st = ctl.opts.stadium;
        const facts: [string, string][] = [
            ...(st
                ? ([
                      ['경기장', st.name],
                      ['수용 인원', st.capacity.toLocaleString('ko-KR')],
                  ] as [string, string][])
                : []),
            ['컨디션', ctl.opts.conditions ? conditionsLabel(ctl.opts.conditions) : '양호'],
            ['심판', `${m.state.referee.name} · ${cfg.referee.styles[m.state.referee.style].label}`],
        ];
        return html`<div class="intro">
            <div class="intro-card">
                <div class="intro-strip"><span class="live">● 생중계</span><span>경기 전</span></div>
                <h2 class="intro-title"><span style="--kit:${kitColor(h.kit)}">${h.name}</span><em>vs</em><span style="--kit:${kitColor(a.kit)}">${a.name}</span></h2>
                <div class="intro-grid">
                    <div class="intro-squads">${introPitch()}<div class="intro-sides">${introSide(0)}${introSide(1)}</div></div>
                    <div class="intro-booth">
                        <div class="intro-voices">${(['lead', 'colour'] as const).map(
                            (v) =>
                                html`<div class="intro-voice">${avatar(v === 'lead' ? 'coach' : 'coach_2')}<div><b>${COMMENTATORS[v].name}</b><small>${COMMENTATORS[v].role}</small></div></div>`,
                        )}</div>
                        <div class="intro-talk scroll">${introLines.map(
                            (l) => html`<p class="${l.who}"><b>${surname(COMMENTATORS[l.who].name)}</b>${l.text}</p>`,
                        )}</div>
                        <div class="intro-facts">${facts.map(([k, v]) => html`<div><span>${k}</span><b>${v}</b></div>`)}</div>
                    </div>
                </div>
                <footer class="intro-foot">
                    <button class="primary" ${on('click', () => artReady() && ctl.introDone())}>${derived(combined([artReady, artSlow]), ([r, slow]) => (r ? '킥오프' : slow ? '아트 로딩 실패, 다시 시도 중…' : '아트 로딩 중…'))} <kbd>Enter</kbd></button>
                </footer>
            </div>
        </div>`;
    };

    const toast = derived(ctl.toast, (t) => (t ? html`<div class="toast">${t}</div>` : html``));
    const focusChip = html`<button class="ghost focus-chip" title="어떤 선수에게 지시를 내릴지 정합니다" ${on('click', () => ctl.cycleControl())}>집중: ${derived(controlMode, (mode) => CONTROL_MODES.find((c) => c.id === mode)!.label)} <kbd>F</kbd></button>`;

    const requestExit = () => {
        if (!finishOdds || m.state.over) return onExit();
        const wasPaused = ctl.paused();
        ctl.paused.set(true);
        showMusic.set(false);
        exitPrompt.set({ chance: finishOdds(), wasPaused });
    };
    const cancelExit = () => {
        const prompt = exitPrompt();
        if (!prompt) return;
        exitPrompt.set(null);
        ctl.paused.set(prompt.wasPaused);
    };
    const ExitDialog = () => {
        const percent = exitPrompt()!.chance * 100;
        const chance = percent > 0 && percent < 1 ? '<1%' : percent < 100 && percent > 99 ? '>99%' : `${Math.round(percent)}%`;
        return Dialog({
            label: '경기를 나가시겠습니까?',
            dismiss: cancelExit,
            children: html`<div class="modal-body match-exit">
            <header><h2>경기를 나가시겠습니까?</h2></header>
            <div class="modal-scroll">
                <p>남은 경기는 현재 스코어에서 시뮬레이션됩니다. 최종 결과는 커리어에 반영됩니다.</p>
                <div class="match-exit-odds"><strong>${chance}</strong><span>시뮬레이션 시 예상 승리 확률</span></div>
            </div>
            <footer><button class="ghost" autofocus ${on('click', cancelExit)}>계속 플레이</button><button class="warn" ${on('click', onExit)}>시뮬레이션하고 나가기</button></footer>
        </div>`,
        });
    };

    const mapScale = 4;
    const mapPoint = (n: number) => String((n + 0.5) * mapScale);
    const mapBall = derived(ctl.tick, () => m.ballCell());
    const mapPlayers = mounted<SVGGElement>((layer) => {
        const dots = new Map<string, SVGCircleElement>();
        const draw = () => {
            const pieces = m.state.pieces;
            const active = m.state.over ? undefined : m.active().id;
            for (const [id, dot] of dots) {
                if (pieces.some((p) => p.id === id)) continue;
                dot.remove();
                dots.delete(id);
            }
            for (const p of pieces) {
                let dot = dots.get(p.id);
                if (!dot) {
                    dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    dot.setAttribute('fill', kitColor(club(p.team).kit));
                    layer.append(dot);
                    dots.set(p.id, dot);
                }
                const current = active === p.id;
                dot.setAttribute('cx', mapPoint(p.pos.x));
                dot.setAttribute('cy', mapPoint(p.pos.y));
                dot.setAttribute('r', current ? '3.4' : '2.4');
                dot.setAttribute('stroke', current ? 'var(--active)' : '#0008');
                dot.setAttribute('stroke-width', current ? '1.5' : '0.8');
            }
        };
        draw();
        return ctl.tick.subscribe(draw);
    });
    const mapWidth = cols * mapScale;
    const mapHeight = rows * mapScale;
    const minimap = html`<div class="minimap"><svg width="${String(mapWidth)}" height="${String(mapHeight)}" viewBox="0 0 ${mapWidth} ${mapHeight}">
        <rect width="100%" height="100%" fill="#2f6b34" />
        <line x1="${mapWidth / 2}" y1="0" x2="${mapWidth / 2}" y2="${mapHeight}" stroke="#fff6" />
        <rect x="0" y="${gTop * mapScale}" width="2" height="${cfg.pitch.goalWidth * mapScale}" fill="#fff" />
        <rect x="${mapWidth - 2}" y="${gTop * mapScale}" width="2" height="${cfg.pitch.goalWidth * mapScale}" fill="#fff" />
        <g ${mapPlayers}></g>
        <circle ${attr({ cx: derived(mapBall, (b) => mapPoint(b.x)), cy: derived(mapBall, (b) => mapPoint(b.y)) })} r="3.2" fill="#fff" stroke="#2f8cff" stroke-width="1.6" />
    </svg></div>`;

    const banner = derived(ctl.banner, (b) =>
        b
            ? html`<div class="banner"><div class="banner-text">${b.text}</div>${b.sub ? html`<div class="banner-sub">${b.sub}</div>` : html``}
              </div>`
            : html``,
    );

    // ------------------------------------------------------------ bench & substitutions
    const BenchPanel = () => {
        // In hotseat, show the bench of the side whose turn it is.
        const team = derived(ctl.tick, (): TeamSide => (ctl.isHuman(0) && ctl.isHuman(1) ? m.active().team : ctl.isHuman(1) ? 1 : 0));
        const onPitch = derived(combined([team, ctl.tick]), ([side]) =>
            m.state.pieces.filter((p) => p.team === side).sort((a, b) => a.stamina - b.stamina),
        );
        const bench = derived(combined([team, ctl.tick]), ([side]) => m.bench(side));
        const left = derived(combined([team, ctl.tick]), ([side]) => String(m.subsLeft(side)));
        const playerName = (side: TeamSide, id: string) =>
            m.state.pieces.find((p) => p.id === id)?.player.name ?? m.bench(side).find((p) => p.id === id)?.name ?? '';
        /** Why this pair can't join the plan: the usual rules, plus what's already planned. */
        const pairProblem = (side: TeamSide, pair: Pair, plan: Pair[]) => {
            if (plan.length && m.subsLeft(side) - ctl.pendingSubs().filter((x) => x.team === side).length - plan.length <= 0)
                return '남은 교체 횟수가 없습니다';
            return ctl.subProblem(side, pair.off, pair.on);
        };
        const availability = derived(
            combined([team, ctl.tick, benchPick, ctl.awaitingHuman, ctl.pendingSubs, ctl.halftime]),
            ([side, , pick]) => {
                const mine = ctl.isHuman(side);
                const n = pick.plan.length;
                // straight away at half time or on your own turn (if that player isn't busy), otherwise at the next break
                const later = pick.plan.filter((x) => !ctl.canSubNow(side, x.off, x.on)).length;
                const what = n === 1 ? '교체 실행' : `${n}명 교체 실행`;
                return {
                    disabled: !mine || n === 0,
                    label:
                        n === 0
                            ? '교체 실행'
                            : later === 0
                              ? what
                              : later === n
                                ? `${what} (다음 휴식 때)`
                                : `${what} (${later}명은 다음 휴식 때)`,
                    hint:
                        pick.msg ??
                        (!mine
                            ? '관전 중: AI가 자체적으로 벤치를 운영합니다.'
                            : pick.off || pick.on
                              ? `이제 ${pick.off ? '들어올' : '나갈'} 선수를 고르세요.`
                              : n
                                ? '교체를 더 추가하거나 실행하세요. 계획된 선수를 클릭하면 그 교체가 취소됩니다.'
                                : '나갈 선수 한 명, 들어올 선수 한 명을 고르세요. 더 교체하려면 반복하세요. 지친 선수는 덜 움직이고(50 미만) 반응도 나빠집니다(25 미만).'),
                };
            },
        );
        const queued = derived(combined([team, ctl.pendingSubs]), ([side, list]) =>
            list.filter((x) => x.team === side).map((x) => `${playerName(side, x.off)} ⇄ ${playerName(side, x.on)}`),
        );
        const plan = derived(benchPick, (pick) => pick.plan);
        const choose = (slot: 'off' | 'on', id: string) =>
            on('click', () => {
                const pick = benchPick();
                // clicking a planned player drops that change
                if (pick.plan.some((x) => x[slot] === id)) {
                    benchPick.set({ ...pick, plan: pick.plan.filter((x) => x[slot] !== id), msg: null });
                    return;
                }
                const next = { ...pick, [slot]: pick[slot] === id ? null : id, msg: null };
                if (next.off && next.on) {
                    const pair = { off: next.off, on: next.on };
                    const why = pairProblem(team(), pair, pick.plan);
                    if (why) {
                        audio.play('error');
                        benchPick.set({ ...next, [slot]: null, msg: why });
                    } else benchPick.set({ off: null, on: null, plan: [...pick.plan, pair], msg: null });
                } else benchPick.set(next);
            });
        const rowClass = (slot: 'off' | 'on', id: string) =>
            derived(benchPick, (pick) => (pick[slot] === id ? 'on' : pick.plan.some((x) => x[slot] === id) ? 'planned' : ''));
        const unplan = (pair: Pair) => benchPick.update((pick) => ({ ...pick, plan: pick.plan.filter((x) => x !== pair), msg: null }));
        const go = () => {
            const side = team();
            const { plan: changes } = benchPick();
            if (!changes.length || availability().disabled) return;
            const failed: Pair[] = [];
            let msg: string | null = null;
            for (const x of changes) {
                const err = ctl.substitute(side, x.off, x.on);
                if (err) {
                    failed.push(x);
                    msg = `${playerName(side, x.off)}: ${err}`;
                }
            }
            benchPick.set({ off: null, on: null, plan: failed, msg });
            if (!failed.length) showBench.set(false);
        };
        return html`<div class="modal-body bench-panel">
            <header><h2>벤치 · ${derived(team, (side) => club(side).short)}</h2><span class="subs-left">교체 ${left} / ${String(cfg.subs.max)}회 남음</span><button class="ghost" ${on('click', () => showBench.set(false))}>닫기 <kbd>Esc</kbd></button></header>
            <div class="modal-scroll">
                <div class="bench-grid">
                    <section><h4>경기장 <small>지친 순서</small></h4><ul class="bench-list">${$each(onPitch)
                        .$withKey((p) => p.id)
                        .$as((p) => {
                            const sprite = derived(recolorVersion, () => spriteStyle(cfg, p.player.sprite, 'idle', 'down', p.player));
                            const stamina = derived(ctl.tick, () => Math.round(p.stamina));
                            return html`<li ${attr({ class: rowClass('off', p.id) })} ${choose('off', p.id)}>
                            <div class="sprite still" ${attr({ style: sprite })}></div>
                            <b>#${String(p.player.number)} ${p.player.name}</b><span class="cl">${cfg.classes[p.player.cls].short}</span>
                            <span ${attr({ class: derived(stamina, (n) => `stam-bar ${n < cfg.fatigue.exhausted ? 'low' : n < cfg.fatigue.tired ? 'mid' : ''}`) })}><i ${attr({ style: derived(stamina, (n) => `width:${n}%`) })}></i></span><span class="num">${derived(stamina, String)}</span>
                        </li>`;
                        })}</ul></section>
                    <section><h4>벤치</h4>${$if(derived(bench, (players) => players.length > 0))
                        .$then(
                            () => html`<ul class="bench-list">
                        ${$each(bench)
                            .$withKey((p) => p.id)
                            .$as((p) => {
                                const sprite = derived(recolorVersion, () => spriteStyle(cfg, p.sprite, 'idle', 'down', p));
                                return html`<li ${attr({ class: rowClass('on', p.id) })} ${choose('on', p.id)}>
                                <div class="sprite still" ${attr({ style: sprite })}></div>
                                <b>#${String(p.number)} ${p.name}</b><span class="cl">${classLabel(cfg, p)}</span><span class="num">레벨 ${String(p.level)}</span>
                            </li>`;
                            })}
                    </ul>`,
                        )
                        .$else(() => html`<p class="muted">벤치에 남은 선수가 없습니다.</p>`)}</section>
                </div>
            </div>
            <div class="bench-plan">${$each(plan).$as(
                (x) =>
                    html`<span class="plan-chip"><b>${playerName(team(), x.off)}</b> 아웃 · <b>${playerName(team(), x.on)}</b> 인<button type="button" class="ghost" title="이 교체 취소" ${on('click', () => unplan(x))}>×</button></span>`,
            )}</div>
            <footer class="bench-foot">
                ${$if(derived(queued, (list) => list.length > 0)).$then(() => html`<span class="bench-queued">다음 휴식: ${derived(queued, (list) => list.join(' · '))}</span>`)}
                <span class="muted">${derived(availability, (a) => a.hint)}</span>
                <button class="primary" ${attr({ disabled: derived(availability, (a) => a.disabled) })} ${on('click', go)}>${derived(availability, (a) => a.label)}</button>
            </footer>
        </div>`;
    };

    // ------------------------------------------------------------ keyboard + resize
    const lifecycle = mounted<HTMLDivElement>(() => {
        const onKey = (e: KeyboardEvent) => {
            if (exitPrompt()) {
                if (e.key === 'Escape') cancelExit();
                return;
            }
            if (showMusic() && e.key === 'Escape') {
                showMusic.set(false);
                return;
            }
            if (e.target instanceof Element && e.target.closest('.match-radio')) return;
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
            if (ctl.tip() && (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape')) {
                e.preventDefault();
                ctl.dismissTip();
                return;
            }
            if (ctl.intro()) {
                if (artReady() && (e.key === 'Enter' || e.code === 'Space' || e.key === 'Escape')) {
                    e.preventDefault();
                    ctl.introDone();
                }
                return;
            }
            if (ctl.lesson()?.info && e.key === 'Enter') {
                e.preventDefault();
                ctl.nextLesson();
                return;
            }
            if (e.code === 'Space') {
                e.preventDefault();
                ctl.pass();
            } else if (e.key === 't' || e.key === 'T') ctl.input({ t: 'act', d: { kind: 'tackle' } });
            else if (e.key === 'a' || e.key === 'A') ctl.input({ t: 'auto' });
            else if (e.key === 'Escape') {
                if (inspected()) return inspected.set(null);
                ctl.mode.set(null);
                showPlaybook.set(false);
                showBench.set(false);
            } else if (e.key === 'b' || e.key === 'B') showBench.update((v) => !v);
            else if (e.key === 'h' || e.key === 'H') showPlaybook.update((v) => !v);
            else if (e.key === 'f' || e.key === 'F') ctl.cycleControl();
            else if (e.key === 'p' || e.key === 'P') ctl.togglePause();
            else if (e.key === 'z' || e.key === 'Z') setPref('showZoc', !prefs().showZoc);
            else if (e.key === '+' || e.key === '=') zoomBias.update((z) => Math.min(1.8, z * 1.12));
            else if (e.key === '-' || e.key === '_') zoomBias.update((z) => Math.max(0.6, z / 1.12));
            else if (e.key === '0') zoomBias.set(1);
            else if (e.key === 'c' || e.key === 'C') pan.set({ x: 0, y: 0 });
            else if (e.key.startsWith('Arrow')) {
                e.preventDefault();
                const step = e.shiftKey ? 240 : 90;
                // arrows move the view, so the pitch slides the other way
                nudge(
                    e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0,
                    e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0,
                );
            } else if (e.key === 'm' || e.key === 'M') setPref('muted', !prefs().muted);
            else if (/^[1-9]$/.test(e.key)) {
                const id = phaseAbilities(m.active())[Number(e.key) - 1];
                if (id) ctl.useAbility(id);
            }
        };
        const closeMusic = (e: PointerEvent) => {
            if (showMusic() && e.target instanceof Element && !e.target.closest('.match-radio')) showMusic.set(false);
        };
        window.addEventListener('keydown', onKey);
        window.addEventListener('pointerdown', closeMusic);
        // palette-swapped strips arrive asynchronously: redraw when they land, warm the common ones now
        const unRecolor = recolorVersion.subscribe(() => ctl.bump());
        const unwatchTurn = ctl.tick.subscribe(recenterOnTurn);
        const unwatchInput = ctl.awaitingHuman.subscribe(() => infoFor.set(null));
        const unwatchInspect = activePiece.subscribe(() => inspected.set(null));
        for (const p of m.state.pieces) prewarmPlayer(p.player.sprite, p.player, p.player.cls === 'keeper');
        // kickoff waits for the warm strips and never starts with them unfinished: failed loads are
        // retried on every check, and after 15s the intro says so instead of kicking off anyway
        const warmList = m.state.pieces.map((p) => ({ sprite: p.player.sprite, player: p.player, keeper: p.player.cls === 'keeper' }));
        const artStart = performance.now();
        const checkArt = () => {
            if (warmStripsReady(warmList, checkArt)) {
                if (!artReady()) paintWarm(warmList);
                artReady.set(true);
            }
            else if (performance.now() - artStart > 15000) artSlow.set(true);
        };
        const artTimer = setInterval(() => {
            checkArt();
            if (artReady()) clearInterval(artTimer);
        }, 150);
        checkArt();
        const wheel = (e: WheelEvent) => {
            if (!(e.target as HTMLElement).closest('.viewport')) return;
            e.preventDefault();
            zoomBias.update((z) => Math.max(0.6, Math.min(1.8, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08))));
        };
        window.addEventListener('wheel', wheel, { passive: false });
        // drag to pan: right/middle button at once, left button after a short move (so clicks still work)
        let drag: { x: number; y: number; px: number; py: number; moved: boolean; button: number } | null = null;
        let swallowClick = false;
        const down = (e: PointerEvent) => {
            if (!(e.target as HTMLElement).closest('.viewport') || e.button > 2) return;
            const o = pan();
            drag = { x: e.clientX, y: e.clientY, px: o.x, py: o.y, moved: e.button !== 0, button: e.button };
            if (drag.moved) dragging.set(true);
        };
        const move = (e: PointerEvent) => {
            if (!drag) return;
            const dx = e.clientX - drag.x;
            const dy = e.clientY - drag.y;
            if (!drag.moved && Math.hypot(dx, dy) > 6) {
                drag.moved = true;
                dragging.set(true);
            }
            if (drag.moved) {
                const sc = viewScale();
                pan.set(clampPan(drag.px + dx / sc, drag.py + dy / sc));
            }
        };
        const up = (e: PointerEvent) => {
            if (drag?.button === 2 && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= 6) {
                const t = e.target as HTMLElement;
                const at = t.dataset?.x !== undefined ? m.pieceAt({ x: Number(t.dataset.x), y: Number(t.dataset.y) }) : undefined;
                inspected.set(at && ctl.isHuman(at.team) ? (inspected() === at.id ? null : at.id) : null);
            }
            if (drag?.moved && drag.button === 0) swallowClick = true;
            drag = null;
            dragging.set(false);
        };
        const click = (e: MouseEvent) => {
            if (!swallowClick) return;
            swallowClick = false;
            e.stopPropagation();
            e.preventDefault();
        };
        const noMenu = (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.viewport')) e.preventDefault();
        };
        window.addEventListener('pointerdown', down);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
        window.addEventListener('click', click, true);
        window.addEventListener('contextmenu', noMenu);
        audio.unlock();
        void ctl.run();
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('pointerdown', closeMusic);
            window.removeEventListener('wheel', wheel);
            window.removeEventListener('pointerdown', down);
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            window.removeEventListener('click', click, true);
            window.removeEventListener('contextmenu', noMenu);
            unRecolor();
            clearInterval(artTimer);
            unwatchTurn();
            unwatchInput();
            unwatchInspect();
            ctl.stop();
        };
    });

    const pieces = derived(distinct(derived(ctl.tick, () => m.state.pieces.map((p) => p.id).join(','))), () => [...m.state.pieces]);
    const matchContent = html`<div>
        <div ${attr({ class: shakeClass })}>
            <div class="world" ${attr({ style: camera })}>
                <div class="pitch cond-${stadium.condition}" style="width:${W}px;height:${H}px" ${pitchLayer}></div>
                <div class="grid" style="width:${W}px;height:${H}px" ${gridLayer}></div>
                <div class="overlays">
                    ${$each(zoc)
                        .$withKey((z) => z.k)
                        .$as(
                            (z) =>
                                html`<div class="zoc zoc-${z.kind}" style="left:${px(z.x)}px;top:${px(z.y)}px;width:${C}px;height:${C}px"></div>`,
                        )}
                    ${$each(overlays)
                        .$withKey((o) => o.k)
                        .$as(
                            (o) =>
                                html`<div class="ov ov-${o.kind}" style="left:${px(o.x)}px;top:${px(o.y)}px;width:${C}px;height:${C}px">${o.label ? html`<span class="ov-label">${o.label}</span>` : html``}</div>`,
                        )}
                    ${$each(reactors)
                        .$withKey((p) => p.id)
                        .$as(
                            (p) =>
                                html`<div class="reactor" ${attr({ style: derived(ctl.tick, () => `left:${cx(ctl.shownPos(p).x)}px;top:${px(ctl.shownPos(p).y) + C / 2}px`) })}></div>`,
                        )}
                </div>
                <div class="tokens">
                    ${stadiumProps(stadium, conditions, kitColor(club(0).kit), { L: px(0), T: px(0), PW: cols * C, PH: rows * C, C, W, H, S: cfg.sprites.renderPx / cfg.sprites.framePx })}
                    ${goalSprite('left')}${goalSprite('right')}
                    ${$each(pieces)
                        .$withKey((p) => p.id)
                        .$as(Token)}
                    <div ${attr({ class: ballClass, style: ballStyle })}>
                        <div class="ball-shadow"></div><div class="ball-ring"></div>
                        <div class="stand"><img class="ball-img" src="assets/props/ball_classic.png" ${attr({ style: ballImgStyle })} /></div>
                    </div>
                    ${$each(ctl.popups)
                        .$withKey((p) => p.id)
                        .$as(
                            (p) =>
                                html`<div class="popup ${p.tone}" style="left:${cx(p.at.x)}px;top:${px(p.at.y)}px"><div class="stand"><span>${p.text}</span></div></div>`,
                        )}
                    ${$each(ctl.bursts)
                        .$withKey((b) => b.id)
                        .$as(burst)}
                </div>
            </div>
        ${atmosphere(conditions)}
        </div>

        <header class="hud-top">
            <div class="team t0 ${isLightKit(club(0).kit) ? 'light' : ''}" style="--kit:${kitColor(club(0).kit)}"><span class="team-name">${club(0).name}</span>${ctl.isHuman(0) ? html`<em>나</em>` : html``}</div>
            <div class="score"><b>${scoreText(0)}</b><span>–</span><b>${scoreText(1)}</b></div>
            <div class="team t1 ${isLightKit(club(1).kit) ? 'light' : ''}" style="--kit:${kitColor(club(1).kit)}">${ctl.isHuman(1) ? html`<em>나</em>` : html``}<span class="team-name">${club(1).name}</span></div>
            <div class="round">${roundText}</div>
            ${noTimer ? html`<div class="round notimer">타이머 없음 · 천천히 하세요</div>` : html`<div class="timer"><i ${attr({ style: timerStyle })}></i></div>`}
        </header>
        ${$render(caption)}

        <aside class="hud-left">${$render(activeCard)}
            <div class="legend">
                <div><i class="sw move"></i>이동 범위</div>
                <div><i class="sw scatter"></i>공이 떨어질 수 있는 곳</div>
                <div><i class="sw danger"></i>반응 구역</div>
                <div><i class="sw active"></i>현재 선수</div>
                <div><i class="sw pick"></i>목표 선택 / 침투 구역</div>
                <div ${on('click', () => setPref('showZoc', !prefs().showZoc))} class="legend-toggle"><i class="sw zoc"></i>상대 압박 구역 <kbd>Z</kbd></div>
                <div><i class="sw zoc-own"></i>우리 커버</div>
                <div class="legend-cam">드래그 또는 방향키: 화면 이동 · 휠: 확대/축소 · <kbd>C</kbd> 가운데로</div>
            </div>
        </aside>
        <aside class="hud-right">
            <div class="tools" role="group" aria-label="경기 컨트롤">
                <button type="button" class="exit" title="경기 나가기" ${on('click', requestExit)}>메뉴</button>
                ${MatchRadioButton(showMusic)}
                <button type="button" title="전술 노트 (H)" aria-label="전술 노트" ${on('click', () => showPlaybook.update((v) => !v))}>?</button>
                <button type="button" title="벤치와 교체 (B)" aria-label="벤치와 교체" ${on('click', () => showBench.update((v) => !v))}>⇄</button>
                <button type="button" title="일시정지 (P)" aria-label="일시정지" ${on('click', () => ctl.togglePause())}>❚❚</button>
                ${onSettings ? html`<button type="button" title="설정" aria-label="설정" ${on('click', onSettings)}>⚙</button>` : html``}
            </div>
            ${$if(showMusic).$then(MatchRadioControls)}
            ${focusChip}
            ${minimap}${queue}${log}</aside>
        <footer class="hud-bottom">
            ${$render(abilityInfo)}
            <div class="dock-head">${phaseStep}<div class="hint" ${attr({ title: hint })}>${hint}</div></div>
            ${actions}
        </footer>

        ${$if(showPlaybook).$then(() =>
            Dialog({
                label: '전술 노트',
                dismiss: () => showPlaybook.set(false),
                children: html`
            <div class="modal-body"><header><h2>전술 노트</h2><button class="ghost" ${on('click', () => showPlaybook.set(false))}>닫기 <kbd>Esc</kbd></button></header><div class="modal-scroll">${Playbook(cfg)}</div></div>`,
            }),
        )}
        ${$if(ctl.halftime).$then(() => HalftimeReport(ctl, { onContinue: () => ctl.endHalftime(), onBench: () => showBench.set(true) }))}
        ${$if(showBench).$then(() => Dialog({ label: '벤치와 교체', dismiss: () => showBench.set(false), children: BenchPanel() }))}
        ${$render(tipPanel)}
        ${$if(ctl.intro).$then(introOverlay)}
        ${$render(lessonPanel)}
        ${$if(derived(combined([ctl.paused, benchPause]), ([paused, bench]) => paused && !bench)).$then(() => html`<div class="pause-veil"><div class="banner"><div class="banner-text">일시정지</div><div class="banner-sub">해설을 읽고 다음 수를 계획하세요. P 키로 재개합니다.</div><button class="primary" ${on('click', () => ctl.togglePause())}>재개</button></div></div>`)}
        ${$render(toast)}
        ${$render(banner)}
        ${$if(derived(ctl.report, Boolean)).$then(() => {
            const [home, away] = m.state.score;
            const cupDraw = knockout && home === away;
            const label = cupDraw ? '승부차기 진행' : finishOdds ? '클럽으로 돌아가기' : '메뉴로 돌아가기';
            return MatchReport(ctl, onExit, label, cupDraw ? '컵 대결이 승부차기로 이어집니다.' : undefined);
        })}
    </div>`;
    return html`<div class="match" ${lifecycle}>${matchContent}${$if(derived(exitPrompt, Boolean)).$then(ExitDialog)}</div>`;
};

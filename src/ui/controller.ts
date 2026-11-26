/**
 * Bridges the engine to the view: owns the match loop, the action timer, AI pacing,
 * human input, and transient presentation state (animations, popups, banners, sound,
 * commentary, coach tips). The engine state is mutable; `tick` is bumped after every
 * change and the view derives from it.
 */
import { grain } from '@grainular/grains';
import { describePlays, type PlayKind } from './playbyplay';
import { applyAct, applyMove, Brain, type ActDecision, type MoveDecision } from '../ai/brain';
import type { Difficulty, GameConfig, TeamStyle } from '../config';
import { abilityDef, type AbilityId } from '../engine/abilities';
import { cheb, dist, eq, forward, key } from '../engine/grid';
import { Match, type KickAbility, type MoveAbility } from '../engine/match';
import { MatchStats } from '../engine/stats';
import { createRng } from '../rng';
import type { Conditions, Stadium } from '../world/stadium';
import type { Cell, Club, MatchEvent, Piece, Referee, TeamSide } from '../types';
import { audio } from './audio';
import { Commentator, type Line } from './commentary';
import { CONTROL_MIN_NEAREST, CONTROL_MODES, CONTROL_RADIUS, prefs, setPref } from './prefs';
import { kitColor } from './kits';
import { fillTip, TIPS, type TipCtx } from './tips';
import { castFor, type Lesson } from './tutorial';

export type Controller = 'human' | 'ai';
export type MatchOptions = {
    controllers: [Controller, Controller];
    difficulty: Difficulty;
    seed: number;
    /** The ground and the day's conditions (cosmetic + weather scatter, applied via cfg by the caller). */
    stadium?: Stadium;
    conditions?: Conditions;
    /** Match prep: the official, and a game plan per side (drives that side's AI / auto-players). */
    referee?: Referee;
    plans?: [TeamStyle | null, TeamStyle | null];
    /** Run the training-ground lessons instead of a match. */
    tutorial?: Lesson[];
    /** Career: the narrative lines for the pre-match intro (table, form, derby, mood, plan). */
    story?: string[];
};

export type Popup = { id: number; at: Cell; text: string; tone: 'good' | 'bad' | 'neutral' | 'card' | 'red' };
export type Banner = { text: string; sub?: string } | null;
export type Burst = { id: number; at: Cell; kind: 'confetti' | 'dust'; colors: string[] };
export type CommentaryLine = Line & { id: number; minute: number };
type Input =
    | { t: 'move'; d: MoveDecision }
    | { t: 'act'; d: ActDecision }
    | { t: 'auto' }
    | { t: 'place'; id: string; to: Cell }
    | { t: 'setupDone' }
    | { t: 'timeout' }
    | { t: 'stop' };

/** What led to a corner or free kick, from the events just before it. */
const setPieceReason = (events: MatchEvent[], i: number, m: Match): string => {
    for (let k = i - 1; k >= 0; k--) {
        const e = events[k]!;
        if (e.t === 'save') return '골대 옆으로 쳐냄';
        if (e.t === 'intercept' && e.success) return e.block ? '수비에 막혀 골라인 밖으로' : '굴절되어 골라인 밖으로';
        if (e.t === 'header') return '헤딩으로 골라인 밖으로';
        if (e.t === 'wide') return '수비수에 맞고 나감';
        if (e.t === 'foul') return `${m.piece(e.by).player.name} 선수의 파울`;
        if (e.t === 'kick') return '굴절되어 골라인 밖으로';
    }
    return '';
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const MOVE_MODES: AbilityId[] = ['sprint', 'run', 'press', 'rush'];
export const KICK_MODES: AbilityId[] = ['placed', 'power', 'chip', 'through', 'cross'];
export const TARGET_MODES: AbilityId[] = ['mark', 'tempo'];

/** A line in the live simulation feed: a play (from the events) or a commentator's line. */
export type SimLine = { kind: PlayKind | 'talk'; text: string; team: TeamSide | null; minute: number; voice: boolean };

export class MatchController {
    readonly match: Match;
    readonly cfg: GameConfig;
    readonly stats: MatchStats;
    readonly tick = grain(0);
    readonly hover = grain<Cell | null>(null);
    readonly timer = grain(1);
    readonly banner = grain<Banner>(null);
    readonly popups = grain<Popup[]>([]);
    /** Scatter zone of the kick currently in flight (shown for AI and human kicks alike). */
    readonly flightZone = grain<{ target: Cell; radius: number } | null>(null);
    readonly awaitingHuman = grain(false);
    /** Selected targeted ability (move mode / kick type / pick-a-player). */
    readonly mode = grain<AbilityId | null>(null);
    /** Ability being hovered in the dock: overlays preview it without committing. */
    readonly preview = grain<AbilityId | null>(null);
    /** Commentary, newest first, and the big broadcast caption for headline moments. */
    readonly commentary = grain<CommentaryLine[]>([]);
    readonly caption = grain<{ title: string; text: string; team: TeamSide | null } | null>(null);
    /** Juice: screen shake counter, net billow side, particle bursts, lofted-ball arc. */
    readonly shake = grain(0);
    readonly net = grain<'left' | 'right' | null>(null);
    readonly bursts = grain<Burst[]>([]);
    readonly ballArc = grain<{ ms: number; height: number; id: number; spin: number } | null>(null);
    /** Coach tip on screen (pauses the clock). */
    readonly tip = grain<{ id: string; title: string; text: string } | null>(null);
    readonly toast = grain<string | null>(null);
    /** Final whistle: the view shows the match report. */
    readonly report = grain(false);
    /** Set-piece setup: the player picked up for placing. */
    readonly setupSel = grain<string | null>(null);
    /** Tutorial: the lesson on screen (with a retry note or praise), and the end card. */
    readonly lesson = grain<{
        i: number;
        n: number;
        title: string;
        text: string;
        retry: string | null;
        praise: string | null;
        info: boolean;
    } | null>(null);
    readonly tutorialDone = grain(false);
    private resolveLesson: (() => void) | null = null;
    private tutEvents: MatchEvent[] = [];
    /** Half time: the overview is up until the manager starts the second half. */
    readonly halftime = grain(false);
    private resolveHalftime: (() => void) | null = null;
    /** Close the half-time overview and play the second half. */
    endHalftime() {
        const r = this.resolveHalftime;
        this.resolveHalftime = null;
        r?.();
    }
    /** Pre-match overview (squads on the pitch, commentators, ground) is showing. */
    readonly intro = grain(false);
    private resolveIntro: (() => void) | null = null;
    /** Close the pre-match overview and kick off. */
    introDone(click = true) {
        const r = this.resolveIntro;
        if (!r) return;
        this.resolveIntro = null;
        if (click) audio.play('click');
        r();
    }
    /** Player pause (P): freezes the clock and the AI between actions. */
    readonly paused = grain(false);

    /** Per-piece transient animation override and move transition duration. */
    readonly anim = new Map<string, { name: string; until: number }>();
    readonly moveMs = new Map<string, number>();
    ballMs = 0;
    /** Where the ball is drawn while a kick plays out (the match state already holds the outcome). */
    ballAt: Cell | null = null;
    /**
     * The engine settles a whole action at once, so a corner's shape is already arranged while the
     * shot and the save are still being shown. Until the set-piece moment the view draws these
     * positions (and the ball stays where the play left it).
     */
    posOverride: Map<string, Cell> | null = null;
    shownPos = (p: Piece): Cell => this.posOverride?.get(p.id) ?? p.pos;
    /** The camera rides with the ball for the length of a kick. */
    followBall = false;

    private brains: [Brain, Brain];
    private commentator: Commentator;
    private resolveInput: ((i: Input) => void) | null = null;
    private resolveTip: (() => void) | null = null;
    private popupId = 0;
    private lineId = 0;
    private stopped = false;
    private timerRaf = 0;
    private humanTurns = 0;
    private reactionHitUs = false;
    private lastWasHuman = false;

    constructor(
        cfg: GameConfig,
        clubs: [Club, Club],
        readonly opts: MatchOptions,
    ) {
        this.cfg = cfg;
        this.match = new Match(cfg, clubs, opts.seed, 0, opts.referee);
        this.stats = new MatchStats(this.match);
        this.commentator = new Commentator(this.match);
        this.brains = [
            new Brain(this.match, createRng(opts.seed ^ 0x9e3779b9), opts.difficulty),
            new Brain(this.match, createRng(opts.seed ^ 0x85ebca6b), opts.difficulty),
        ];
        opts.plans?.forEach((pl, t) => {
            if (pl) this.brains[t]!.styleOverride = pl;
        });
    }

    /** The playing style a side uses this match (club identity or the human's game plan). */
    teamStyle = (team: TeamSide) => this.brains[team].styleFor(team);
    isHuman = (team: TeamSide) => this.opts.controllers[team] === 'human';
    bump = () => this.tick.update((n) => n + 1);

    /** Does this human-side piece ask for orders under the current focus mode? */
    needsOrders = (p: Piece) => {
        if (!this.isHuman(p.team)) return false;
        if (this.opts.tutorial) return true;
        const mode = prefs().controlMode;
        if (mode === 'all') return true;
        const m = this.match;
        if (m.carrier()?.id === p.id) return true;
        const b = m.ballCell();
        if (cheb(p.pos, b) <= CONTROL_RADIUS[mode]) return true;
        // never leave the human just watching: the closest few always get a say
        const d = (q: Piece) => cheb(q.pos, b) * 100 + dist(q.pos, b);
        const nearest = m.state.pieces
            .filter((q) => q.team === p.team)
            .sort((a, c) => d(a) - d(c))
            .slice(0, CONTROL_MIN_NEAREST);
        return nearest.some((q) => q.id === p.id);
    };

    togglePause() {
        if (this.match.state.over) return;
        this.paused.update((p) => !p);
    }

    /** Hold here while the game is paused. */
    private async whilePaused() {
        while (this.paused() && !this.stopped) await sleep(120);
    }

    cycleControl() {
        const order = CONTROL_MODES.map((c) => c.id);
        const next = order[(order.indexOf(prefs().controlMode) + 1) % order.length]!;
        setPref('controlMode', next);
        const def = CONTROL_MODES.find((c) => c.id === next)!;
        this.flash(`포커스: ${def.label} — ${def.note}`);
        this.bump();
    }

    flash(msg: string) {
        this.toast.set(msg);
        setTimeout(() => {
            if (this.toast() === msg) this.toast.set(null);
        }, 2600);
    }

    stop() {
        this.stopped = true;
        this.introDone(false);
        this.endHalftime();
        cancelAnimationFrame(this.timerRaf);
        this.resolveInput?.({ t: 'stop' });
        this.resolveTip?.();
        audio.stopCrowd();
    }

    // ---------------------------------------------------------------- input from the view

    private validMove(d: MoveDecision) {
        const m = this.match;
        const p = m.active();
        if (m.state.phase !== 'move') return false;
        if (d.kind === 'hold') return true;
        if (d.kind === 'trick') return m.abilityUsable(p, 'trick');
        if (d.ability && !m.abilityUsable(p, d.ability)) return false;
        return (m.reachable(p, d.ability).get(key(d.to))?.path.length ?? 0) > 1;
    }

    private validAct(d: ActDecision) {
        const m = this.match;
        const p = m.active();
        if (m.state.phase !== 'act') return false;
        switch (d.kind) {
            case 'end':
                return true;
            case 'kick':
                return m.carrier()?.id === p.id && !!m.kickKind(p, d.target, d.ability) && (!d.ability || m.abilityUsable(p, d.ability));
            case 'tackle':
                return m.canTackle(p);
            case 'mark':
                return m.abilityUsable(p, 'mark') && m.markTargets(p).some((o) => o.id === d.target);
            case 'tempo':
                return m.abilityUsable(p, 'tempo') && m.tempoTargets(p).some((o) => o.id === d.target);
            default:
                return m.abilityUsable(p, d.kind);
        }
    }

    input(i: Input) {
        if (!this.resolveInput) return;
        // validate before resolving so stray clicks don't burn the turn
        if (i.t === 'move' && !this.validMove(i.d)) {
            audio.play('error');
            return;
        }
        if (i.t === 'act' && !this.validAct(i.d)) {
            audio.play('error');
            return;
        }
        if (i.t === 'place' && !this.match.canPlace(i.id, i.to)) {
            audio.play('error');
            return;
        }
        const r = this.resolveInput;
        this.resolveInput = null;
        r(i);
    }

    /** Space: hold in the move phase, end/keep in the act phase. */
    pass() {
        if (this.inSetup()) return this.input({ t: 'setupDone' });
        this.input(this.match.state.phase === 'move' ? { t: 'move', d: { kind: 'hold' } } : { t: 'act', d: { kind: 'end' } });
    }

    /** Ability buttons: targeted ones toggle a mode, instant ones fire. */
    useAbility(id: AbilityId) {
        const m = this.match;
        const p = m.active();
        if (!m.abilityUsable(p, id)) {
            audio.play('error');
            return;
        }
        audio.play('click');
        if (MOVE_MODES.includes(id) || KICK_MODES.includes(id) || TARGET_MODES.includes(id)) {
            this.mode.set(this.mode() === id ? null : id);
            this.bump();
            return;
        }
        if (id === 'trick') this.input({ t: 'move', d: { kind: 'trick' } });
        else if (id === 'slide' || id === 'foul' || id === 'command') this.input({ t: 'act', d: { kind: id } });
    }

    /** Is the human placing players for a set piece right now? */
    inSetup = () => {
        const sp = this.match.state.setPiece;
        return this.settingUp && !!sp && sp.stage === 'setup' && this.isHuman(sp.next) && this.awaitingHuman();
    };

    clickCell(c: Cell) {
        const m = this.match;
        if (this.inSetup()) {
            const q = m.pieceAt(c);
            if (q && m.canPlacePiece(q)) {
                audio.play('click');
                this.setupSel.set(this.setupSel() === q.id ? null : q.id);
                this.bump();
                return;
            }
            const sel = this.setupSel();
            if (sel) this.input({ t: 'place', id: sel, to: c });
            return;
        }
        const p = m.active();
        const mode = this.mode();
        if (m.state.phase === 'move') {
            if (eq(c, p.pos)) return this.input({ t: 'move', d: { kind: 'hold' } });
            const ability = mode && MOVE_MODES.includes(mode) ? (mode as MoveAbility) : undefined;
            return this.input({ t: 'move', d: { kind: 'move', to: c, ability } });
        }
        if (m.state.phase !== 'act') return;
        const target = m.pieceAt(c);
        if (mode === 'mark' || mode === 'tempo') {
            if (target) this.input({ t: 'act', d: { kind: mode, target: target.id } });
            return;
        }
        const carrier = m.carrier();
        if (carrier?.id === p.id) {
            const ability = mode && KICK_MODES.includes(mode) ? (mode as KickAbility) : undefined;
            return this.input({ t: 'act', d: { kind: 'kick', target: c, ability } });
        }
        // clicking the carrier: tackle if adjacent, slide if in reach
        if (carrier && eq(carrier.pos, c)) {
            if (m.canTackle(p)) this.input({ t: 'act', d: { kind: 'tackle' } });
            else if (m.abilityUsable(p, 'slide')) this.input({ t: 'act', d: { kind: 'slide' } });
        }
    }

    dismissTip(forever = false) {
        if (forever) setPref('tips', false);
        this.tip.set(null);
        const r = this.resolveTip;
        this.resolveTip = null;
        r?.();
    }

    /** Show the first unseen tip that applies right now; resolves when dismissed. */
    private async maybeTip() {
        const p = prefs();
        if (!p.tips) return;
        const m = this.match;
        const piece = m.active();
        const ctx: TipCtx = {
            phase: m.state.phase,
            isCarrier: m.carrier()?.id === piece.id,
            canTackle: m.state.phase === 'act' && m.canTackle(piece),
            hasUsableAbility: m.usableAbilities(piece).length > 0,
            humanTurns: this.humanTurns,
            reactionHitUs: this.reactionHitUs,
            name: piece.player.name,
        };
        const tip = TIPS.find((t) => !p.tipsSeen.includes(t.id) && t.when(ctx));
        if (!tip) return;
        setPref('tipsSeen', [...p.tipsSeen, tip.id]);
        this.tip.set({ id: tip.id, title: tip.title, text: fillTip(tip, ctx) });
        await new Promise<void>((r) => (this.resolveTip = r));
    }

    private async waitHuman(tips = true): Promise<Input> {
        if (tips && !this.opts.tutorial) await this.maybeTip();
        if (this.stopped) return { t: 'stop' };
        this.awaitingHuman.set(true);
        const total = this.cfg.match.timerSeconds * 1000;
        let deadline = performance.now() + total;
        let lastTick = 4;
        let lastFrame = performance.now();
        const frame = () => {
            const now = performance.now();
            // paused, or reading a coach tip: the clock stands still
            if (this.paused() || this.tip()) deadline += now - lastFrame;
            lastFrame = now;
            if (total <= 0) {
                this.timer.set(1);
                this.timerRaf = requestAnimationFrame(frame);
                return;
            }
            const left = deadline - now;
            this.timer.set(Math.max(0, left / total));
            const secs = Math.ceil(left / 1000);
            if (secs < lastTick && secs <= 3 && secs > 0) {
                lastTick = secs;
                audio.play('tick');
            }
            if (left <= 0) return this.input({ t: 'timeout' });
            this.timerRaf = requestAnimationFrame(frame);
        };
        this.timerRaf = requestAnimationFrame(frame);
        return new Promise<Input>((res) => (this.resolveInput = res)).finally(() => {
            cancelAnimationFrame(this.timerRaf);
            this.awaitingHuman.set(false);
            this.mode.set(null);
            this.preview.set(null);
        });
    }

    // ---------------------------------------------------------------- loop

    /** Tutorial: the "Continue" button on a read-only lesson. */
    nextLesson() {
        const r = this.resolveLesson;
        this.resolveLesson = null;
        r?.();
    }

    private async runTutorial(lessons: Lesson[]) {
        const m = this.match;
        const k = castFor(m);
        audio.startCrowd();
        await this.showBanner('훈련장', '말로 코치가 안내합니다', 1500);
        for (let i = 0; i < lessons.length && !this.stopped; i++) {
            const L = lessons[i]!;
            let retry: string | null = null;
            for (let attempt = 0; attempt < 30 && !this.stopped; attempt++) {
                const actor = L.stage(m, k);
                if (actor === undefined) break;
                this.ballAt = null;
                this.followBall = false;
                this.lesson.set({ i, n: lessons.length, title: L.title, text: L.text(k), retry, praise: null, info: actor === null });
                for (const p of m.state.pieces) this.moveMs.set(p.id, 450);
                this.ballMs = 450;
                this.bump();
                await sleep(480);
                this.moveMs.clear();
                this.ballMs = 0;
                if (actor === null) {
                    await new Promise<void>((r) => (this.resolveLesson = r));
                    break;
                }
                this.tutEvents = [];
                if (m.state.setPiece) {
                    await this.runSetup();
                    const sp = m.state.setPiece;
                    if (sp) {
                        sp.stage = 'take';
                        m.stageTurn(sp.taker);
                    }
                } else m.stageTurn(actor.id);
                await this.playTurn();
                if (this.stopped) return;
                // a tackle duel owes an extra turn: play it here too, so the lesson shows what a tackle buys
                if (m.state.bonusNext && !m.state.over) {
                    const owed = m.piece(m.state.bonusNext);
                    m.nextTurn();
                    if (m.state.bonusTurn === owed.id) {
                        this.lesson.set({
                            i,
                            n: lessons.length,
                            title: '추가 턴',
                            text:
                                owed.team === 0
                                    ? `빼앗았습니다! 태클에 성공하면 곧바로 한 번 더 행동합니다. ${owed.player.name} 선수가 추가 턴을 얻습니다. 몰려 있는 곳에서 공을 빼내거나 패스하세요(추가 턴에는 슛 불가).`
                                    : `실패했습니다. 태클에 실패하면 ${owed.player.name} 선수가 빠져나갈 무료 턴을 얻습니다. 빠져나가는 모습을 지켜보세요.`,
                            retry: null,
                            praise: null,
                            info: false,
                        });
                        this.bump();
                        await this.playTurn();
                        if (this.stopped) return;
                    }
                }
                const r = L.done ? L.done(this.tutEvents, m, k) : true;
                if (r === true) {
                    this.lesson.set({
                        i,
                        n: lessons.length,
                        title: L.title,
                        text: L.text(k),
                        retry: null,
                        praise: L.praise ?? '좋아요.',
                        info: false,
                    });
                    audio.play('trap');
                    await sleep(2200);
                    break;
                }
                retry = r;
            }
        }
        this.lesson.set(null);
        this.tutorialDone.set(true);
        audio.play('whistleEnd');
    }

    async run() {
        const m = this.match;
        if (this.opts.tutorial) return this.runTutorial(this.opts.tutorial);
        audio.startCrowd();
        const ref = m.state.referee;
        const style = this.cfg.referee.styles[ref.style];
        if (prefs().matchIntro) {
            // the pre-match overview: the view shows it while `intro` is set; Enter, Esc or the button kick off
            this.intro.set(true);
            await new Promise<void>((r) => (this.resolveIntro = r));
            this.intro.set(false);
            if (this.stopped) return;
        }
        await this.showBanner(`${m.state.clubs[0].short} vs ${m.state.clubs[1].short}`, '킥오프', 1100);
        audio.play('whistle');
        this.say(this.commentator.referee(style.note));
        for (const t of [0, 1] as TeamSide[]) {
            if (this.isHuman(t)) continue;
            const st = this.cfg.ai.styles[this.brains[t].styleFor(t)];
            this.say(this.commentator.style(t, st.label, st.note));
        }
        this.say(this.commentator.call([{ t: 'kickoff', team: m.carrier()?.team ?? 0 }]));
        while (!m.state.over && !this.stopped) {
            await this.playTurn();
            if (this.stopped) return;
            await this.runSetup();
            await this.whilePaused();
            if (this.stopped) return;
            const round = m.state.round;
            const ev = m.nextTurn();
            this.bump();
            this.say(this.commentator.call(ev));
            if (m.state.round !== round && !m.state.over) await this.aiSubs();
            if (!m.state.over) await this.humanSubs();
            for (const t of [0, 1] as TeamSide[]) {
                const mood = this.brains[t].mood(t);
                if (mood && mood !== this.moods[t]) this.say(this.commentator.mood(t, mood));
                this.moods[t] = mood;
            }
            for (const e of ev) {
                if (e.t === 'bonus') {
                    this.popup(m.piece(e.id).pos, e.reason === 'beat' ? '태클 돌파' : '추가 턴', 'good');
                    audio.play('ability');
                    await sleep(450);
                }
                if (e.t === 'halftime') {
                    audio.play('whistleEnd');
                    if (this.isHuman(0) || this.isHuman(1)) {
                        // the overview: stats, tired legs, the bench; changes are made on the spot
                        this.halftime.set(true);
                        await new Promise<void>((r) => (this.resolveHalftime = r));
                        this.halftime.set(false);
                        if (this.stopped) return;
                        await this.humanSubs();
                    } else await this.showBanner('전반 종료', `${m.state.score[0]} – ${m.state.score[1]}`, 1800);
                    audio.play('whistle');
                }
                if (e.t === 'fulltime') {
                    audio.play('whistleEnd');
                    audio.stopCrowd();
                    this.banner.set({ text: '경기 종료', sub: `${m.state.score[0]} – ${m.state.score[1]}` });
                    await sleep(1600);
                    this.banner.set(null);
                    this.report.set(true);
                }
            }
        }
    }

    /** At each new round the AI may freshen its legs (and the human's auto-managed side never subs on its own). */
    private async aiSubs() {
        for (const t of [0, 1] as TeamSide[]) {
            if (this.isHuman(t)) continue;
            const d = this.brains[t].decideSub(t);
            if (d) await this.handle(this.match.substitute(t, d.off, d.on));
        }
    }

    /** A goal whose restart the presenter hasn't made yet (it waits for the celebration). */
    private pendingRestart: TeamSide | null = null;

    /** Human substitutions waiting for the next break between turns (your side wasn't on the ball). */
    readonly pendingSubs = grain<Array<{ team: TeamSide; off: string; on: string }>>([]);

    /** Why this change can't be made or queued, or null (counts changes already queued). */
    subProblem(team: TeamSide, offId: string, onId: string): string | null {
        if (!this.isHuman(team)) return 'AI가 자체적으로 벤치를 운영합니다';
        const queued = this.pendingSubs().filter((x) => x.team === team);
        if (this.match.subsLeft(team) - queued.length <= 0) return '남은 교체 횟수가 없습니다';
        if (queued.some((x) => x.off === offId)) return '이미 교체 아웃 예정입니다';
        if (queued.some((x) => x.on === onId)) return '이미 교체 인 예정입니다';
        return this.match.subBlock(team, offId, onId, false);
    }

    /**
     * Human substitution from the bench panel. On your own turn it happens at once (unless that
     * player is acting or on the ball); otherwise it's made at the next break between turns.
     * Returns an error, or null when it was made or queued.
     */
    substitute(team: TeamSide, offId: string, onId: string): string | null {
        const m = this.match;
        const problem = this.subProblem(team, offId, onId);
        if (problem) {
            audio.play('error');
            return problem;
        }
        if (this.canSubNow(team, offId, onId)) {
            this.makeSub(team, offId, onId);
            return null;
        }
        this.pendingSubs.update((list) => [...list, { team, off: offId, on: onId }]);
        this.flash(`교체 예약됨: ${m.piece(offId).player.name} 선수가 다음 휴식 때 교체 아웃`);
        audio.play('click');
        this.bump();
        return null;
    }

    /** A change goes through at once at half time, or on your own turn, if that player isn't busy. */
    canSubNow(team: TeamSide, offId: string, onId: string) {
        const m = this.match;
        if (this.inSetup() || m.subBlock(team, offId, onId)) return false;
        return this.halftime() || (this.awaitingHuman() && m.active().team === team);
    }

    /** Queued changes go through between turns; one that has to wait (on the ball, set piece) stays queued. */
    private async humanSubs() {
        const m = this.match;
        if (!this.pendingSubs().length || this.inSetup()) return;
        const keep: Array<{ team: TeamSide; off: string; on: string }> = [];
        for (const x of this.pendingSubs()) {
            if (m.subBlock(x.team, x.off, x.on, false)) continue; // no longer possible (sent off, match over)
            if (m.subBlock(x.team, x.off, x.on)) keep.push(x);
            else {
                this.makeSub(x.team, x.off, x.on);
                await sleep(500);
            }
        }
        this.pendingSubs.set(keep);
    }

    private makeSub(team: TeamSide, offId: string, onId: string) {
        const m = this.match;
        const ev = m.substitute(team, offId, onId);
        if (!ev.length) return;
        this.stats.observe(ev);
        this.say(this.commentator.call(ev));
        const on = m.piece(ev[0]!.t === 'sub' ? ev[0]!.on : onId);
        this.popup(on.pos, `⇄ ${on.player.name}`, 'good');
        audio.play('whistle');
        this.bump();
    }

    /** Set-piece setup: sides alternate placements (attackers first) until both are done. */
    private settingUp = false;
    private moods: Array<'chase' | 'protect' | null> = [null, null];

    private async runSetup() {
        this.settingUp = true;
        try {
            await this.setupLoop();
        } finally {
            this.settingUp = false;
        }
    }

    private async setupLoop() {
        const m = this.match;
        for (let guard = 0; guard < 20; guard++) {
            const sp = m.state.setPiece;
            if (!sp || sp.stage !== 'setup' || this.stopped || m.state.over) break;
            const team = sp.next;
            await this.whilePaused();
            if (this.stopped) return;
            if (this.isHuman(team)) {
                this.setupSel.set(null);
                this.timer.set(1);
                this.bump();
                const i = await this.waitHuman(false);
                this.setupSel.set(null);
                if (i.t === 'stop' || this.stopped) return;
                if (i.t === 'place') await this.handle(m.place(i.id, i.to));
                else m.skipPlacements(team);
            } else {
                await sleep(this.cfg.match.aiThinkMs * 0.7);
                await this.whilePaused();
                if (this.stopped) return;
                const d = this.brains[team].decidePlacement(team);
                if (d) await this.handle(m.place(d.id, d.to));
                else m.passPlacement(team);
            }
            this.bump();
        }
    }

    private async playTurn() {
        const m = this.match;
        const p = m.active();
        const brain = this.brains[p.team];
        const human = this.needsOrders(p);
        const autoHuman = this.isHuman(p.team) && !human;
        this.stats.onTurn();
        this.timer.set(1);
        this.bump();
        audio.setTension(Math.max(forward(this.cfg, 0, m.ballCell()), forward(this.cfg, 1, m.ballCell())) ** 3);
        if (human) {
            this.humanTurns++;
            if (!this.lastWasHuman) audio.play('yourTurn');
        }
        this.lastWasHuman = human;
        // a free kick is about to be taken: make it an occasion
        if (p.status.fouled && m.carrier()?.id === p.id && !m.state.setPiece) {
            audio.play('whistle');
            await this.showBanner('프리킥', `${p.player.name} · ${m.state.clubs[p.team].short}`, 900);
        }
        const think = autoHuman ? this.cfg.match.aiThinkMs * 0.35 : this.cfg.match.aiThinkMs;
        await this.whilePaused();
        if (this.stopped) return;

        // ---- move phase (a pre ability like Trick keeps us here)
        for (let guard = 0; guard < 4 && m.state.phase === 'move'; guard++) {
            let d: MoveDecision;
            if (human) {
                const i = await this.waitHuman();
                if (i.t === 'stop' || this.stopped) return;
                if (i.t === 'timeout') return this.handle(this.handleTimeout());
                if (i.t === 'act') {
                    m.endTurn();
                    return;
                }
                d = i.t === 'move' ? i.d : brain.decideMove(p);
            } else {
                await sleep(think);
                await this.whilePaused();
                if (this.stopped) return;
                d = brain.decideMove(p);
            }
            await this.handle(applyMove(m, d));
            if (d.kind !== 'trick') break;
        }
        if (m.state.phase === 'move') m.hold();
        if (m.state.phase !== 'act' || this.stopped || !m.state.pieces.includes(p)) return;

        // ---- act phase
        this.timer.set(1);
        this.bump();
        let a: ActDecision;
        if (human) {
            const i = await this.waitHuman();
            if (i.t === 'stop' || this.stopped) return;
            if (i.t === 'timeout') return this.handle(this.handleTimeout());
            a = i.t === 'act' ? i.d : brain.decideAct(p);
        } else {
            await sleep(think * 0.8);
            await this.whilePaused();
            if (this.stopped) return;
            a = brain.decideAct(p);
        }
        await this.handle(applyAct(m, a));
    }

    /**
     * Live simulation (quick sim, finishing a match early): one whole turn played by the AI for both
     * sides, synchronously and without any presentation. Returns the turn's play-by-play and the
     * commentators' lines, each stamped with the match minute. Stats keep counting as usual.
     */
    simTurn(): Array<SimLine> {
        const m = this.match;
        if (m.state.over) return [];
        const out: SimLine[] = [];
        const minute = () => this.stats.minute();
        const take = (events: MatchEvent[]) => {
            if (!events.length) return;
            const goalsBefore = this.stats.goals.length;
            this.stats.observe(events);
            const assist = this.stats.goals.length > goalsBefore ? this.stats.goals.at(-1)!.assist : undefined;
            for (const play of describePlays(m, events)) out.push({ ...play, minute: minute(), voice: false });
            for (const l of this.commentator.call(events, assist))
                out.push({ kind: 'talk', text: l.text, team: l.team, minute: minute(), voice: true });
            for (const e of events) if (e.t === 'goal') take(m.restartAfterGoal(e.team));
        };
        // the match was left during a goal celebration: kick off again first
        if (this.pendingRestart !== null) {
            const team = this.pendingRestart;
            this.pendingRestart = null;
            take(m.restartAfterGoal(team));
        }
        // a set piece being lined up: both sides place their players
        for (let guard = 0; guard < 24 && m.state.setPiece?.stage === 'setup'; guard++) {
            const t = m.state.setPiece.next;
            const d = this.brains[t].decidePlacement(t);
            if (d) take(m.place(d.id, d.to));
            else m.passPlacement(t);
        }
        const p = m.active();
        const brain = this.brains[p.team];
        this.stats.onTurn();
        for (let guard = 0; guard < 3 && m.state.phase === 'move'; guard++) {
            const d = brain.decideMove(p);
            take(applyMove(m, d));
            if (d.kind !== 'trick') break;
        }
        if (m.state.phase === 'move') m.hold();
        if (m.state.phase === 'act' && m.state.pieces.includes(p)) take(applyAct(m, brain.decideAct(p)));
        m.state.phase = 'done';
        const round = m.state.round;
        take(m.nextTurn());
        // at each new round both benches may freshen legs (the AI picks for the manager too)
        if (m.state.round !== round && !m.state.over)
            for (const t of [0, 1] as TeamSide[]) {
                const d = this.brains[t].decideSub(t);
                if (d) take(m.substitute(t, d.off, d.on));
            }
        this.bump();
        return out;
    }

    private handleTimeout() {
        const m = this.match;
        if (this.cfg.match.timeoutPolicy === 'auto') {
            const p = m.active();
            const b = this.brains[p.team];
            if (m.state.phase === 'move') {
                const d = b.decideMove(p);
                return applyMove(m, d.kind === 'trick' ? { kind: 'hold' } : d);
            }
            return applyAct(m, b.decideAct(p));
        }
        return m.timeout();
    }

    /** Every batch of engine events: stats, commentary, then animate. */
    private async handle(events: MatchEvent[]) {
        this.tutEvents.push(...events);
        const sp = events.find((e) => e.t === 'setpiece');
        if (sp && sp.t === 'setpiece') this.posOverride = new Map(Object.entries(sp.from));
        const goalsBefore = this.stats.goals.length;
        this.stats.observe(events);
        const assist = this.stats.goals.length > goalsBefore ? this.stats.goals.at(-1)!.assist : undefined;
        this.say(this.commentator.call(events, assist));
        for (const e of events) {
            if ((e.t === 'tackle' && e.reaction && e.success) || (e.t === 'intercept' && e.success)) {
                const victim = e.t === 'tackle' ? this.match.piece(e.on) : null;
                const byTeam = this.match.piece(e.by).team;
                if (this.isHuman((1 - byTeam) as TeamSide) || (victim && this.isHuman(victim.team))) this.reactionHitUs = true;
            }
        }
        await this.present(events);
    }

    private say(lines: Line[]) {
        if (!lines.length) return;
        const minute = this.stats.minute();
        const add = lines.map((l) => ({ ...l, id: ++this.lineId, minute }));
        this.commentary.update((c) => [...add.toReversed(), ...c].slice(0, 30));
        const big = lines.find((l) => l.caption);
        if (big) {
            this.caption.set({ title: big.caption!, text: big.text, team: big.team });
            const id = this.lineId;
            setTimeout(() => {
                if (this.lineId === id || this.caption()?.text === big.text) this.caption.set(null);
            }, 3200);
        }
    }

    // ---------------------------------------------------------------- presentation

    private setAnim(id: string, name: string, ms: number) {
        this.anim.set(id, { name, until: performance.now() + ms });
        setTimeout(this.bump, ms + 20); // let the view fall back to the resting pose
    }

    popup(at: Cell, text: string, tone: Popup['tone'] = 'neutral') {
        const id = ++this.popupId;
        this.popups.update((l) => [...l, { id, at, text, tone }]);
        setTimeout(() => this.popups.update((l) => l.filter((x) => x.id !== id)), 1400);
    }

    private burst(at: Cell, kind: Burst['kind'], colors: string[]) {
        const id = ++this.popupId;
        this.bursts.update((l) => [...l, { id, at, kind, colors }]);
        setTimeout(() => this.bursts.update((l) => l.filter((x) => x.id !== id)), kind === 'confetti' ? 1800 : 700);
    }

    private jolt() {
        if (!prefs().reduceMotion) this.shake.update((n) => n + 1);
    }

    private clubName = (team: TeamSide) => this.match.state.clubs[team].name;

    private async showBanner(text: string, sub: string | undefined, ms: number) {
        this.banner.set({ text, sub });
        await sleep(ms);
        this.banner.set(null);
    }

    private async present(events: MatchEvent[]) {
        const m = this.match;
        const pause = this.cfg.match.resolvePauseMs;
        const stepMs = 95;
        for (const e of events) {
            if (this.stopped) return;
            switch (e.t) {
                case 'move': {
                    const steps = e.path.length - 1;
                    if (steps <= 0) break;
                    const ms = steps * stepMs;
                    this.moveMs.set(e.id, ms);
                    this.ballMs = e.dribble ? ms : 0;
                    this.setAnim(e.id, e.dribble ? 'dribble' : 'run', ms);
                    if (e.ability) audio.play('ability');
                    this.bump();
                    await sleep(ms);
                    this.moveMs.delete(e.id);
                    break;
                }
                case 'tackle': {
                    const d = m.piece(e.by);
                    this.setAnim(e.by, 'slide_tackle', 650);
                    if (e.success) {
                        this.setAnim(e.on, 'fall', 900);
                        audio.play('tackle');
                        this.burst(e.at, 'dust', ['#c9b48a', '#8f7b55']);
                        this.jolt();
                    } else audio.play('pass');
                    this.ballMs = 250;
                    this.popup(d.pos, e.success ? (e.reaction ? '탈취!' : '태클!') : '실패!', e.success ? 'bad' : 'good');
                    this.bump();
                    await sleep(650);
                    break;
                }
                case 'kick': {
                    const k = m.piece(e.by);
                    const isGk = k.player.cls === 'keeper';
                    this.setAnim(e.by, isGk ? (e.kind === 'shot' ? 'gk_punt' : 'gk_throw') : e.kind === 'shot' ? 'kick' : 'pass', 500);
                    this.flightZone.set({ target: e.target, radius: e.radius });
                    // wind-up: ball stays at the kicker's feet, camera settles on it
                    this.ballMs = 0;
                    this.ballAt = e.from;
                    this.followBall = true;
                    this.bump();
                    await sleep(260);
                    audio.play(e.kind === 'shot' ? 'kick' : 'pass');
                    // the flight ends where it is cut out, or where it lands
                    const rest = events.slice(events.indexOf(e) + 1);
                    const cut = rest.find((x): x is Extract<MatchEvent, { t: 'intercept' }> => x.t === 'intercept' && x.success);
                    const end = cut?.at ?? e.landing;
                    // ball flight duration scales with distance; long balls arc through the air
                    const d = dist(e.from, end);
                    this.ballMs = Math.min(1100, 160 + d * 34);
                    const lofted =
                        d > this.cfg.ball.loftThreshold ||
                        events.some((x) => x.t === 'ability' && (x.ability === 'cross' || x.ability === 'chip'));
                    this.ballArc.set({
                        ms: this.ballMs,
                        height: lofted ? Math.min(70, 18 + d * 2.4) : 0,
                        id: ++this.popupId,
                        spin: e.kind === 'shot' ? 2 : 1,
                    });
                    this.ballAt = end;
                    this.bump();
                    break;
                }
                case 'intercept': {
                    const o = m.piece(e.by);
                    this.popup(o.pos, e.success ? (e.block ? '막았다!' : '인터셉트!') : '늦었다', e.success ? 'bad' : 'good');
                    this.setAnim(e.by, e.success ? 'trap' : 'tired', 600);
                    if (e.success) {
                        audio.play('trap');
                        this.bump();
                        await sleep(this.ballMs);
                        if (!this.posOverride) this.ballAt = null;
                        this.ballMs = 200;
                    }
                    break;
                }
                case 'receive':
                case 'loose':
                case 'out':
                case 'pickup': {
                    this.bump();
                    await sleep(this.ballMs);
                    if (!this.posOverride) this.ballAt = null;
                    this.ballMs = 200;
                    if (e.t === 'receive') {
                        this.setAnim(e.by, 'trap', 500);
                        audio.play('trap');
                    }
                    if (e.t === 'out') {
                        this.popup(e.at, '아웃', 'neutral');
                        audio.play('whistle');
                    }
                    this.bump();
                    break;
                }
                case 'save': {
                    this.bump();
                    await sleep(this.ballMs);
                    if (!this.posOverride) this.ballAt = null;
                    this.ballMs = 200;
                    const k = m.piece(e.by);
                    this.setAnim(e.by, e.held ? 'gk_catch' : 'gk_punch', 700);
                    this.popup(k.pos, e.held ? '선방!' : '쳐냄!', 'bad');
                    audio.play('save');
                    this.jolt();
                    this.bump();
                    await sleep(500);
                    break;
                }
                case 'wide': {
                    this.bump();
                    await sleep(this.ballMs);
                    this.popup(m.ballCell(), '빗나감!', 'neutral');
                    audio.play('groan');
                    break;
                }
                case 'goal': {
                    this.bump();
                    await sleep(this.ballMs);
                    const side = e.team === 0 ? 'right' : 'left';
                    this.net.set(side);
                    setTimeout(() => this.net.set(null), 1400);
                    const kit = (t: TeamSide) => m.state.clubs[t].kit;
                    const goalCell: Cell = { x: e.team === 0 ? this.cfg.pitch.cols - 1 : 0, y: Math.floor(this.cfg.pitch.rows / 2) };
                    this.burst(goalCell, 'confetti', [kitColor(kit(e.team)), '#f2bf2f', '#ffffff']);
                    this.jolt();
                    audio.play(this.isHuman(e.team) || !this.isHuman((1 - e.team) as TeamSide) ? 'goal' : 'concede');
                    for (const p of m.state.pieces) this.setAnim(p.id, p.team === e.team ? 'celebrate' : 'sad', this.cfg.match.goalPauseMs);
                    this.flightZone.set(null);
                    this.bump();
                    const scorer = m.piece(e.scorer);
                    this.pendingRestart = e.team;
                    await this.showBanner(
                        '골!',
                        `${scorer.player.name} · ${m.state.score[0]} – ${m.state.score[1]}`,
                        this.cfg.match.goalPauseMs,
                    );
                    // left mid-celebration: the live simulation restarts play itself (see simTurn)
                    if (this.stopped) return;
                    this.pendingRestart = null;
                    this.ballAt = null;
                    this.followBall = false;
                    this.say(this.commentator.call(m.restartAfterGoal(e.team)));
                    for (const p of m.state.pieces) this.moveMs.set(p.id, 700);
                    this.ballMs = 700;
                    this.bump();
                    audio.play('whistle');
                    await sleep(750);
                    this.moveMs.clear();
                    break;
                }
                case 'ability': {
                    const by = m.piece(e.by);
                    const def = abilityDef(this.cfg, e.ability as AbilityId);
                    this.popup(by.pos, def.label, 'neutral');
                    audio.play('ability');
                    if (e.ability === 'command' || e.ability === 'tempo') this.setAnim(e.by, 'clap', 700);
                    if (e.ability === 'mark' && e.target) this.popup(m.piece(e.target).pos, '마크됨', 'bad');
                    if (e.ability === 'tempo' && e.target) this.popup(m.piece(e.target).pos, '다음 순서!', 'good');
                    this.bump();
                    await sleep(e.ability === 'trick' ? 250 : 450);
                    break;
                }
                case 'trick':
                    this.setAnim(e.by, 'juggle', 500);
                    if (e.success) this.setAnim(e.on, 'tired', 900);
                    this.popup(m.piece(e.on).pos, e.success ? '속았다!' : '안 속았다', e.success ? 'good' : 'bad');
                    this.bump();
                    await sleep(380);
                    break;
                case 'pressure':
                    this.popup(m.piece(e.on).pos, '압박당함', 'bad');
                    break;
                case 'foul':
                    if (e.advantage) {
                        this.popup(m.piece(e.on).pos, '어드밴티지!', 'good');
                        this.bump();
                        await sleep(500);
                        break;
                    }
                    this.setAnim(e.by, 'slide_tackle', 600);
                    this.setAnim(e.on, 'fall', 1100);
                    this.popup(m.piece(e.on).pos, e.penalty ? '페널티!' : '파울!', 'bad');
                    audio.play('whistle');
                    this.jolt();
                    this.bump();
                    await sleep(e.penalty ? 1100 : 700);
                    if (!e.penalty && m.piece(e.on).status.fouled) {
                        this.popup(m.piece(e.on).pos, '프리킥', 'good');
                        await sleep(500);
                    }
                    break;
                case 'setpiece': {
                    // let the save / block / foul land first, then announce why, then jog into shape
                    await sleep(this.ballMs + 650);
                    this.posOverride = null;
                    this.flightZone.set(null);
                    this.ballArc.set(null);
                    this.ballAt = null;
                    this.followBall = false;
                    audio.play('whistle');
                    for (const p of m.state.pieces) {
                        this.moveMs.set(p.id, 750);
                        this.setAnim(p.id, 'run', 750);
                    }
                    this.ballMs = 750;
                    this.bump();
                    const human = this.isHuman(0) || this.isHuman(1);
                    const n = this.cfg.setPieces.placements;
                    const why = setPieceReason(events, events.indexOf(e), m);
                    await this.showBanner(
                        e.kind === 'corner' ? '코너킥' : '프리킥',
                        `${why ? `${why} · ` : ''}${human ? `양 팀이 최대 ${n}명을 배치합니다(공격 먼저)` : this.clubName(e.team)}`,
                        1600,
                    );
                    this.moveMs.clear();
                    this.ballMs = 0;
                    break;
                }
                case 'sub': {
                    const on = m.piece(e.on);
                    this.popup(on.pos, `⇄ ${on.player.name}`, 'neutral');
                    audio.play('whistle');
                    this.bump();
                    await sleep(700);
                    break;
                }
                case 'place': {
                    this.moveMs.set(e.id, 380);
                    this.setAnim(e.id, 'run', 380);
                    audio.play('click');
                    this.bump();
                    await sleep(400);
                    this.moveMs.delete(e.id);
                    break;
                }
                case 'card': {
                    const c = m.piece(e.on);
                    this.popup(c.pos, e.card === 'red' ? '레드카드' : '옐로카드', e.card === 'red' ? 'red' : 'card');
                    audio.play('card');
                    this.bump();
                    if (e.card === 'red') await this.showBanner('퇴장', c.player.name, 1400);
                    else await sleep(600);
                    break;
                }
                case 'header':
                    this.setAnim(e.by, 'header', 600);
                    this.popup(e.at, '헤딩!', 'neutral');
                    this.bump();
                    await sleep(300);
                    break;
                case 'runOnto': {
                    const ms = Math.max(200, (e.path.length - 1) * 70);
                    this.moveMs.set(e.by, ms);
                    this.setAnim(e.by, 'run', ms);
                    this.ballMs = Math.max(this.ballMs, ms);
                    this.bump();
                    await sleep(ms);
                    this.moveMs.delete(e.by);
                    break;
                }
                case 'timeout':
                    this.popup(m.piece(e.id).pos, '너무 느립니다!', 'neutral');
                    this.bump();
                    break;
                default:
                    break;
            }
        }
        this.flightZone.set(null);
        this.ballArc.set(null);
        this.ballAt = null;
        this.posOverride = null;
        this.ballMs = 0;
        this.bump();
        if (events.length) await sleep(pause);
        // let the camera hand back to the next player only after the pause, so the outcome stays in shot
        if (this.followBall) {
            this.followBall = false;
            this.bump();
        }
    }

    // ---------------------------------------------------------------- helpers for the view

    /** Cells adjacent to opponents who still hold a reaction (tackle / intercept threat). */
    dangerFor = (team: TeamSide) => this.match.dangerCells(team);

    /** Is the active player's kick at `c` lofted (only interceptable near start/end)? */
    isLofted = (from: Cell, to: Cell) => dist(from, to) > this.cfg.ball.loftThreshold;
    adjacent = (a: Cell, b: Cell) => cheb(a, b) <= 1;
}

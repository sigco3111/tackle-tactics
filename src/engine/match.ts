/**
 * The turn engine. Holds no UI knowledge: every action mutates `MatchState` and
 * returns the `MatchEvent`s that happened so a presenter can animate them.
 *
 * A turn: [pre abilities] → move (normal or a move ability) → act (kick / tackle / act ability) → done.
 */
import type { GameConfig } from '../config';
import { createRng, type Rng } from '../rng';
import type { BallState, Cell, Club, MatchEvent, MatchState, Piece, Referee, RefStyle, SetPiece, SetPieceKind, TeamSide } from '../types';
import { abilityDef, hasAbility, hasPassive, type AbilityId } from './abilities';
import { attackGoalX, cheb, clampToPitch, dist, eq, facingFor, forward, goalRows, inPitch, key, line, neighbours8, ownGoalX } from './grid';
import { interceptChance, movePoints, saveChance, scatterRadius, tackleChance, trickChance, type KickMods } from './rules';

export type Reach = { cost: number; path: Cell[]; danger: number };
export type MoveAbility = 'sprint' | 'run' | 'press' | 'rush';
export type KickAbility = 'placed' | 'power' | 'chip' | 'through' | 'cross';

const MOVE_ABILITIES: MoveAbility[] = ['sprint', 'run', 'press', 'rush'];
export const MOVE_ABILITY_IDS: readonly MoveAbility[] = MOVE_ABILITIES;

const hashName = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
};
/** A referee's style is a property of the name: the same official always referees the same way. */
export const refereeStyle = (cfg: GameConfig, name: string): RefStyle => {
    const w = cfg.referee.weights;
    const total = w.lenient + w.fair + w.strict;
    const r = ((hashName(name) % 1000) / 1000) * total;
    return r < w.lenient ? 'lenient' : r < w.lenient + w.fair ? 'fair' : 'strict';
};
export const pickReferee = (cfg: GameConfig, seed: number): Referee => {
    const names = cfg.referee.names;
    const name = names[createRng(seed ^ 0x5bd1e995).int(0, names.length - 1)]!;
    return { name, style: refereeStyle(cfg, name) };
};
const SHOT_ABILITIES = new Set<KickAbility | undefined>(['placed', 'power', 'chip']);

export class Match {
    readonly cfg: GameConfig;
    readonly state: MatchState;
    private rng: Rng;
    private kickoffFirstHalf: TeamSide;
    /** Whose turn is running (stable even if the order array shifts after a red card). */
    private turnPieceId = '';

    constructor(cfg: GameConfig, clubs: [Club, Club], seed: number, kickoff: TeamSide = 0, referee?: Referee) {
        this.cfg = cfg;
        this.rng = createRng(seed);
        this.kickoffFirstHalf = kickoff;
        const pieces: Piece[] = [];
        clubs.forEach((club, team) =>
            club.squad.forEach((player, slot) =>
                pieces.push({
                    id: player.id,
                    player,
                    team: team as TeamSide,
                    slot,
                    pos: { x: 0, y: 0 },
                    facing: team === 0 ? 'right' : 'left',
                    reactionReady: true,
                    staggered: false,
                    cooldowns: {},
                    status: {},
                    yellows: 0,
                    stamina: 100,
                    morale: club.morale,
                }),
            ),
        );
        this.state = {
            clubs,
            pieces,
            ball: { kind: 'loose', at: { x: 0, y: 0 }, restrictedTo: null },
            score: [0, 0],
            round: 1,
            order: [],
            turnIndex: 0,
            phase: 'move',
            log: [],
            over: false,
            halftimeDone: false,
            seed,
            sentOff: [],
            knocks: {},
            referee: referee ?? pickReferee(cfg, seed),
            setPiece: null,
            subs: [0, 0],
            subbedOff: [],
        };
        this.kickoff(kickoff);
        this.buildOrder();
        this.beginTurn();
    }

    // ---------------------------------------------------------------- queries

    piece = (id: string) => {
        const p =
            this.state.pieces.find((q) => q.id === id) ??
            this.state.sentOff.find((q) => q.id === id) ??
            this.state.subbedOff.find((q) => q.id === id);
        if (!p) throw new Error(`no piece ${id}`);
        return p;
    };
    /** Everyone who took part: on the pitch, sent off, or substituted. */
    everyone = () => [...this.state.pieces, ...this.state.sentOff, ...this.state.subbedOff];
    active = () => this.piece(this.state.bonusTurn ?? this.state.order[Math.max(0, this.state.turnIndex)]!);
    pieceAt = (c: Cell) => this.state.pieces.find((p) => eq(p.pos, c));
    carrier = () => (this.state.ball.kind === 'held' ? this.piece(this.state.ball.by) : undefined);
    ballCell = (): Cell => (this.state.ball.kind === 'held' ? this.piece(this.state.ball.by).pos : this.state.ball.at);
    keeperOf = (team: TeamSide) => this.state.pieces.find((p) => p.team === team && p.player.cls === 'keeper');
    opponents = (team: TeamSide) => this.state.pieces.filter((p) => p.team !== team);
    mates = (p: Piece) => this.state.pieces.filter((q) => q.team === p.team && q.id !== p.id);
    canReact = (p: Piece) => p.reactionReady && !p.staggered;
    hasActed = (p: Piece) => this.state.order.indexOf(p.id) < this.state.turnIndex;

    /** Is `c` inside the penalty box `team` defends? */
    inOwnBox = (team: TeamSide, c: Cell) => {
        const { cols, rows, boxDepth, boxWidth } = this.cfg.pitch;
        const depthOk = team === 0 ? c.x < boxDepth : c.x >= cols - boxDepth;
        return depthOk && Math.abs(c.y - (rows - 1) / 2) <= boxWidth / 2;
    };

    /** Cells where an opponent of `team` could react (tackle / intercept). */
    dangerCells = (team: TeamSide): Set<string> => {
        const out = new Set<string>();
        for (const o of this.opponents(team)) {
            if (!this.canReact(o)) continue;
            for (const n of neighbours8(o.pos)) if (inPitch(this.cfg, n)) out.add(key(n));
            out.add(key(o.pos));
        }
        return out;
    };

    // ---------------------------------------------------------------- abilities: availability

    private startCooldown(p: Piece, id: AbilityId) {
        p.cooldowns[id] = this.state.round + abilityDef(this.cfg, id).cooldown;
    }

    /** Is a cell wide & advanced enough for a cross? */
    crossZone = (p: Piece) => {
        const c = this.cfg.abilities.cross;
        const mid = (this.cfg.pitch.rows - 1) / 2;
        return forward(this.cfg, p.team, p.pos) >= c.minForward && Math.abs(p.pos.y - mid) >= c.wideRows;
    };

    /**
     * Why `p` can't use ability `id` right now, in plain words — or null if it can.
     * The UI shows this instead of a silently disabled button.
     */
    blockReason = (p: Piece, id: AbilityId): string | null => {
        const cfg = this.cfg;
        const def = abilityDef(cfg, id);
        if (!hasAbility(cfg, p.player, id)) return `잠김: ${cfg.classes[def.cls].short} 레벨 ${def.unlock} 필요`;
        const left = (p.cooldowns[id] ?? 0) - this.state.round;
        if (left > 0) return `재충전 중: ${left}라운드`;
        const phase = this.state.phase;
        const holds = this.carrier()?.id === p.id;
        if ((def.phase === 'move' || def.phase === 'pre') && phase !== 'move') return '이동 전에만 가능';
        if (def.phase === 'act' && phase !== 'act') return '이동 후에만 가능';
        switch (id) {
            case 'sprint':
                return p.status.fouled ? '파울을 당해 이번 턴에는 이동할 수 없습니다' : null;
            case 'run':
            case 'press':
            case 'rush':
                return holds ? '공이 없을 때만 가능' : null;
            case 'trick':
                if (!holds) return '공이 필요합니다';
                if (p.status.tricked) return '이번 턴에 이미 사용했습니다';
                return this.opponents(p.team).some((o) => this.canReact(o) && cheb(o.pos, p.pos) === 1)
                    ? null
                    : '반응 행동이 남은 인접 수비수가 없습니다';
            case 'placed':
            case 'power':
            case 'chip':
                if (!holds) return '공이 필요합니다';
                return this.shotBlocked(p) ? '추가 턴: 슛 불가' : null;
            case 'through':
                return holds ? null : '공이 필요합니다';
            case 'cross':
                if (!holds) return '공이 필요합니다';
                return this.crossZone(p) ? null : '먼저 공격 지역 측면으로 나가세요';
            case 'tempo':
                return this.tempoTargets(p).length ? null : '이번 라운드에 행동할 동료가 남아 있지 않습니다';
            case 'slide': {
                const c = this.carrier();
                if (!c || c.team === p.team) return "Opponents don't have the ball";
                if (c.status.fouled) return '공 소유자가 프리킥을 얻었습니다';
                return cheb(c.pos, p.pos) <= cfg.abilities.slide.reach ? null : `공 소유자가 ${cfg.abilities.slide.reach}칸 이내에 있어야 합니다`;
            }
            case 'foul':
                return this.canTackle(p) ? null : '상대 공 소유자 바로 옆이어야 합니다';
            case 'mark':
                return this.markTargets(p).length ? null : `${cfg.abilities.mark.range}칸 이내에 상대가 없습니다`;
            case 'command':
                return this.mates(p).some((q) => cheb(q.pos, p.pos) <= cfg.abilities.command.radius) ? null : '범위 안에 동료가 없습니다';
        }
        return null;
    };

    /** Owned, off cooldown and usable right now (phase + situation). */
    abilityUsable = (p: Piece, id: AbilityId): boolean => this.blockReason(p, id) === null;

    usableAbilities = (p: Piece) => (Object.keys(this.cfg.abilities) as AbilityId[]).filter((id) => this.abilityUsable(p, id));

    tempoTargets = (p: Piece) => this.mates(p).filter((q) => this.state.order.indexOf(q.id) > this.state.turnIndex + 1);
    markTargets = (p: Piece) =>
        this.opponents(p.team).filter((o) => o.player.cls !== 'keeper' && cheb(o.pos, p.pos) <= this.cfg.abilities.mark.range);

    // ---------------------------------------------------------------- movement

    private moveMode(ability?: MoveAbility) {
        const a = this.cfg.abilities;
        switch (ability) {
            case 'sprint':
                return { bonus: a.sprint.bonusMove, ignoreZoc: false, straight: true };
            case 'run':
                return { bonus: a.run.bonusMove, ignoreZoc: true, straight: false };
            case 'press':
                return { bonus: a.press.bonusMove, ignoreZoc: true, straight: false };
            case 'rush':
                return { bonus: a.rush.bonusMove, ignoreZoc: true, straight: false };
            default:
                return { bonus: 0, ignoreZoc: false, straight: false };
        }
    }

    /**
     * Dijkstra over the grid. Off-ball runs stop when entering an opponent's adjacent
     * cell (marking; a man-marker reaches 2 cells). The carrier may dribble through but
     * each danger cell is a tackle roll; ties are broken towards fewer danger cells.
     */
    reachable = (p: Piece, ability?: MoveAbility): Map<string, Reach> => {
        const cfg = this.cfg;
        const mode = this.moveMode(ability);
        const hasBall = this.carrier()?.id === p.id;
        const budget = movePoints(cfg, p, mode.bonus);
        const stepMult = hasBall ? cfg.movement.dribbleCostMult : 1;
        const occupied = new Set(this.state.pieces.filter((q) => q.id !== p.id).map((q) => key(q.pos)));
        const zoc = new Set<string>();
        if (!mode.ignoreZoc) {
            for (const o of this.opponents(p.team)) {
                const r = o.status.markOn === p.id ? 2 : 1;
                for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) zoc.add(key({ x: o.pos.x + dx, y: o.pos.y + dy }));
            }
        }
        const danger = this.dangerCells(p.team);
        const loose = this.state.ball.kind === 'loose' ? this.state.ball : undefined;
        const looseKey = loose && (loose.restrictedTo === null || loose.restrictedTo === p.team) ? key(loose.at) : undefined;
        const o = p.pos;

        const best = new Map<string, Reach>();
        best.set(key(o), { cost: 0, path: [o], danger: 0 });
        if (budget <= 0) return best;
        const queue: Array<{ c: Cell; r: Reach }> = [{ c: o, r: best.get(key(o))! }];
        while (queue.length) {
            queue.sort((a, b) => a.r.cost - b.r.cost || a.r.danger - b.r.danger);
            const { c, r } = queue.shift()!;
            const k = key(c);
            if (best.get(k) !== r) continue;
            const isStart = r.path.length === 1;
            if (!isStart && k === looseKey) continue;
            if (!isStart && !hasBall && cfg.movement.zocStopsOffBall && zoc.has(k)) continue;
            for (const n of neighbours8(c)) {
                if (!inPitch(cfg, n)) continue;
                if (mode.straight) {
                    const dx = n.x - o.x;
                    const dy = n.y - o.y;
                    if (!(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy))) continue;
                    if (cheb(n, o) !== cheb(c, o) + 1) continue;
                    if (!isStart && (Math.sign(n.x - c.x) !== Math.sign(c.x - o.x) || Math.sign(n.y - c.y) !== Math.sign(c.y - o.y)))
                        continue;
                }
                const nk = key(n);
                if (occupied.has(nk)) continue;
                const diag = n.x !== c.x && n.y !== c.y;
                // a sprint is a straight burst: diagonal steps cost the same as straight ones
                const cost = r.cost + (diag && !mode.straight ? 1.5 : 1) * stepMult;
                if (cost > budget + 1e-9) continue;
                const nd = r.danger + (hasBall && danger.has(nk) ? 1 : 0);
                const prev = best.get(nk);
                if (prev && (prev.cost < cost - 1e-9 || (Math.abs(prev.cost - cost) < 1e-9 && prev.danger <= nd))) continue;
                const nr = { cost, path: [...r.path, n], danger: nd };
                best.set(nk, nr);
                queue.push({ c: n, r: nr });
            }
        }
        return best;
    };

    // ---------------------------------------------------------------- kicks: queries

    /** Is `target` a legal kick target for `p` with this kick? Returns 'pass' | 'shot' | null. */
    kickKind = (p: Piece, target: Cell, ability?: KickAbility): 'pass' | 'shot' | null => {
        const cfg = this.cfg;
        const gx = attackGoalX(cfg, p.team);
        const [top, bottom] = goalRows(cfg);
        const isGoal = target.x === gx && target.y >= top && target.y <= bottom;
        if (isGoal && this.shotBlocked(p)) return null;
        if (ability && SHOT_ABILITIES.has(ability)) return isGoal && dist(p.pos, target) <= cfg.ball.maxShotRange ? 'shot' : null;
        if (isGoal) {
            if (ability) return null;
            return dist(p.pos, target) <= cfg.ball.maxShotRange ? 'shot' : null;
        }
        if (!inPitch(cfg, target) || eq(target, p.pos)) return null;
        if (ability === 'cross' && !this.inOwnBox((1 - p.team) as TeamSide, target)) return null;
        return 'pass';
    };

    kickMods = (ability?: KickAbility): KickMods => {
        const a = this.cfg.abilities;
        if (ability === 'placed') return { scatterMult: a.placed.scatterMult };
        if (ability === 'power') return { scatterMult: a.power.scatterMult };
        if (ability === 'chip') return { scatterMult: a.chip.scatterMult };
        return {};
    };

    kickRadius = (p: Piece, target: Cell, ability?: KickAbility) => {
        const kind = this.kickKind(p, target, ability);
        if (!kind) return 0;
        return scatterRadius(this.cfg, p, dist(p.pos, target), kind, this.kickMods(ability));
    };

    /**
     * The odds of a shot at `target` as `kick` will roll them: blocked on the way (each defender
     * beside the line gets one try), then the landing row (a uniform point in the scatter disc,
     * so its vertical offset has a semicircle distribution), then the keeper's save from that row.
     * `goal` is the chance it goes in; the parts explain it in the UI.
     */
    shotOdds = (p: Piece, target: Cell, ability?: KickAbility) => {
        const cfg = this.cfg;
        const none = { goal: 0, block: 0, onTarget: 0, save: 0 };
        if (this.kickKind(p, target, ability) !== 'shot') return none;
        const d = dist(p.pos, target);
        const R = this.kickRadius(p, target, ability);
        // P(offset < t) for a uniform point in a disc of radius R, projected on one axis
        const cdf = (t: number) => {
            if (R <= 0) return t >= 0 ? 1 : 0;
            const x = Math.max(-R, Math.min(R, t));
            return 0.5 + (x * Math.sqrt(R * R - x * x) + R * R * Math.asin(x / R)) / (Math.PI * R * R);
        };
        const [top, bottom] = goalRows(cfg);
        const keeper = this.keeperOf((1 - p.team) as TeamSide);
        const saveMod = this.shotSaveMod(p, ability);
        const lineX = target.x < 0 ? 0 : cfg.pitch.cols - 1;
        let onTarget = 0;
        let scores = 0;
        for (let y = top; y <= bottom; y++) {
            // the landing row is round(target.y + offset)
            const pr = cdf(y + 0.5 - target.y) - cdf(y - 0.5 - target.y);
            const save = keeper ? saveChance(cfg, keeper, p, cheb(keeper.pos, { x: lineX, y }), d, saveMod) : 0;
            onTarget += pr;
            scores += pr * (1 - save);
        }
        // blocks: the same lane and candidates as `kick` (aimed line; the keeper doesn't block)
        const lineEnd = { x: lineX, y: Math.max(0, Math.min(cfg.pitch.rows - 1, target.y)) };
        const path = line(p.pos, lineEnd).slice(1);
        const n = cfg.ball.loftInterceptCells;
        const tried = new Set<string>();
        let through = 1;
        for (let i = 0; i < path.length; i++) {
            if (ability === 'chip' && i >= n) continue;
            if (p.status.fouled && i < 2) continue;
            const c = path[i]!;
            for (const o of this.opponents(p.team)) {
                if (o.id === keeper?.id || tried.has(o.id) || !this.canReact(o) || cheb(o.pos, c) > 1) continue;
                tried.add(o.id);
                through *= 1 - interceptChance(cfg, o, p, eq(o.pos, c), 'shot');
            }
        }
        return { goal: through * scores, block: 1 - through, onTarget, save: onTarget > 0 ? 1 - scores / onTarget : 0 };
    };

    canTackle = (p: Piece) => {
        const c = this.carrier();
        return !!c && c.team !== p.team && !c.status.fouled && cheb(c.pos, p.pos) === 1;
    };

    // ---------------------------------------------------------------- turn flow

    /** The extra turn after winning a tackle is for getting clear, not for shooting (match.tackleBonusMode). */
    shotBlocked = (p: Piece) => this.state.bonusTurn === p.id && this.cfg.match.tackleBonusMode !== 'full';

    /** The winner of a tackle gets an extra turn straight after this one (config: match.tackleBonusTurn). */
    private wonTackle(winner: Piece, reason: 'won' | 'beat' = 'won') {
        if (!this.cfg.match.tackleBonusTurn) return;
        this.state.bonusNext = winner.id;
        this.state.bonusReason = reason;
    }

    private knock(id: string) {
        this.state.knocks[id] = (this.state.knocks[id] ?? 0) + 1;
    }

    private log(text: string, team: TeamSide | null = null) {
        this.state.log.push({ round: this.state.round, text, team });
        if (this.state.log.length > 200) this.state.log.shift();
    }

    private buildOrder() {
        const byTeam = ([0, 1] as TeamSide[]).map((t) =>
            this.state.pieces
                .filter((p) => p.team === t)
                .map((p) => ({ p, s: p.player.stats.speed + p.player.stats.composure * 0.01 + this.rng() * 0.001 }))
                .sort((a, b) => b.s - a.s),
        ) as [Array<{ p: Piece; s: number }>, Array<{ p: Piece; s: number }>];
        let t: TeamSide = (byTeam[0][0]?.s ?? 0) >= (byTeam[1][0]?.s ?? 0) ? 0 : 1;
        const order: string[] = [];
        const idx = [0, 0];
        while (order.length < this.state.pieces.length) {
            const list = byTeam[t];
            if (idx[t]! < list.length) order.push(list[idx[t]!++]!.p.id);
            t = (1 - t) as TeamSide;
        }
        this.state.order = order;
        this.state.turnIndex = 0;
    }

    private beginTurn() {
        const p = this.active();
        this.turnPieceId = p.id;
        p.reactionReady = true; // DnD-style refresh at the start of your own turn
        p.staggered = false;
        const s = p.status;
        delete s.markOn;
        delete s.commanded;
        if (s.groundedNext) {
            s.grounded = true;
            delete s.groundedNext;
        }
        this.state.phase = 'move';
        const sp = this.state.setPiece;
        if (sp?.stage === 'take' && sp.taker === p.id) {
            // dead ball: no moving, the kick is free (the wall stands back, nobody may tackle)
            sp.armed = true;
            s.fouled = true;
            this.state.phase = 'act';
        }
    }

    private endTurnCleanup() {
        const p = this.state.pieces.find((q) => q.id === this.turnPieceId);
        if (!p) return;
        const s = p.status;
        if (this.state.setPiece?.armed && this.state.setPiece.taker === p.id) this.state.setPiece = null;
        delete s.pressured;
        delete s.fouled;
        delete s.grounded;
        delete s.rushing;
        delete s.tricked;
    }

    private afterMove(p: Piece) {
        if (this.state.phase === 'done') return;
        if (this.state.bonusTurn === p.id && this.cfg.match.tackleBonusMode === 'move') {
            this.state.phase = 'done';
            return;
        }
        this.state.phase = 'act';
        const holds = this.carrier()?.id === p.id;
        if (holds || this.canTackle(p)) return;
        if (!this.usableAbilities(p).length) this.state.phase = 'done';
    }

    /** Advance the baton. Returns round/half/full-time events. */
    nextTurn = (): MatchEvent[] => {
        const s = this.state;
        if (s.over) return [];
        const events: MatchEvent[] = [];
        // a headless caller skipping the setup simply takes the default arrangement
        if (s.setPiece?.stage === 'setup') s.setPiece.stage = 'take';
        this.endTurnCleanup();
        // a tackle winner takes their extra turn now, before the order moves on
        // (a bonus turn sits between two order slots: once it ends, the order simply moves on)
        const owed = s.bonusNext;
        delete s.bonusNext;
        delete s.bonusTurn;
        if (owed && !s.setPiece && s.pieces.some((p) => p.id === owed) && this.carrier()?.id === owed) {
            s.bonusTurn = owed;
            this.beginTurn();
            return [{ t: 'bonus', id: owed, reason: s.bonusReason ?? 'won' }];
        }
        s.turnIndex++;
        if (s.turnIndex >= s.order.length) {
            const half = Math.floor(this.cfg.match.rounds / 2);
            if (s.round >= this.cfg.match.rounds) {
                s.over = true;
                this.log(`Full time: ${s.score[0]} – ${s.score[1]}`);
                events.push({ t: 'fulltime' });
                return events;
            }
            if (s.round === half && !s.halftimeDone) {
                s.halftimeDone = true;
                this.log('Half time.');
                events.push({ t: 'halftime' });
                const team = (1 - this.kickoffFirstHalf) as TeamSide;
                this.kickoff(team);
                events.push({ t: 'kickoff', team });
            }
            s.round++;
            for (const p of s.pieces) this.tire(p, this.cfg.fatigue.perRound);
            this.buildOrder();
        }
        // the set-piece taker steps up next, out of turn
        const sp = s.setPiece;
        if (sp?.stage === 'take' && !sp.armed) {
            const idx = s.order.indexOf(sp.taker);
            if (idx < 0) s.setPiece = null;
            else if (idx !== s.turnIndex) {
                s.order.splice(idx, 1);
                if (idx < s.turnIndex) s.turnIndex--;
                s.order.splice(s.turnIndex, 0, sp.taker);
            }
        }
        events.push(...this.keeperClaims());
        this.beginTurn();
        return events;
    };

    /**
     * Safe hands: between turns, a keeper within range of a loose ball he may take walks onto it
     * and holds it. It costs his reaction, unless it is his turn that starts now (it refreshes anyway).
     */
    keeperClaims = (): MatchEvent[] => {
        const s = this.state;
        const ball = s.ball;
        if (ball.kind !== 'loose' || s.setPiece || s.over) return [];
        const next = s.bonusTurn ?? s.order[s.turnIndex];
        const range = (this.cfg.passives.safeHands as { range: number }).range;
        const keeper = s.pieces
            .filter(
                (k) =>
                    hasPassive(this.cfg, k.player, 'safeHands') &&
                    (ball.restrictedTo === null || ball.restrictedTo === k.team) &&
                    cheb(k.pos, ball.at) <= range &&
                    (k.reactionReady || k.id === next) &&
                    !k.staggered &&
                    !k.status.grounded,
            )
            .sort((a, b) => cheb(a.pos, ball.at) - cheb(b.pos, ball.at))[0];
        const occupant = keeper && this.pieceAt(ball.at);
        if (!keeper || (occupant && occupant !== keeper)) return [];
        const from = { ...keeper.pos };
        const path: Cell[] = [from];
        while (!eq(path.at(-1)!, ball.at)) {
            const c = path.at(-1)!;
            path.push({ x: c.x + Math.sign(ball.at.x - c.x), y: c.y + Math.sign(ball.at.y - c.y) });
        }
        keeper.pos = { ...ball.at };
        keeper.facing = facingFor(from, ball.at, keeper.facing);
        if (keeper.id !== next) keeper.reactionReady = false;
        s.ball = { kind: 'held', by: keeper.id };
        this.log(`${keeper.player.name} comes off the line and claims it.`, keeper.team);
        return [
            { t: 'move', id: keeper.id, path, dribble: false },
            { t: 'pickup', by: keeper.id, at: { ...ball.at } },
        ];
    };

    // ---------------------------------------------------------------- basic actions

    hold = (): MatchEvent[] => {
        const p = this.active();
        if (this.state.phase !== 'move') return [];
        this.afterMove(p);
        return [];
    };

    endTurn = (): MatchEvent[] => {
        this.state.phase = 'done';
        return [];
    };

    timeout = (): MatchEvent[] => {
        const p = this.active();
        this.log(`${p.player.name} hesitated — action lost.`, p.team);
        this.state.phase = 'done';
        return [{ t: 'timeout', id: p.id }];
    };

    move = (to: Cell, ability?: MoveAbility): MatchEvent[] => {
        const p = this.active();
        if (this.state.phase !== 'move') return [];
        if (ability && (!MOVE_ABILITIES.includes(ability) || !this.abilityUsable(p, ability))) return [];
        const reach = this.reachable(p, ability).get(key(to));
        if (!reach || reach.path.length < 2) return [];
        if (ability) {
            this.startCooldown(p, ability);
            if (ability === 'rush') p.status.rushing = true;
            this.tire(p, this.cfg.fatigue.burst);
        }
        this.tire(p, (reach.path.length - 1) * this.cfg.fatigue.perCell);
        const hasBall = this.carrier()?.id === p.id;
        const tried = new Set<string>();
        const travelled: Cell[] = [p.pos];
        const after: MatchEvent[] = [];
        const done = () => [{ t: 'move', id: p.id, path: travelled, dribble: hasBall, ability } as MatchEvent, ...after];

        for (const c of reach.path.slice(1)) {
            p.facing = facingFor(p.pos, c, p.facing);
            p.pos = c;
            travelled.push(c);
            if (hasBall) {
                const defenders = this.opponents(p.team)
                    .filter((o) => this.canReact(o) && !tried.has(o.id) && cheb(o.pos, c) <= 1)
                    .sort((a, b) => b.player.stats.tackling - a.player.stats.tackling);
                for (const d of defenders) {
                    tried.add(d.id);
                    d.reactionReady = false;
                    const success = this.rng.chance(tackleChance(this.cfg, d, p, false));
                    d.facing = facingFor(d.pos, c, d.facing);
                    after.push({ t: 'tackle', by: d.id, on: p.id, success, reaction: true, at: c });
                    if (success) {
                        this.state.ball = { kind: 'held', by: d.id };
                        this.knock(p.id);
                        this.wonTackle(d);
                        this.log(`${d.player.name} steps in and wins it off ${p.player.name}!`, d.team);
                    } else {
                        d.staggered = true;
                        this.log(`${p.player.name} skips past ${d.player.name}'s challenge.`, p.team);
                    }
                    const call = this.refereeCall(d, p, success, false);
                    if (call) {
                        after.push(...call);
                        const played = call.some((e) => e.t === 'foul' && e.advantage);
                        if (!played) {
                            // whistle: the run stops here; a plain free kick is taken right away
                            if (
                                this.state.setPiece ||
                                this.carrier()?.id !== p.id ||
                                call.some((e) => e.t === 'goal' || e.t === 'save' || e.t === 'wide')
                            )
                                this.state.phase = 'done';
                            else this.state.phase = 'act'; // fouled: the free kick is taken now
                            return done();
                        }
                    } else if (success) {
                        this.state.phase = 'done';
                        return done();
                    }
                }
            }
            const ball = this.state.ball;
            if (ball.kind === 'loose' && eq(ball.at, c)) {
                this.state.ball = { kind: 'held', by: p.id };
                after.push({ t: 'pickup', by: p.id, at: c });
                this.log(`${p.player.name} collects the loose ball.`, p.team);
                break;
            }
        }
        if (ability === 'press') {
            const c = this.carrier();
            if (c && c.team !== p.team && cheb(c.pos, p.pos) === 1) {
                c.status.pressured = true;
                after.push({ t: 'pressure', by: p.id, on: c.id });
                this.log(`${p.player.name} closes ${c.player.name} down.`, p.team);
            }
        }
        if (ability === 'sprint') this.log(`${p.player.name} bursts down the line.`, p.team);
        if (ability === 'run') this.log(`${p.player.name} darts in behind.`, p.team);
        this.afterMove(p);
        return done();
    };

    /** Pre-move ability: Trick. Phase stays 'move'. */
    trick = (): MatchEvent[] => {
        const p = this.active();
        if (!this.abilityUsable(p, 'trick')) return [];
        this.startCooldown(p, 'trick');
        p.status.tricked = true;
        const events: MatchEvent[] = [{ t: 'ability', by: p.id, ability: 'trick' }];
        for (const o of this.opponents(p.team).filter((q) => this.canReact(q) && cheb(q.pos, p.pos) === 1)) {
            const success = this.rng.chance(trickChance(this.cfg, p, o));
            if (success) {
                o.reactionReady = false;
                o.staggered = true;
            }
            events.push({ t: 'trick', by: p.id, on: o.id, success });
            this.log(
                success ? `${p.player.name} sells ${o.player.name} a dummy.` : `${o.player.name} doesn't bite.`,
                success ? p.team : o.team,
            );
        }
        return events;
    };

    tackle = (): MatchEvent[] => {
        const p = this.active();
        const c = this.carrier();
        if (this.state.phase !== 'act' || !c || !this.canTackle(p)) return [];
        return this.resolveTackle(p, c, 0, false);
    };

    slide = (): MatchEvent[] => {
        const p = this.active();
        const c = this.carrier();
        if (!c || !this.abilityUsable(p, 'slide')) return [];
        this.startCooldown(p, 'slide');
        return [
            { t: 'ability', by: p.id, ability: 'slide', target: c.id },
            ...this.resolveTackle(p, c, this.cfg.abilities.slide.bonus, true),
        ];
    };

    private resolveTackle(p: Piece, c: Piece, bonus: number, slide: boolean): MatchEvent[] {
        this.tire(p, this.cfg.fatigue.tackle * (slide ? 2 : 1));
        const success = this.rng.chance(tackleChance(this.cfg, p, c, true, bonus));
        p.facing = facingFor(p.pos, c.pos, p.facing);
        this.state.phase = 'done';
        if (success) {
            this.state.ball = { kind: 'held', by: p.id };
            this.knock(c.id);
            this.wonTackle(p);
            if (slide && cheb(p.pos, c.pos) > 1) {
                // slide carries you towards the ball
                const step = line(p.pos, c.pos)[1];
                if (step && !this.pieceAt(step)) p.pos = step;
            }
            this.log(slide ? `${p.player.name} slides in and takes it!` : `${p.player.name} tackles ${c.player.name} cleanly.`, p.team);
        } else {
            p.staggered = true;
            p.reactionReady = false;
            if (slide) p.status.groundedNext = true;
            // a duel: the carrier who beats a deliberate challenge gets the extra turn to escape
            if (this.cfg.match.missedTackleBonus) this.wonTackle(c, 'beat');
            this.log(slide ? `${p.player.name} slides in and ends up on the floor.` : `${p.player.name} lunges in and misses.`, p.team);
        }
        const ev: MatchEvent[] = [{ t: 'tackle', by: p.id, on: c.id, success, reaction: false, at: c.pos }];
        return [...ev, ...(this.refereeCall(p, c, success, slide) ?? [])];
    }

    // ---------------------------------------------------------------- fatigue & substitutions

    /** Drain stamina; older legs tire faster, and a shorter match drains proportionally faster. */
    private tire(p: Piece, amount: number) {
        const f = this.cfg.fatigue;
        const age = 1 + Math.max(0, p.player.age - f.ageFrom) * f.agePerYear;
        const len = f.refRounds / Math.max(6, this.cfg.match.rounds);
        p.stamina = Math.max(0, (p.stamina ?? 100) - amount * age * len);
    }

    subsLeft = (team: TeamSide) => this.cfg.subs.max - this.state.subs[team];
    bench = (team: TeamSide) => this.state.clubs[team].bench ?? [];

    /**
     * Why `offId` can't make way for `onId`, or null. With `timing` off only the lasting reasons
     * count (a change can wait for the ball to move on or the set piece to finish).
     */
    subBlock = (team: TeamSide, offId: string, onId: string, timing = true): string | null => {
        const off = this.state.pieces.find((q) => q.id === offId);
        const on = this.bench(team).find((p) => p.id === onId);
        if (this.state.over) return '경기가 끝났습니다';
        if (this.subsLeft(team) <= 0) return '남은 교체가 없습니다';
        if (!off || off.team !== team) return '그라운드 위의 우리 선수를 고르세요';
        if (!on) return '벤치에서 선수를 고르세요';
        if ((off.player.cls === 'keeper') !== (on.cls === 'keeper'))
            return off.player.cls === 'keeper' ? '골키퍼는 골키퍼로만 교체할 수 있습니다' : '골키퍼 교체 선수는 골키퍼만 가능합니다';
        if (!timing) return null;
        if (off.id === this.turnPieceId && this.state.phase !== 'done') return '지금 차례인 선수는 교체할 수 없습니다';
        if (this.carrier()?.id === off.id) return '공을 가진 선수는 교체할 수 없습니다';
        if (this.state.setPiece) return '세트피스 중에는 교체할 수 없습니다';
        return null;
    };

    /** Swap a tired player for a fresh one from the bench, on the same cell and turn slot. */
    substitute = (team: TeamSide, offId: string, onId: string): MatchEvent[] => {
        if (this.subBlock(team, offId, onId)) return [];
        const s = this.state;
        const off = s.pieces.find((q) => q.id === offId)!;
        const club = s.clubs[team];
        const player = club.bench!.find((p) => p.id === onId)!;
        club.bench = club.bench!.filter((p) => p.id !== onId);
        const on: Piece = {
            id: player.id,
            player,
            team,
            slot: off.slot,
            pos: { ...off.pos },
            facing: off.facing,
            reactionReady: true,
            staggered: false,
            cooldowns: {},
            status: {},
            yellows: 0,
            stamina: 100,
            morale: off.morale,
        };
        s.pieces[s.pieces.indexOf(off)] = on;
        const oi = s.order.indexOf(off.id);
        if (oi >= 0) s.order[oi] = on.id;
        s.subbedOff.push(off);
        s.subs[team]++;
        this.log(`Substitution for ${club.name}: ${player.name} replaces ${off.player.name}.`, team);
        return [{ t: 'sub', team, off: off.id, on: on.id }];
    };

    // ---------------------------------------------------------------- the referee

    refStyle = () => this.cfg.referee.styles[this.state.referee.style];

    /** Did the referee see a foul in that challenge? Null if play goes on. */
    private refereeCall(tackler: Piece, victim: Piece, won: boolean, slide: boolean): MatchEvent[] | null {
        const st = this.refStyle();
        const chance = (won ? st.foulOnWin : st.foulOnMiss) * (slide ? st.slideMult : 1);
        if (!this.rng.chance(chance)) return null;
        return this.whistle(tackler, victim, { slide, cynical: false });
    }

    /**
     * A foul by `fouler` on `victim`: cards, then advantage, a penalty, a set-piece free kick in
     * the final third, or a plain free kick (the victim keeps the ball and can't be tackled).
     */
    private whistle(fouler: Piece, victim: Piece, o: { slide: boolean; cynical: boolean }): MatchEvent[] {
        const cfg = this.cfg;
        const st = this.refStyle();
        const penalty = this.inOwnBox(fouler.team, victim.pos);
        // advantage: the victim kept the ball going forward, so let it run (never in the box)
        const advantage =
            !penalty &&
            !o.cynical &&
            this.carrier()?.id === victim.id &&
            forward(cfg, victim.team, victim.pos) >= 0.5 &&
            this.rng.chance(st.advantage);
        this.knock(victim.id);
        if (!advantage) delete this.state.bonusNext; // the ball goes back: no reward for a foul
        const events: MatchEvent[] = [{ t: 'foul', by: fouler.id, on: victim.id, penalty, advantage, tackle: !o.cynical }];
        if (o.cynical)
            this.log(
                penalty
                    ? `${fouler.player.name} brings ${victim.player.name} down in the box — penalty!`
                    : `${fouler.player.name} cynically stops ${victim.player.name}.`,
                fouler.team,
            );
        else if (advantage) this.log(`${this.state.referee.name} plays advantage after ${fouler.player.name}'s foul.`, victim.team);
        else
            this.log(
                penalty
                    ? `${fouler.player.name} clips ${victim.player.name} in the box — penalty!`
                    : `Foul by ${fouler.player.name}. ${this.state.referee.name} blows.`,
                fouler.team,
            );
        const fair = cfg.referee.styles.fair.card;
        const cardChance = o.cynical
            ? cfg.abilities.foul.yellowChance * (st.card / fair)
            : st.card * (o.slide ? 1.4 : 1) * (penalty ? 1.3 : 1);
        if (o.slide && !o.cynical && this.rng.chance(st.red)) {
            this.log(`Straight red! ${fouler.player.name} went in two-footed.`, fouler.team);
            this.sendOff(fouler);
            events.push({ t: 'card', on: fouler.id, card: 'red' });
        } else if (this.rng.chance(cardChance)) events.push(...this.book(fouler));
        if (advantage || !this.state.pieces.includes(victim)) return events;
        this.state.ball = { kind: 'held', by: victim.id };
        this.state.phase = 'done';
        if (penalty) return [...events, ...this.penalty(victim)];
        if (forward(cfg, victim.team, victim.pos) >= cfg.setPieces.freeKickForward)
            return [...events, ...this.awardSetPiece('freekick', victim.team, victim, victim.pos)];
        victim.status.fouled = true;
        return events;
    }

    foul = (): MatchEvent[] => {
        const p = this.active();
        const c = this.carrier();
        if (!c || !this.abilityUsable(p, 'foul')) return [];
        this.state.phase = 'done';
        p.facing = facingFor(p.pos, c.pos, p.facing);
        return this.whistle(p, c, { slide: false, cynical: true });
    };

    private book(p: Piece): MatchEvent[] {
        p.yellows++;
        if (p.yellows >= this.cfg.cards.yellowsForRed) {
            this.log(`Second yellow — ${p.player.name} is sent off!`, p.team);
            this.sendOff(p);
            return [{ t: 'card', on: p.id, card: 'red' }];
        }
        this.log(`${p.player.name} is booked.`, p.team);
        return [{ t: 'card', on: p.id, card: 'yellow' }];
    }

    private sendOff(p: Piece) {
        const s = this.state;
        if (this.carrier()?.id === p.id) s.ball = { kind: 'loose', at: p.pos, restrictedTo: (1 - p.team) as TeamSide };
        s.pieces = s.pieces.filter((q) => q.id !== p.id);
        s.sentOff.push(p);
        const idx = s.order.indexOf(p.id);
        if (idx >= 0) {
            s.order.splice(idx, 1);
            if (idx <= s.turnIndex) s.turnIndex--;
        }
    }

    private penalty(taker: Piece): MatchEvent[] {
        const cfg = this.cfg;
        const gx = attackGoalX(cfg, taker.team);
        const spot: Cell = {
            x: gx < 0 ? cfg.pitch.penaltySpot - 1 : cfg.pitch.cols - cfg.pitch.penaltySpot,
            y: Math.floor((cfg.pitch.rows - 1) / 2),
        };
        const occupant = this.pieceAt(spot);
        if (occupant && occupant.id !== taker.id) occupant.pos = this.freeNear(spot, new Set([key(spot)]));
        taker.pos = spot;
        const [top, bottom] = goalRows(cfg);
        const target: Cell = { x: gx, y: this.rng.chance(0.5) ? top : bottom };
        const d = dist(spot, target);
        const radius = scatterRadius(cfg, taker, d, 'shot', { scatterMult: cfg.cards.penaltyScatterMult });
        const landing: Cell = { x: gx, y: Math.round(target.y + (this.rng() * 2 - 1) * radius) };
        const ev: MatchEvent[] = [{ t: 'kick', by: taker.id, kind: 'shot', from: spot, target, landing, radius }];
        return [...ev, ...this.resolveShot(taker, landing, d, cfg.cards.penaltySaveMod)];
    }

    mark = (targetId: string): MatchEvent[] => {
        const p = this.active();
        if (!this.abilityUsable(p, 'mark')) return [];
        const t = this.markTargets(p).find((o) => o.id === targetId);
        if (!t) return [];
        this.startCooldown(p, 'mark');
        p.status.markOn = t.id;
        p.facing = facingFor(p.pos, t.pos, p.facing);
        this.state.phase = 'done';
        this.log(`${p.player.name} picks up ${t.player.name}.`, p.team);
        return [{ t: 'ability', by: p.id, ability: 'mark', target: t.id }];
    };

    command = (): MatchEvent[] => {
        const p = this.active();
        if (!this.abilityUsable(p, 'command')) return [];
        this.startCooldown(p, 'command');
        for (const q of this.mates(p)) {
            if (cheb(q.pos, p.pos) > this.cfg.abilities.command.radius) continue;
            q.reactionReady = true;
            q.staggered = false;
            q.status.commanded = true;
        }
        this.state.phase = 'done';
        this.log(`${p.player.name} barks orders — the line is set.`, p.team);
        return [{ t: 'ability', by: p.id, ability: 'command' }];
    };

    tempo = (targetId: string): MatchEvent[] => {
        const p = this.active();
        if (!this.abilityUsable(p, 'tempo')) return [];
        const t = this.tempoTargets(p).find((q) => q.id === targetId);
        if (!t) return [];
        this.startCooldown(p, 'tempo');
        const o = this.state.order;
        o.splice(o.indexOf(t.id), 1);
        o.splice(this.state.turnIndex + 1, 0, t.id);
        this.state.phase = 'done';
        this.log(`${p.player.name} sets the tempo — ${t.player.name} goes next.`, p.team);
        return [{ t: 'ability', by: p.id, ability: 'tempo', target: t.id }];
    };

    // ---------------------------------------------------------------- kicking

    kick = (target: Cell, ability?: KickAbility): MatchEvent[] => {
        const p = this.active();
        if (this.state.phase !== 'act' || this.carrier()?.id !== p.id) return [];
        if (ability && !this.abilityUsable(p, ability)) return [];
        const kind = this.kickKind(p, target, ability);
        if (!kind) return [];
        if (ability) this.startCooldown(p, ability);
        const cfg = this.cfg;
        const d = dist(p.pos, target);
        const radius = scatterRadius(cfg, p, d, kind, this.kickMods(ability));
        // uniform sample in the disc
        const ang = this.rng() * Math.PI * 2;
        const rr = Math.sqrt(this.rng()) * radius;
        let landing: Cell = { x: Math.round(target.x + Math.cos(ang) * rr), y: Math.round(target.y + Math.sin(ang) * rr) };
        if (kind === 'shot') landing = { x: target.x, y: Math.round(target.y + Math.sin(ang) * rr) };
        p.facing = facingFor(p.pos, target, p.facing);
        this.state.phase = 'done';
        const freeKick = !!p.status.fouled;
        const sp = this.state.setPiece?.taker === p.id ? this.state.setPiece : null;
        this.state.setPiece = null;
        // a set-piece ball into the box is a delivery: lofted, attacked with headers
        const delivery = !!sp && kind === 'pass' && this.inOwnBox((1 - p.team) as TeamSide, target);
        const events: MatchEvent[] = [];
        if (ability) events.push({ t: 'ability', by: p.id, ability });
        events.push({ t: 'kick', by: p.id, kind, from: p.pos, target, landing, radius });

        // ball flight & interception reactions
        const lineEnd =
            kind === 'shot'
                ? { x: landing.x === -1 ? 0 : cfg.pitch.cols - 1, y: Math.max(0, Math.min(cfg.pitch.rows - 1, landing.y)) }
                : landing;
        const path = line(p.pos, lineEnd).slice(1);
        const lofted = (kind === 'pass' && d > cfg.ball.loftThreshold) || ability === 'cross' || ability === 'chip' || delivery;
        const n = cfg.ball.loftInterceptCells;
        const keeper = this.keeperOf((1 - p.team) as TeamSide);
        const tried = new Set<string>();
        for (let i = 0; i < path.length; i++) {
            if (lofted && i >= n && (ability === 'chip' || i < path.length - n)) continue;
            if (freeKick && i < 2) continue; // the wall stands back
            const c = path[i]!;
            const candidates = this.opponents(p.team)
                .filter((o) => this.canReact(o) && !tried.has(o.id) && cheb(o.pos, c) <= 1)
                .filter((o) => !(kind === 'shot' && o.id === keeper?.id));
            for (const o of candidates) {
                tried.add(o.id);
                o.reactionReady = false;
                const success = this.rng.chance(interceptChance(cfg, o, p, eq(o.pos, c), kind));
                events.push({ t: 'intercept', by: o.id, at: c, success, block: kind === 'shot' });
                if (success) {
                    this.state.ball = { kind: 'held', by: o.id };
                    this.log(
                        kind === 'shot'
                            ? `${o.player.name} throws a body on the line — blocked!`
                            : `${o.player.name} reads it and intercepts.`,
                        o.team,
                    );
                    if (kind === 'shot' && this.rng.chance(cfg.setPieces.blockCorner))
                        return [...events, ...this.awardSetPiece('corner', p.team, null, this.cornerSpot(p.team, landing.y))];
                    return events;
                }
                o.staggered = true;
            }
        }

        if (kind === 'shot') return [...events, ...this.resolveShot(p, landing, d, this.shotSaveMod(p, ability))];
        if (ability === 'through') return [...events, ...this.resolveThrough(p, landing)];
        if (ability === 'cross' || delivery) return [...events, ...this.resolveCross(p, landing)];
        return [...events, ...this.resolveLanding(p, landing)];
    };

    shotSaveMod = (p: Piece, ability?: KickAbility) => {
        const a = this.cfg.abilities;
        if (ability === 'placed') return a.placed.saveMod;
        if (ability === 'power') return a.power.saveMod;
        if (ability === 'chip') {
            const k = this.keeperOf((1 - p.team) as TeamSide);
            const lineX = attackGoalX(this.cfg, p.team) < 0 ? 0 : this.cfg.pitch.cols - 1;
            return k && Math.abs(k.pos.x - lineX) >= a.chip.offLine ? a.chip.saveModOff : a.chip.saveModOn;
        }
        return 0;
    };

    private out(kicker: Piece, landing: Cell): MatchEvent[] {
        const at = clampToPitch(this.cfg, landing);
        const gx = attackGoalX(this.cfg, kicker.team);
        const overByline = gx < 0 ? landing.x < 0 : landing.x >= this.cfg.pitch.cols;
        if (
            overByline &&
            this.opponents(kicker.team).some((o) => cheb(o.pos, at) <= 2) &&
            this.rng.chance(this.cfg.setPieces.bylineCorner)
        ) {
            this.log(`Deflected behind — corner.`, kicker.team);
            return this.awardSetPiece('corner', kicker.team, null, this.cornerSpot(kicker.team, at.y));
        }
        const to = (1 - kicker.team) as TeamSide;
        this.state.ball = { kind: 'loose', at, restrictedTo: to };
        this.log(`Out of play — ${this.state.clubs[to].short} ball.`, to);
        return [{ t: 'out', at, to }];
    }

    /** A marker steps in when the player they shadow receives the ball. */
    private markerChallenge(receiver: Piece): MatchEvent[] {
        const marker = this.opponents(receiver.team).find(
            (o) => o.status.markOn === receiver.id && this.canReact(o) && cheb(o.pos, receiver.pos) <= 2,
        );
        if (!marker) return [];
        marker.reactionReady = false;
        const success = this.rng.chance(tackleChance(this.cfg, marker, receiver, false));
        if (success) {
            this.state.ball = { kind: 'held', by: marker.id };
            this.knock(receiver.id);
            this.wonTackle(marker);
            this.log(`${marker.player.name} was waiting for that — nicks it off ${receiver.player.name}.`, marker.team);
        } else {
            marker.staggered = true;
        }
        return [{ t: 'tackle', by: marker.id, on: receiver.id, success, reaction: true, at: receiver.pos }];
    }

    private receive(kicker: Piece, r: Piece): MatchEvent[] {
        this.state.ball = { kind: 'held', by: r.id };
        r.facing = facingFor(r.pos, kicker.pos, r.facing);
        this.log(
            r.team === kicker.team ? `${kicker.player.name} finds ${r.player.name}.` : `${r.player.name} picks off the stray ball.`,
            r.team,
        );
        const ev: MatchEvent[] = [{ t: 'receive', by: r.id, at: r.pos }];
        return r.team === kicker.team ? [...ev, ...this.markerChallenge(r)] : ev;
    }

    private resolveLanding(kicker: Piece, landing: Cell): MatchEvent[] {
        const cfg = this.cfg;
        if (!inPitch(cfg, landing)) return this.out(kicker, landing);
        const near = this.state.pieces
            .filter((q) => q.id !== kicker.id && cheb(q.pos, landing) <= cfg.ball.controlRadius)
            .map((q) => ({ q, d: dist(q.pos, landing) + this.rng() * 0.3 - (q.team === kicker.team ? 0.05 : 0) }))
            .sort((a, b) => a.d - b.d);
        const r = near[0]?.q;
        if (r) return this.receive(kicker, r);
        this.state.ball = { kind: 'loose', at: landing, restrictedTo: null };
        this.log(`The ball runs loose.`, null);
        return [{ t: 'loose', at: landing }];
    }

    private resolveThrough(kicker: Piece, landing: Cell): MatchEvent[] {
        const cfg = this.cfg;
        if (!inPitch(cfg, landing)) return this.out(kicker, landing);
        const occupant = this.pieceAt(landing);
        const oppNear = this.opponents(kicker.team).filter((o) => cheb(o.pos, landing) <= cfg.ball.controlRadius);
        const runners = this.mates(kicker)
            .filter((q) => cheb(q.pos, landing) <= cfg.abilities.through.runRadius)
            .sort((a, b) => dist(a.pos, landing) - dist(b.pos, landing));
        const runner = runners[0];
        const oppBest = oppNear.sort((a, b) => dist(a.pos, landing) - dist(b.pos, landing))[0];
        if (!runner || occupant || (oppBest && dist(oppBest.pos, landing) < dist(runner.pos, landing)))
            return this.resolveLanding(kicker, landing);
        const path = line(runner.pos, landing);
        runner.facing = facingFor(runner.pos, landing, runner.facing);
        runner.pos = landing;
        this.state.ball = { kind: 'held', by: runner.id };
        this.log(`${runner.player.name} runs onto ${kicker.player.name}'s through ball.`, runner.team);
        return [{ t: 'runOnto', by: runner.id, path }, { t: 'receive', by: runner.id, at: landing }, ...this.markerChallenge(runner)];
    }

    private resolveCross(kicker: Piece, landing: Cell): MatchEvent[] {
        const cfg = this.cfg;
        if (!inPitch(cfg, landing)) return this.out(kicker, landing);
        const R = cfg.abilities.cross.headRadius;
        const contenders = this.state.pieces
            .filter((q) => q.id !== kicker.id && q.player.cls !== 'keeper' && cheb(q.pos, landing) <= R)
            .map((q) => ({
                q,
                d:
                    dist(q.pos, landing) +
                    this.rng() * 1.2 -
                    (q.team !== kicker.team ? cfg.setPieces.defenderEdge : 0) -
                    (q.player.stats.composure - 50) * cfg.setPieces.composureWeight,
            }))
            .sort((a, b) => a.d - b.d);
        const keeper = this.keeperOf((1 - kicker.team) as TeamSide);
        // keeper claims crosses that drop within 1 of him
        if (keeper && cheb(keeper.pos, landing) <= 1 && this.canReact(keeper)) {
            this.state.ball = { kind: 'held', by: keeper.id };
            this.log(`${keeper.player.name} comes and claims the cross.`, keeper.team);
            return [{ t: 'save', by: keeper.id, held: true, at: landing }];
        }
        const winner = contenders[0]?.q;
        if (!winner) {
            this.state.ball = { kind: 'loose', at: landing, restrictedTo: null };
            this.log(`The cross drops with nobody there.`, null);
            return [{ t: 'loose', at: landing }];
        }
        if (winner.team !== kicker.team) {
            this.state.ball = { kind: 'held', by: winner.id };
            if (this.rng.chance(cfg.setPieces.clearCorner)) {
                this.log(`${winner.player.name} heads it behind for a corner.`, winner.team);
                return [
                    { t: 'header', by: winner.id, at: winner.pos },
                    ...this.awardSetPiece('corner', kicker.team, null, this.cornerSpot(kicker.team, landing.y)),
                ];
            }
            this.log(`${winner.player.name} heads the cross clear.`, winner.team);
            return [{ t: 'receive', by: winner.id, at: winner.pos }];
        }
        // attacking header on goal
        const gx = attackGoalX(cfg, kicker.team);
        const [top, bottom] = goalRows(cfg);
        const target: Cell = { x: gx, y: this.rng.int(top, bottom) };
        const d = dist(winner.pos, target);
        const radius = scatterRadius(cfg, winner, d, 'shot', { scatterMult: 1.15, header: true });
        const landingY = Math.round(target.y + (this.rng() * 2 - 1) * radius);
        const hLanding: Cell = { x: gx, y: landingY };
        winner.facing = facingFor(winner.pos, target, winner.facing);
        this.log(`${winner.player.name} rises to meet it!`, winner.team);
        return [
            { t: 'header', by: winner.id, at: winner.pos },
            { t: 'kick', by: winner.id, kind: 'shot', from: winner.pos, target, landing: hLanding, radius },
            ...this.resolveShot(winner, hLanding, d, 0),
        ];
    }

    private resolveShot(shooter: Piece, landing: Cell, distance: number, saveMod: number): MatchEvent[] {
        const cfg = this.cfg;
        const [top, bottom] = goalRows(cfg);
        const defTeam = (1 - shooter.team) as TeamSide;
        const keeper = this.keeperOf(defTeam);
        if (landing.y < top || landing.y > bottom) {
            this.log(`${shooter.player.name} drags it wide.`, shooter.team);
            if (this.rng.chance(cfg.setPieces.wideCorner)) {
                this.log(`Off a defender's heel — corner.`, shooter.team);
                return [
                    { t: 'wide', team: shooter.team },
                    ...this.awardSetPiece('corner', shooter.team, null, this.cornerSpot(shooter.team, landing.y)),
                ];
            }
            if (keeper) this.state.ball = { kind: 'held', by: keeper.id };
            else
                this.state.ball = {
                    kind: 'loose',
                    at: { x: landing.x < 0 ? 2 : cfg.pitch.cols - 3, y: Math.floor(cfg.pitch.rows / 2) },
                    restrictedTo: defTeam,
                };
            return [{ t: 'wide', team: shooter.team }];
        }
        if (keeper) {
            const lineCell = { x: landing.x < 0 ? 0 : cfg.pitch.cols - 1, y: landing.y };
            const chance = saveChance(cfg, keeper, shooter, cheb(keeper.pos, lineCell), distance, saveMod);
            keeper.reactionReady = false;
            if (this.rng.chance(chance)) {
                const held = this.rng.chance(cfg.reactions.catchChance);
                if (held) {
                    this.state.ball = { kind: 'held', by: keeper.id };
                    this.log(`${keeper.player.name} gathers it — great save!`, defTeam);
                } else if (this.rng.chance(cfg.setPieces.parryCorner)) {
                    this.log(`${keeper.player.name} tips it round the post!`, defTeam);
                    return [
                        { t: 'save', by: keeper.id, held, at: lineCell },
                        ...this.awardSetPiece('corner', shooter.team, null, this.cornerSpot(shooter.team, landing.y)),
                    ];
                } else {
                    const dir = landing.x < 0 ? 1 : -1;
                    let at = clampToPitch(cfg, { x: lineCell.x + dir * this.rng.int(2, 4), y: landing.y + this.rng.int(-4, 4) });
                    if (this.pieceAt(at)) at = clampToPitch(cfg, { x: at.x + dir, y: at.y });
                    this.state.ball = { kind: 'loose', at, restrictedTo: null };
                    this.log(`${keeper.player.name} parries it away!`, defTeam);
                }
                return [{ t: 'save', by: keeper.id, held, at: lineCell }];
            }
        }
        this.state.score[shooter.team]++;
        this.log(`GOAL! ${shooter.player.name} scores for ${this.state.clubs[shooter.team].name}.`, shooter.team);
        return [...(keeper ? [{ t: 'saveFail', by: keeper.id } as MatchEvent] : []), { t: 'goal', team: shooter.team, scorer: shooter.id }];
    }

    // ---------------------------------------------------------------- set pieces

    /** Place both teams in formation, give `team` the ball on the centre spot. */
    kickoff = (team: TeamSide) => {
        const cfg = this.cfg;
        this.state.setPiece = null;
        delete this.state.bonusNext;
        delete this.state.bonusTurn;
        const { cols, rows } = cfg.pitch;
        const taken = new Set<string>();
        for (const p of this.state.pieces) {
            const club = this.state.clubs[p.team];
            const formation = cfg.formations.find((f) => f.id === club.formationId) ?? cfg.formations[0]!;
            const slot = formation.slots[p.slot] ?? formation.slots[0]!;
            const nx = Math.min(slot.x, 0.47);
            let c: Cell = { x: Math.round(nx * (cols - 1)), y: Math.round(slot.y * (rows - 1)) };
            if (p.team === 1) c = { x: cols - 1 - c.x, y: rows - 1 - c.y };
            // the side not kicking off stays outside the centre circle
            if (p.team !== team) {
                const half = (cols - 1) / 2;
                const r = cfg.pitch.circleRadius + 1;
                if (Math.abs(c.x - half) < r && Math.abs(c.y - (rows - 1) / 2) < r)
                    c = { x: p.team === 0 ? Math.floor(half - r) : Math.ceil(half + r), y: c.y };
            }
            while (taken.has(key(c))) c = { x: c.x, y: c.y + 1 };
            taken.add(key(c));
            p.pos = c;
            p.facing = p.team === 0 ? 'right' : 'left';
            p.reactionReady = true;
            p.staggered = false;
            p.status = {};
        }
        // kicker: the most advanced outfield player of the team goes to the spot
        const kicker = this.state.pieces
            .filter((p) => p.team === team && p.player.cls !== 'keeper')
            .sort((a, b) => (team === 0 ? b.pos.x - a.pos.x : a.pos.x - b.pos.x))[0]!;
        const spot: Cell = { x: team === 0 ? Math.floor((cols - 1) / 2) : Math.ceil((cols - 1) / 2), y: Math.floor((rows - 1) / 2) };
        const blocker = this.pieceAt(spot);
        if (blocker && blocker.id !== kicker.id) blocker.pos = { ...kicker.pos };
        kicker.pos = spot;
        this.state.ball = { kind: 'held', by: kicker.id } satisfies BallState;
        this.log(`${this.state.clubs[team].name} kick off.`, team);
    };

    /** Corner flag cell on the side `y` went out, at the goal `team` attacks. */
    cornerSpot = (team: TeamSide, y: number): Cell => {
        const { cols, rows } = this.cfg.pitch;
        return { x: attackGoalX(this.cfg, team) < 0 ? 0 : cols - 1, y: y < (rows - 1) / 2 ? 0 : rows - 1 };
    };

    /** Nearest free in-pitch cell to `c` (spiral search), skipping `taken`. */
    freeNear = (c: Cell, taken: Set<string>): Cell => {
        const start = clampToPitch(this.cfg, c);
        for (let r = 0; r < 12; r++) {
            for (let dy = -r; dy <= r; dy++)
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                    const n = { x: start.x + dx, y: start.y + dy };
                    if (
                        inPitch(this.cfg, n) &&
                        !taken.has(key(n)) &&
                        !this.state.pieces.some((q) => eq(q.pos, n) && !taken.has(`id:${q.id}`))
                    )
                        return n;
                }
        }
        return start;
    };

    /** Stop play and set up a corner or a free kick for `team`. Ends the current turn. */
    private awardSetPiece(kind: SetPieceKind, team: TeamSide, taker: Piece | null, spot: Cell): MatchEvent[] {
        const cfg = this.cfg;
        const t =
            taker ??
            this.state.pieces
                .filter((q) => q.team === team && q.player.cls !== 'keeper')
                .sort((a, b) => b.player.stats.passing - a.player.stats.passing)[0];
        if (!t) return [];
        const n = cfg.setPieces.placements;
        const sp: SetPiece = { kind, team, taker: t.id, spot, stage: 'setup', next: team, left: [n, n] };
        this.state.setPiece = sp;
        const from = Object.fromEntries(this.state.pieces.map((p) => [p.id, { ...p.pos }]));
        this.arrangeSetPiece(sp);
        this.state.ball = { kind: 'held', by: t.id };
        this.state.phase = 'done';
        this.log(
            kind === 'corner'
                ? `Corner to ${this.state.clubs[team].name}.`
                : `Free kick to ${this.state.clubs[team].name} in a dangerous area.`,
            team,
        );
        return [{ t: 'setpiece', kind, team, taker: t.id, at: spot, from }];
    }

    /** The default shapes: runners into the box, markers goal-side of them, a wall for free kicks. */
    private arrangeSetPiece(sp: SetPiece) {
        const cfg = this.cfg;
        const { cols, rows, boxDepth, penaltySpot } = cfg.pitch;
        const att = sp.team;
        const def = (1 - att) as TeamSide;
        const lineX = attackGoalX(cfg, att) < 0 ? 0 : cols - 1;
        const dir = lineX === 0 ? 1 : -1;
        const mid = Math.floor((rows - 1) / 2);
        const side = sp.spot.y < mid ? -1 : 1;
        const at = (dx: number, dy: number): Cell => ({ x: lineX + dir * dx, y: mid + dy });
        const taken = new Set<string>();
        const placed = new Set<string>();
        const put = (p: Piece, c: Cell) => {
            for (const q of this.state.pieces) if (!placed.has(q.id)) taken.add(`id:${q.id}`); // unplaced pieces don't block
            const cell = this.freeNear(c, taken);
            p.pos = cell;
            taken.add(key(cell));
            placed.add(p.id);
        };
        for (const p of this.state.pieces) {
            p.reactionReady = true;
            p.staggered = false;
            p.status = {};
        }
        const taker = this.piece(sp.taker);
        put(taker, sp.spot);
        const pool = (team: TeamSide) => this.state.pieces.filter((q) => q.team === team && !placed.has(q.id) && q.player.cls !== 'keeper');
        // attackers: the best finishers attack the box
        const runners = pool(att)
            .sort((a, b) => b.player.stats.shooting + b.player.stats.composure - (a.player.stats.shooting + a.player.stats.composure))
            .slice(0, cfg.setPieces.runners);
        const spots = [at(2, side * 2), at(3, -side * 3), at(penaltySpot - 1, 0), at(boxDepth + 1, -side)];
        runners.forEach((r, i) => put(r, spots[i % spots.length]!));
        const short = pool(att).sort((a, b) => dist(a.pos, sp.spot) - dist(b.pos, sp.spot))[0];
        if (short)
            put(
                short,
                sp.kind === 'corner'
                    ? { x: lineX + dir * 2, y: sp.spot.y - side * 3 }
                    : { x: sp.spot.x, y: sp.spot.y + (sp.spot.y > mid ? -3 : 3) },
            );
        // the rest of the attackers hold a rest defence; their keeper stays home
        const slotOf = (q: Piece) => {
            const f = cfg.formations.find((x) => x.id === this.state.clubs[q.team].formationId) ?? cfg.formations[0]!;
            return f.slots[q.slot] ?? f.slots[0]!;
        };
        const frame = (team: TeamSide, fx: number, fy: number): Cell => {
            const c = { x: Math.round(fx * (cols - 1)), y: Math.round(fy * (rows - 1)) };
            return team === 0 ? c : { x: cols - 1 - c.x, y: rows - 1 - c.y };
        };
        for (const q of pool(att)) {
            const sl = slotOf(q);
            put(q, frame(att, 0.42 + sl.x * 0.22, sl.y));
        }
        for (const k of this.state.pieces.filter((q) => q.player.cls === 'keeper')) {
            if (k.team === att) put(k, frame(att, 0.04, 0.5));
            else put(k, at(0, side));
        }
        // defenders: one marker goal-side of each runner, the best tacklers first
        for (const r of runners) {
            const m = pool(def).sort((a, b) => b.player.stats.tackling - a.player.stats.tackling)[0];
            if (m) put(m, { x: r.pos.x - dir, y: r.pos.y });
        }
        if (sp.kind === 'freekick') {
            const gc = at(0, 0);
            const len = Math.hypot(gc.x - sp.spot.x, gc.y - sp.spot.y) || 1;
            const ux = (gc.x - sp.spot.x) / len;
            const uy = (gc.y - sp.spot.y) / len;
            const centre = {
                x: Math.round(sp.spot.x + ux * cfg.setPieces.wallDistance),
                y: Math.round(sp.spot.y + uy * cfg.setPieces.wallDistance),
            };
            const px = Math.round(-uy) || 0;
            const py = Math.round(ux) || (px ? 0 : 1);
            const offs = [0, 1, -1, 2, -2];
            for (let i = 0; i < cfg.setPieces.wallSize; i++) {
                const w = pool(def).sort((a, b) => dist(a.pos, centre) - dist(b.pos, centre))[0];
                if (w) put(w, { x: centre.x + px * offs[i]!, y: centre.y + py * offs[i]! });
            }
        }
        // zonal cover, then the most advanced stay up as an outlet
        const outlets = pool(def)
            .sort((a, b) => slotOf(b).x - slotOf(a).x)
            .slice(0, sp.kind === 'corner' ? 2 : 1);
        for (const q of outlets) put(q, frame(def, 0.5 + slotOf(q).x * 0.1, slotOf(q).y));
        const zonal = [
            at(2, side * 4),
            at(boxDepth, 0),
            at(4, -side * 2),
            at(boxDepth, side * 5),
            at(boxDepth, -side * 5),
            at(5, side * 6),
        ];
        pool(def).forEach((q, i) => put(q, zonal[i % zonal.length]!));
        for (const q of this.state.pieces) {
            if (!placed.has(q.id)) put(q, q.pos);
            q.facing = facingFor(q.pos, sp.spot, q.facing);
        }
        taker.facing = facingFor(taker.pos, at(penaltySpot, 0), taker.facing);
    }

    /** Cells `team` may place players on during the set-piece setup. */
    placeZone = (team: TeamSide): Cell[] => {
        const sp = this.state.setPiece;
        if (!sp) return [];
        const cfg = this.cfg;
        const { cols, rows, boxDepth, boxWidth } = cfg.pitch;
        const m = cfg.setPieces.zoneMargin;
        const lineX = attackGoalX(cfg, sp.team) < 0 ? 0 : cols - 1;
        const keep = team !== sp.team && sp.kind === 'freekick' ? cfg.setPieces.wallDistance : 2;
        const out: Cell[] = [];
        for (let y = 0; y < rows; y++)
            for (let x = 0; x < cols; x++) {
                const depth = Math.abs(x - lineX);
                if (depth >= boxDepth + m || Math.abs(y - (rows - 1) / 2) > boxWidth / 2 + m) continue;
                const c = { x, y };
                if (cheb(c, sp.spot) < keep) continue;
                out.push(c);
            }
        return out;
    };

    /** May `p` be moved during the setup? (Its side's placement, not the keeper or the taker.) */
    canPlacePiece = (p: Piece) => {
        const sp = this.state.setPiece;
        return !!sp && sp.stage === 'setup' && p.team === sp.next && p.id !== sp.taker && p.player.cls !== 'keeper';
    };

    canPlace = (id: string, to: Cell) => {
        const p = this.state.pieces.find((q) => q.id === id);
        if (!p || !this.canPlacePiece(p) || this.pieceAt(to)) return false;
        return this.placeZone(p.team).some((c) => eq(c, to));
    };

    private advanceSetup() {
        const sp = this.state.setPiece!;
        const other = (1 - sp.next) as TeamSide;
        if (sp.left[other] > 0) sp.next = other;
        else if (sp.left[sp.next] <= 0) sp.stage = 'take';
        if (sp.left[0] <= 0 && sp.left[1] <= 0) sp.stage = 'take';
    }

    /** One setup placement for the side whose turn it is. */
    place = (id: string, to: Cell): MatchEvent[] => {
        if (!this.canPlace(id, to)) return [];
        const sp = this.state.setPiece!;
        const p = this.piece(id);
        const from = p.pos;
        p.pos = to;
        p.facing = facingFor(to, sp.spot, p.facing);
        sp.left[p.team]--;
        this.advanceSetup();
        return [{ t: 'place', id, from, to }];
    };

    /** Pass one placement (the AI waits to see what the other side does). */
    passPlacement = (team: TeamSide) => {
        const sp = this.state.setPiece;
        if (!sp || sp.stage !== 'setup' || sp.next !== team) return;
        sp.left[team]--;
        this.advanceSetup();
    };

    /** The side whose turn it is is happy with its shape. */
    skipPlacements = (team: TeamSide) => {
        const sp = this.state.setPiece;
        if (!sp || sp.stage !== 'setup' || sp.next !== team) return;
        sp.left[team] = 0;
        this.advanceSetup();
    };

    /** A corner for `team` on the `y` side (tutorial and scripted scenes). */
    awardCorner = (team: TeamSide, y: number) => this.awardSetPiece('corner', team, null, this.cornerSpot(team, y));

    /** Scripted scenes: hand the turn to `id` right now (the order is otherwise untouched). */
    stageTurn = (id: string) => {
        const s = this.state;
        const i = s.order.indexOf(id);
        if (i < 0) return;
        s.order.splice(i, 1);
        s.order.splice(s.turnIndex, 0, id);
        this.beginTurn();
    };

    /** Called by the presenter after a goal celebration. */
    restartAfterGoal = (scoredBy: TeamSide): MatchEvent[] => {
        const team = (1 - scoredBy) as TeamSide;
        this.kickoff(team);
        return [{ t: 'kickoff', team }];
    };

    /** Utility for AI/UI: the defending goal x for a team. */
    ownGoalX = (team: TeamSide) => ownGoalX(this.cfg, team);
}

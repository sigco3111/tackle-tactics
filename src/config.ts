/**
 * All tunables live here. Nothing in the engine, AI or UI should hard-code a number
 * that a modder might want to change. `GameConfig` is plain data; `withOverrides`
 * deep-merges a partial config on top of the defaults.
 */

export type ClassId = 'keeper' | 'defender' | 'midfielder' | 'winger' | 'striker';
export type StatId = 'speed' | 'pace' | 'passing' | 'shooting' | 'dribbling' | 'tackling' | 'reflexes' | 'composure';
export type Stats = Record<StatId, number>;
export type TimeoutPolicy = 'lose' | 'auto';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type TeamStyle = 'balanced' | 'press' | 'deep' | 'direct' | 'possession';

export type ClassKit = {
    label: string;
    short: string;
    /** Base movement points before the pace modifier. */
    move: number;
    /** Stat weights used when generating a player of this class (0..1, relative emphasis). */
    statProfile: Stats;
};

export type FormationSlot = {
    cls: ClassId;
    /** Home position, normalised: x 0 = own goal line, 1 = opponent goal line; y 0..1 across the pitch. */
    x: number;
    y: number;
    /** How strongly the slot translates with the ball (0 = pinned, 1 = follows fully). */
    ballShift: number;
    /** Weight of the role job vs. the slot. High = freelancer, low = shape enforcer. */
    roleWeight: number;
};

export type Formation = {
    id: string;
    label: string;
    /** One line on what the shape is for, shown on the tactics screen. */
    note: string;
    slots: FormationSlot[];
};

export const defaultConfig = {
    match: {
        /** Seconds per action. A ceiling, not a metronome. */
        timerSeconds: 15,
        /** A round = every player acts once. The concept's "turn counter". */
        rounds: 30,
        timeoutPolicy: 'lose' as TimeoutPolicy,
        /** Delay before an AI-controlled player acts, so humans can follow. ms */
        aiThinkMs: 320,
        /** Winning the ball in a tackle earns an immediate extra turn (carry it out of the scrum). */
        tackleBonusTurn: true,
        /** What the extra turn allows: 'full', 'noShot' (move and pass, no shooting) or 'move' (a run only). */
        tackleBonusMode: 'noShot' as 'full' | 'noShot' | 'move',
        /** A deliberate tackle is a duel: if it fails, the carrier gets the extra turn to escape. */
        missedTackleBonus: true,
        /** Extra pause after an action resolves, so the animation reads. ms */
        resolvePauseMs: 260,
        goalPauseMs: 1900,
    },
    pitch: {
        cols: 50,
        rows: 30,
        /** Cells of run-off rendered around the pitch (cosmetic). */
        margin: 6,
        /** Goal mouth height in cells (centred on the halfway row). */
        goalWidth: 4,
        boxDepth: 8,
        boxWidth: 18,
        sixDepth: 3,
        sixWidth: 9,
        circleRadius: 4.5,
        penaltySpot: 6,
    },
    camera: {
        cellPx: 24,
        scale: 1.12,
    },
    sprites: {
        framePx: 64,
        renderPx: 52,
        /** Pixel row of the feet inside a frame, measured on the source art. */
        feetY: 60,
        msPerFrame: 110,
        /** Goal sprite scale relative to the goal mouth. */
        goalScaleX: 1,
        goalScaleY: 1,
    },
    movement: {
        /** Every `paceStep` points above/below 50 pace adds/removes a move point. */
        paceStep: 22,
        /** Dribbling costs extra move points per cell. */
        dribbleCostMult: 1.4,
        /** Entering an opponent's adjacent cell ends an off-ball run (marking). */
        zocStopsOffBall: true,
    },
    ball: {
        /** Scatter radius (cells) = base + distance * perCell, then divided by skill factor. */
        passScatterBase: 0.15,
        passScatterPerCell: 0.085,
        shotScatterBase: 0.5,
        shotScatterPerCell: 0.11,
        /** skill factor = 0.55 + skill/100 * skillScale */
        skillScale: 0.9,
        maxScatter: 6,
        /** Passes longer than this are lofted: only interceptable near origin and landing. */
        loftThreshold: 12,
        loftInterceptCells: 2,
        /** Players within this Chebyshev distance of the landing cell can control the ball. */
        controlRadius: 1,
        /** Max shot distance (cells) the UI lets you aim from. */
        maxShotRange: 26,
    },
    reactions: {
        /** chance = base + (defStat - atkStat)/100 * statWeight, clamped. RNG sits on a stat floor. */
        interceptBase: 0.42,
        interceptStatWeight: 0.5,
        /** Lofted ball near its landing is easier to read than a driven ball. */
        tackleBase: 0.34,
        tackleStatWeight: 0.6,
        blockShotBase: 0.22,
        saveBase: 0.66,
        saveStatWeight: 0.55,
        /** Each cell the keeper is away from the shot's line costs this much save chance. */
        saveDistancePenalty: 0.12,
        /** Each cell of shot distance under 10 makes it harder to save. */
        saveCloseRangePenalty: 0.03,
        /** Each cell of shot distance beyond 10 makes it easier to save (keeper sees it coming). */
        saveLongRangeBonus: 0.015,
        minChance: 0.05,
        maxChance: 0.92,
        /** Active tackle (your own action) is a little more reliable than a reaction. */
        activeTackleBonus: 0.04,
        /** Chance a save is held rather than parried loose. */
        catchChance: 0.45,
    },
    ai: {
        /** Softmax temperature by difficulty: wider band = weaker AI. */
        temperature: { easy: 0.55, normal: 0.22, hard: 0.08 } as Record<Difficulty, number>,
        /** Weights for the off-ball cell scorer. */
        wSlot: 1.0,
        wJob: 1.4,
        wOpen: 0.45,
        wLane: 0.8,
        /** Normalised x pushed forward when in possession / pulled back when not. */
        stretch: 0.2,
        compress: 0.08,
        shootRange: 21,
        tackleThreshold: 0.33,
        /** How much the AI fears a missed tackle (the carrier then escapes with an extra turn). */
        missRisk: 0.2,
        /** Second presser joins once the carrier is this far (normalised) into our half. */
        doublePressFrom: 0.45,
        /** Job weight for pressers (overrides roleWeight) and the bonus for ending in contact. */
        pressWeight: 1.6,
        pressContactBonus: 2.5,
        /** Off-ball attackers' pull towards goal. */
        wForward: 0.25,
        /** Small cost on using an ability so it is saved for moments that matter. */
        abilityCost: 0.12,
        /** How likely an opponent in range actually goes for the tackle (exposure model). */
        tackleIntent: 0.65,
        pressersAssumed: 1,
        /** Cost of losing the ball: base + the opponent's threat from that cell. */
        lossBase: 0.05,
        /** Expected-threat curve: peak xT just in front of goal; small bonus for space. */
        xtPeak: 0.26,
        xtLinear: 0.08,
        openValue: 0.05,
        /** Pass success multiplier when an opponent stands next to the receiver. */
        contestedReceive: 0.75,
        goalValue: 3.5,
        crossValue: 0.95,
        /** Bonus per 10 cells of forward progress on a pass (Direct teams love it). */
        directBonus: 0,
        /**
         * Team identities: additive tweaks to the knobs above. A club's style is fixed (see
         * `styleOf`); the human's auto-players follow the game plan chosen in match prep.
         */
        styles: {
            balanced: { label: '균형', note: '극단 없이 경기 흐름에 맞춰 적응합니다.', d: {} },
            press: {
                label: '하이 프레스',
                note: '높은 위치에서 공을 압박합니다. 뒤에 공간이 생깁니다.',
                d: { doublePressFrom: -0.22, compress: -0.04, pressWeight: 0.5, stretch: 0.03, tackleThreshold: -0.05 },
            },
            deep: {
                label: '로우 블록',
                note: '깊고 촘촘하게 내려앉아 역습을 기다립니다.',
                d: { compress: 0.09, doublePressFrom: 0.2, pressWeight: -0.4, stretch: -0.06, lossBase: 0.03 },
            },
            direct: { label: '직선적', note: '롱볼을 앞으로 보내고 슛을 일찍 시도합니다.', d: { directBonus: 0.14, shootRange: 2, wForward: 0.15 } },
            possession: {
                label: '점유',
                note: '인내심 있는 패스 플레이. 공을 내주는 것을 싫어합니다.',
                d: { lossBase: 0.06, contestedReceive: -0.1, shootRange: -2, openValue: 0.04 },
            },
        } as Record<TeamStyle, { label: string; note: string; d: Partial<Record<string, number>> }>,
        /** Game state: protect a late lead, chase a late deficit (fractions of the match). */
        protectFrom: 0.7,
        chaseFrom: 0.55,
        protect: { compress: 0.07, stretch: -0.06, lossBase: 0.05, doublePressFrom: 0.15 } as Partial<Record<string, number>>,
        chase: { stretch: 0.07, goalValue: 0.6, shootRange: 3, pressWeight: 0.4, doublePressFrom: -0.18, wForward: 0.15 } as Partial<
            Record<string, number>
        >,
    },
    world: {
        /** Share of a club's generated players who come from another nation. */
        foreignShare: 0.2,
        squadSize: 11,
        /** Total level range per player; a share of players multiclass. */
        levelRange: [2, 12] as [number, number],
        multiclassChance: 0.3,
        /** Fraction of total levels that may go into the secondary class. */
        multiclassShare: [0.2, 0.5] as [number, number],
        /** Talent is a bell curve (mean, sd), multiplier on stats. */
        talentMean: 1,
        talentSd: 0.12,
        statFloor: 25,
        statCeil: 95,
    },
    classes: {
        keeper: {
            label: '골키퍼',
            short: 'GK',
            move: 3,
            statProfile: { speed: 0.3, pace: 0.3, passing: 0.5, shooting: 0.1, dribbling: 0.2, tackling: 0.3, reflexes: 1, composure: 0.7 },
        },
        defender: {
            label: '수비수',
            short: 'DF',
            move: 5,
            statProfile: {
                speed: 0.45,
                pace: 0.5,
                passing: 0.5,
                shooting: 0.2,
                dribbling: 0.3,
                tackling: 1,
                reflexes: 0.7,
                composure: 0.6,
            },
        },
        midfielder: {
            label: '미드필더',
            short: 'MF',
            move: 6,
            statProfile: {
                speed: 0.6,
                pace: 0.6,
                passing: 1,
                shooting: 0.5,
                dribbling: 0.6,
                tackling: 0.55,
                reflexes: 0.75,
                composure: 0.8,
            },
        },
        winger: {
            label: '윙어',
            short: 'WG',
            move: 7,
            statProfile: { speed: 1, pace: 1, passing: 0.65, shooting: 0.5, dribbling: 1, tackling: 0.25, reflexes: 0.5, composure: 0.5 },
        },
        striker: {
            label: '스트라이커',
            short: 'ST',
            move: 6,
            statProfile: {
                speed: 0.75,
                pace: 0.75,
                passing: 0.5,
                shooting: 1,
                dribbling: 0.7,
                tackling: 0.2,
                reflexes: 0.6,
                composure: 0.8,
            },
        },
    } as Record<ClassId, ClassKit>,
    formations: [
        {
            id: '4-3-3',
            label: '4-3-3',
            note: '균형형. 윙어가 공격을 넓히고 단독 스트라이커를 돕고, 중원 3명이 공을 지킵니다.',
            slots: [
                { cls: 'keeper', x: 0.03, y: 0.5, ballShift: 0.15, roleWeight: 0.2 },
                { cls: 'defender', x: 0.2, y: 0.15, ballShift: 0.45, roleWeight: 0.6 },
                { cls: 'defender', x: 0.17, y: 0.38, ballShift: 0.4, roleWeight: 0.35 },
                { cls: 'defender', x: 0.17, y: 0.62, ballShift: 0.4, roleWeight: 0.35 },
                { cls: 'defender', x: 0.2, y: 0.85, ballShift: 0.45, roleWeight: 0.6 },
                { cls: 'midfielder', x: 0.33, y: 0.5, ballShift: 0.5, roleWeight: 0.4 },
                { cls: 'midfielder', x: 0.4, y: 0.3, ballShift: 0.6, roleWeight: 0.8 },
                { cls: 'midfielder', x: 0.4, y: 0.7, ballShift: 0.6, roleWeight: 0.8 },
                { cls: 'winger', x: 0.46, y: 0.1, ballShift: 0.6, roleWeight: 1.0 },
                { cls: 'winger', x: 0.46, y: 0.9, ballShift: 0.6, roleWeight: 1.0 },
                { cls: 'striker', x: 0.48, y: 0.5, ballShift: 0.7, roleWeight: 1.1 },
            ],
        },
        {
            id: '4-4-2',
            label: '4-4-2 (딥 블록)',
            note: '4명씩 두 줄로 깊게 내려앉아 두 스트라이커에게 일찍 연결합니다.',
            slots: [
                { cls: 'keeper', x: 0.03, y: 0.5, ballShift: 0.15, roleWeight: 0.2 },
                { cls: 'defender', x: 0.17, y: 0.15, ballShift: 0.4, roleWeight: 0.45 },
                { cls: 'defender', x: 0.14, y: 0.38, ballShift: 0.35, roleWeight: 0.3 },
                { cls: 'defender', x: 0.14, y: 0.62, ballShift: 0.35, roleWeight: 0.3 },
                { cls: 'defender', x: 0.17, y: 0.85, ballShift: 0.4, roleWeight: 0.45 },
                { cls: 'winger', x: 0.32, y: 0.12, ballShift: 0.55, roleWeight: 0.8 },
                { cls: 'midfielder', x: 0.31, y: 0.38, ballShift: 0.55, roleWeight: 0.55 },
                { cls: 'midfielder', x: 0.31, y: 0.62, ballShift: 0.55, roleWeight: 0.55 },
                { cls: 'winger', x: 0.32, y: 0.88, ballShift: 0.55, roleWeight: 0.8 },
                { cls: 'striker', x: 0.47, y: 0.4, ballShift: 0.65, roleWeight: 1.0 },
                { cls: 'striker', x: 0.47, y: 0.6, ballShift: 0.65, roleWeight: 1.0 },
            ],
        },
        {
            id: '3-4-3',
            label: '3-4-3 (높은 라인)',
            note: '전면 공격: 앞에 3명, 높은 수비 라인, 그 뒤의 공간.',
            slots: [
                { cls: 'keeper', x: 0.05, y: 0.5, ballShift: 0.2, roleWeight: 0.2 },
                { cls: 'defender', x: 0.24, y: 0.25, ballShift: 0.5, roleWeight: 0.5 },
                { cls: 'defender', x: 0.22, y: 0.5, ballShift: 0.45, roleWeight: 0.35 },
                { cls: 'defender', x: 0.24, y: 0.75, ballShift: 0.5, roleWeight: 0.5 },
                { cls: 'winger', x: 0.38, y: 0.08, ballShift: 0.6, roleWeight: 0.9 },
                { cls: 'midfielder', x: 0.36, y: 0.38, ballShift: 0.55, roleWeight: 0.5 },
                { cls: 'midfielder', x: 0.36, y: 0.62, ballShift: 0.55, roleWeight: 0.5 },
                { cls: 'winger', x: 0.38, y: 0.92, ballShift: 0.6, roleWeight: 0.9 },
                { cls: 'striker', x: 0.47, y: 0.22, ballShift: 0.65, roleWeight: 1.0 },
                { cls: 'striker', x: 0.48, y: 0.5, ballShift: 0.7, roleWeight: 1.1 },
                { cls: 'striker', x: 0.47, y: 0.78, ballShift: 0.65, roleWeight: 1.0 },
            ],
        },
        {
            // two holders screen the back four; the No. 10 links to a lone striker
            id: '4-2-3-1',
            label: '4-2-3-1',
            note: '홀딩 미드필더 2명이 수비를 보호하고, 10번이 단독 스트라이커에게 공급합니다.',
            slots: [
                { cls: 'keeper', x: 0.03, y: 0.5, ballShift: 0.15, roleWeight: 0.2 },
                { cls: 'defender', x: 0.2, y: 0.15, ballShift: 0.45, roleWeight: 0.6 },
                { cls: 'defender', x: 0.17, y: 0.38, ballShift: 0.4, roleWeight: 0.35 },
                { cls: 'defender', x: 0.17, y: 0.62, ballShift: 0.4, roleWeight: 0.35 },
                { cls: 'defender', x: 0.2, y: 0.85, ballShift: 0.45, roleWeight: 0.6 },
                { cls: 'midfielder', x: 0.32, y: 0.4, ballShift: 0.55, roleWeight: 0.4 },
                { cls: 'midfielder', x: 0.32, y: 0.6, ballShift: 0.55, roleWeight: 0.4 },
                { cls: 'winger', x: 0.46, y: 0.1, ballShift: 0.6, roleWeight: 1.0 },
                { cls: 'midfielder', x: 0.43, y: 0.5, ballShift: 0.65, roleWeight: 0.95 },
                { cls: 'winger', x: 0.46, y: 0.9, ballShift: 0.6, roleWeight: 1.0 },
                { cls: 'striker', x: 0.48, y: 0.5, ballShift: 0.7, roleWeight: 1.1 },
            ],
        },
        {
            // narrow: no wingers, the full-backs bring the width, two strikers up top
            id: '4-3-1-2',
            label: '4-3-1-2 (다이아몬드)',
            note: '좁은 구조: 윙어 없이 풀백이 폭을 만들고 두 스트라이커가 중앙을 뚫습니다.',
            slots: [
                { cls: 'keeper', x: 0.03, y: 0.5, ballShift: 0.15, roleWeight: 0.2 },
                { cls: 'defender', x: 0.19, y: 0.14, ballShift: 0.4, roleWeight: 0.55 },
                { cls: 'defender', x: 0.17, y: 0.38, ballShift: 0.4, roleWeight: 0.35 },
                { cls: 'defender', x: 0.17, y: 0.62, ballShift: 0.4, roleWeight: 0.35 },
                { cls: 'defender', x: 0.19, y: 0.86, ballShift: 0.4, roleWeight: 0.55 },
                // the diamond holds its shape rather than swarming the ball (it dominated when it chased)
                { cls: 'midfielder', x: 0.29, y: 0.5, ballShift: 0.3, roleWeight: 0.25 },
                { cls: 'midfielder', x: 0.36, y: 0.3, ballShift: 0.35, roleWeight: 0.5 },
                { cls: 'midfielder', x: 0.36, y: 0.7, ballShift: 0.35, roleWeight: 0.5 },
                { cls: 'midfielder', x: 0.42, y: 0.5, ballShift: 0.4, roleWeight: 0.65 },
                { cls: 'striker', x: 0.48, y: 0.4, ballShift: 0.65, roleWeight: 0.9 },
                { cls: 'striker', x: 0.48, y: 0.6, ballShift: 0.65, roleWeight: 0.9 },
            ],
        },
        {
            // five at the back, wing-backs tuck in, two strikers stay high to break
            id: '5-3-2',
            label: '5-3-2 (역습)',
            note: '5백으로 버티고 두 스트라이커를 높게 남겨 역습합니다.',
            slots: [
                { cls: 'keeper', x: 0.03, y: 0.5, ballShift: 0.15, roleWeight: 0.2 },
                { cls: 'defender', x: 0.22, y: 0.1, ballShift: 0.55, roleWeight: 0.75 },
                { cls: 'defender', x: 0.15, y: 0.3, ballShift: 0.35, roleWeight: 0.3 },
                { cls: 'defender', x: 0.13, y: 0.5, ballShift: 0.3, roleWeight: 0.25 },
                { cls: 'defender', x: 0.15, y: 0.7, ballShift: 0.35, roleWeight: 0.3 },
                { cls: 'defender', x: 0.22, y: 0.9, ballShift: 0.55, roleWeight: 0.75 },
                { cls: 'midfielder', x: 0.3, y: 0.32, ballShift: 0.5, roleWeight: 0.45 },
                { cls: 'midfielder', x: 0.28, y: 0.5, ballShift: 0.5, roleWeight: 0.35 },
                { cls: 'midfielder', x: 0.3, y: 0.68, ballShift: 0.5, roleWeight: 0.45 },
                { cls: 'striker', x: 0.46, y: 0.4, ballShift: 0.7, roleWeight: 1.05 },
                { cls: 'striker', x: 0.46, y: 0.6, ballShift: 0.7, roleWeight: 1.05 },
            ],
        },
    ] as Formation[],
    /**
     * Active abilities. A class grants an ability once the player's level *in that class*
     * reaches `unlock` (multiclassing = level distribution). Phases:
     *   pre  — used in the move phase without ending it (e.g. Trick, then still move)
     *   move — replaces the normal move with a different movement rule
     *   act  — the action after moving
     * `cooldown` is in rounds. All numbers are tunables.
     */
    abilities: {
        // ---- Winger
        sprint: {
            cls: 'winger',
            unlock: 2,
            phase: 'move',
            cooldown: 3,
            label: '스프린트',
            key: 'Q',
            icon: '»',
            short: '이동 +3, 직선',
            how: '선택한 뒤 8방향 직선 위의 칸을 클릭하세요.',
            desc: '직선으로 질주: 이동 +3, 8방향만 가능.',
            bonusMove: 3,
        },
        trick: {
            cls: 'winger',
            unlock: 2,
            phase: 'pre',
            cooldown: 2,
            label: '트릭',
            key: 'W',
            icon: '↯',
            short: '인접 수비수의 반응 행동 빼앗기',
            how: '즉시 발동. 이후에도 이동할 수 있습니다.',
            desc: '페인트: 인접한 상대는 모두 당신의 드리블을 이겨야 하며, 못 이기면 반응 행동을 잃습니다. 이후에도 이동할 수 있습니다.',
            base: 0.55,
            statWeight: 0.6,
        },
        cross: {
            cls: 'winger',
            unlock: 5,
            phase: 'act',
            cooldown: 0,
            label: '크로스',
            key: 'E',
            icon: '⤴',
            short: '박스 안으로 헤딩용 공 배달',
            how: '선택한 뒤 상대 박스 안의 칸을 조준하세요.',
            desc: '측면에서 박스 안으로 띄운 공. 낙하 지점 2칸 이내의 동료가 헤딩으로 골을 노립니다.',
            headRadius: 2,
            wideRows: 7,
            minForward: 0.66,
        },
        // ---- Striker
        run: {
            cls: 'striker',
            unlock: 2,
            phase: 'move',
            cooldown: 2,
            label: '뒷공간 침투',
            key: 'Q',
            icon: '⇢',
            short: '이동 +1, 마킹 무시',
            how: '선택한 뒤 달릴 위치를 클릭하세요. 공이 없을 때만 가능합니다.',
            desc: '공 없는 움직임: 이동 +1, 마킹 무시.',
            bonusMove: 1,
        },
        placed: {
            cls: 'striker',
            unlock: 2,
            phase: 'act',
            cooldown: 0,
            label: '플레이스 슛',
            key: 'W',
            icon: '◎',
            short: '정확한 슛, 막기 쉬움',
            how: '선택한 뒤 골문을 조준하세요.',
            desc: '코스를 노립니다: 범위는 좁지만 골키퍼가 막기 더 쉽습니다.',
            scatterMult: 0.65,
            saveMod: 0.12,
        },
        power: {
            cls: 'striker',
            unlock: 5,
            phase: 'act',
            cooldown: 1,
            label: '파워 슛',
            key: 'E',
            icon: '✸',
            short: '거친 슛, 막기 어려움',
            how: '선택한 뒤 골문을 조준하세요.',
            desc: '강하게 때립니다: 범위가 넓고 막기 훨씬 어렵습니다.',
            scatterMult: 1.3,
            saveMod: -0.2,
        },
        chip: {
            cls: 'striker',
            unlock: 8,
            phase: 'act',
            cooldown: 2,
            label: '칩슛',
            key: 'R',
            icon: '⌒',
            short: '나와 있는 골키퍼 넘기기',
            how: '선택한 뒤 골문을 조준하세요. 출발 시점에만 막을 수 있습니다.',
            desc: '골키퍼 머리 위로 띄웁니다. 출발 시점에만 막을 수 있으며, 골키퍼가 나와 있으면 치명적이고 아니면 소용없습니다.',
            scatterMult: 1.1,
            offLine: 2,
            saveModOff: -0.4,
            saveModOn: 0.2,
        },
        // ---- Midfielder
        press: {
            cls: 'midfielder',
            unlock: 2,
            phase: 'move',
            cooldown: 2,
            label: '압박',
            key: 'Q',
            icon: '⊳',
            short: '이동 +1, 공 소유자 압박',
            how: '선택한 뒤 공 소유자 옆으로 이동하세요.',
            desc: '이동 +1, 마킹 무시. 이동을 마친 자리 옆의 상대 공 소유자는 압박을 받아 킥이 더 흔들리고 태클당하기 쉬워집니다.',
            bonusMove: 1,
            pressureScatter: 1.45,
            pressureTackle: 0.08,
        },
        through: {
            cls: 'midfielder',
            unlock: 2,
            phase: 'act',
            cooldown: 2,
            label: '스루패스',
            key: 'W',
            icon: '↠',
            short: '공간 패스, 동료가 달려가 받음',
            how: '선택한 뒤 동료 앞의 빈 공간을 조준하세요.',
            desc: '공간으로 보내는 패스: 낙하 지점 3칸 이내의 가장 가까운 동료가 달려가 받습니다.',
            runRadius: 3,
        },
        tempo: {
            cls: 'midfielder',
            unlock: 5,
            phase: 'act',
            cooldown: 4,
            label: '템포 조절',
            key: 'E',
            icon: '⏩',
            short: '동료가 다음에 행동',
            how: '선택한 뒤 강조된 동료를 클릭하세요.',
            desc: '이번 라운드에 아직 행동하지 않은 동료를 지목하면 그 선수가 다음에 행동합니다.',
        },
        // ---- Defender
        slide: {
            cls: 'defender',
            unlock: 2,
            phase: 'act',
            cooldown: 2,
            label: '슬라이딩 태클',
            key: 'Q',
            icon: '⟿',
            short: '2칸 거리에서 태클',
            how: '공 소유자가 2칸 이내일 때 즉시 발동. 놓치면 넘어집니다.',
            desc: '최대 2칸 떨어진 공 소유자를 태클합니다. 놓치면 넘어져서 다음 턴 이동이 절반이 됩니다.',
            reach: 2,
            bonus: 0.04,
        },
        mark: {
            cls: 'defender',
            unlock: 2,
            phase: 'act',
            cooldown: 0,
            label: '대인 마크',
            key: 'W',
            icon: '⌖',
            short: '상대 한 명 따라붙기',
            how: '선택한 뒤 4칸 이내의 강조된 상대를 클릭하세요.',
            desc: '4칸 이내의 상대를 따라붙습니다. 그 상대에 대한 마킹 범위가 2칸으로 늘고, 공을 받으면 바로 달라붙습니다.',
            range: 4,
        },
        foul: {
            cls: 'defender',
            unlock: 5,
            phase: 'act',
            cooldown: 0,
            label: '전술적 파울',
            key: 'E',
            icon: '!',
            short: '공 소유자 정지, 카드 위험',
            how: '공 소유자 바로 옆에서 즉시 발동. 자기 박스 안이면 페널티입니다!',
            desc: '인접한 공 소유자를 완전히 멈춥니다. 다음 턴에 이동할 수 없습니다. 카드 위험이 있으며, 자기 박스 안이면 페널티입니다.',
            yellowChance: 0.45,
        },
        // ---- Keeper
        command: {
            cls: 'keeper',
            unlock: 2,
            phase: 'act',
            cooldown: 3,
            label: '지휘',
            key: 'Q',
            icon: '⚑',
            short: '근처 동료 반응 행동 회복',
            how: '즉시 발동. 5칸 이내의 동료에게 적용됩니다.',
            desc: '수비 라인을 정비합니다. 5칸 이내의 동료가 반응 행동을 되찾고 다음 턴까지 더 잘 반응합니다.',
            radius: 5,
            bonus: 0.1,
        },
        rush: {
            cls: 'keeper',
            unlock: 5,
            phase: 'move',
            cooldown: 3,
            label: '전진 수비',
            key: 'W',
            icon: '⇉',
            short: '이동 +3, 마킹 무시, 태클 강화',
            how: '선택한 뒤 돌진할 위치를 클릭하세요.',
            desc: '골라인에서 뛰쳐나옵니다. 이동 +3, 마킹 무시, 이번 턴 태클이 강해집니다.',
            bonusMove: 3,
            tackleBonus: 0.12,
        },
    },
    /** Passive traits, unlocked by class level like abilities. Applied inside rules.ts. */
    passives: {
        /** Every keeper has it (innate: no perk pick). A reaction-ready keeper claims a loose ball this close. */
        safeHands: {
            cls: 'keeper',
            unlock: 1,
            innate: true,
            label: '안정적인 손',
            desc: '3칸 이내의 주인 없는 공을 자기 턴을 기다리지 않고 잡아냅니다(반응 행동 사용).',
            range: 3,
        },
        distributor: { cls: 'keeper', unlock: 2, label: '배급자', desc: '골키퍼 킥의 흩어짐이 35% 줄어듭니다.', passScatter: 0.65 },
        shotStopper: { cls: 'keeper', unlock: 5, label: '슈팅 방어', desc: '선방 확률 +10%.', save: 0.1 },
        stopper: { cls: 'defender', unlock: 5, label: '스토퍼', desc: '태클 확률 +8%.', tackle: 0.08 },
        vision: { cls: 'midfielder', unlock: 5, label: '시야', desc: '패스의 흩어짐이 20% 줄어듭니다.', passScatter: 0.8 },
        reader: { cls: 'midfielder', unlock: 8, label: '리더', desc: '인터셉트 확률 +10%.', intercept: 0.1 },
        elusive: { cls: 'winger', unlock: 5, label: '날렵함', desc: '당신에 대한 태클 성공 확률이 10% 낮아집니다.', evade: 0.1 },
        aerial: { cls: 'striker', unlock: 5, label: '공중볼 위협', desc: '헤딩의 흩어짐이 30% 줄어듭니다.', headerScatter: 0.7 },
        clinical: { cls: 'striker', unlock: 8, label: '결정력', desc: '슛의 흩어짐이 20% 줄어듭니다.', shotScatter: 0.8 },
    },
    /**
     * Perk choices: at each of these class levels the player picks ONE of the options (an active
     * ability or a passive) and the other is gone for good, so two wingers can play differently.
     * A tier with a single option is granted automatically. Unlock levels above match these tiers.
     */
    perkTiers: {
        keeper: [
            { level: 2, options: ['command', 'distributor'] },
            { level: 5, options: ['rush', 'shotStopper'] },
        ],
        defender: [
            { level: 2, options: ['slide', 'mark'] },
            { level: 5, options: ['foul', 'stopper'] },
        ],
        midfielder: [
            { level: 2, options: ['press', 'through'] },
            { level: 5, options: ['tempo', 'vision'] },
            { level: 8, options: ['reader'] },
        ],
        winger: [
            { level: 2, options: ['sprint', 'trick'] },
            { level: 5, options: ['cross', 'elusive'] },
        ],
        striker: [
            { level: 2, options: ['run', 'placed'] },
            { level: 5, options: ['power', 'aerial'] },
            { level: 8, options: ['chip', 'clinical'] },
        ],
    } as Record<ClassId, Array<{ level: number; options: string[] }>>,
    /** The manager layer. Tier 0 is the top division. */
    career: {
        divisions: 5,
        clubsPerDivision: 10,
        /** Squad composition per club (by primary class). */
        squadMake: { keeper: 2, defender: 5, midfielder: 4, winger: 2, striker: 3 } as Record<ClassId, number>,
        squadMin: 13,
        squadMax: 20,
        /** Days between matchdays (matchday, then training days). */
        daysPerMatchday: 3,
        /** Per tier (index 0 = top): total level range and talent shift for generated players. */
        tierLevels: [
            [9, 16],
            [7, 13],
            [5, 11],
            [3, 9],
            [2, 7],
        ] as Array<[number, number]>,
        tierTalent: [0.1, 0.05, 0, -0.04, -0.08],
        /** Chance a generated player is a rare high-growth gem (bigger in lower tiers' markets = discovery). */
        gemChance: 0.04,
        startingBudget: [2_400_000, 1_100_000, 500_000, 240_000, 120_000],
        /** Per-match flat fee and win bonus by tier. */
        matchFee: [260_000, 130_000, 64_000, 32_000, 17_000],
        winBonus: 0.6,
        drawBonus: 0.2,
        /** Cup winner prize as a multiple of the club's match fee. */
        cupWinnerBonus: 4,
        /**
         * The manager's ground: each size's capacity, the division needed before expanding to it
         * (tier, 0 = top), the building cost, and gate receipts per home match (× the match fee).
         */
        ground: {
            village: { capacity: 1_200, minTier: 4, cost: 0, gate: 0.15 },
            town: { capacity: 6_000, minTier: 3, cost: 300_000, gate: 0.4 },
            city: { capacity: 18_000, minTier: 2, cost: 1_200_000, gate: 0.8 },
            grand: { capacity: 45_000, minTier: 1, cost: 4_000_000, gate: 1.4 },
        },
        /** AI transfer activity (training days) and offers for the manager's players. */
        transfers: {
            /** Clubs (random, any nation) that look at the market each training day. */
            clubsPerDay: 3,
            /** A signing has to lift the weakest XI slot by at least this much fit. */
            minGain: 8,
            /** Clubs bidding for the manager's players settle for less: he just has to beat their weakest starter there. */
            bidMinGain: 2,
            /** Share of its budget a club will spend on one player. */
            spendShare: 0.7,
            /** Clubs (random) that consider transfer-listing a spare player each training day. */
            listPerDay: 20,
            /** Days a player stays on the transfer list before the club takes him off. */
            listDays: 40,
            /** Most players on the transfer list at once. */
            maxListed: 260,
            /** Chance per training day of an offer for one of the manager's players. */
            bidChance: 0.11,
            /** Offer = player value × this range. */
            bidPremium: [1.15, 1.65] as [number, number],
            /** AI clubs' yearly income (× their division's starting budget), and the cap on their budget. */
            aiIncome: 0.4,
            aiBudgetCap: 2.5,
        },
        /** International cup: how many clubs of each top flight qualify, and the winners' bonus (× match fee). */
        intlPerNation: 2,
        intlWinnerBonus: 8,
        /** Season-goal lump sums as multiples of the tier's match fee. */
        goalTitle: 6,
        goalTop4: 2.5,
        goalSurvive: 1,
        promote: 2,
        relegate: 2,
        /** XP & levelling. XP needed for the next level in a class = base + perLevel × current level. */
        xpBase: 80,
        xpPerLevel: 35,
        matchXp: 30,
        /** Stat growth: each level-up hands out growth × (0.7..1.3) stat points, weighted by class profile. */
        growthRange: [1.5, 5] as [number, number],
        peakAgeRange: [24, 28] as [number, number],
        /** End-of-season stat delta by (age − peak age) band. */
        aging: [
            { upTo: -6, delta: 3 },
            { upTo: -2, delta: 1.5 },
            { upTo: 1, delta: 0 },
            { upTo: 3, delta: -1 },
            { upTo: 6, delta: -2.5 },
            { upTo: 99, delta: -4.5 },
        ],
        retireFrom: 34,
        retireChance: 0.45,
        /** Simulated (AI vs AI) results: goals ~ Poisson(base × (strength ratio)^exp × home). */
        sim: { baseGoals: 1.5, exponent: 3.2, home: 1.08 },
        /** Match prep: a plan that counters the opponent's style is worth this much morale on the day. */
        prep: {
            edge: 6,
            /** Derbies: everyone is a bit more up for it, and the result swings morale harder. */
            derbyLift: 4,
            derbySwing: 6,
            talk: { calm: 4, fire: 8, overheatAt: 80, overheatChance: 0.35, overheat: -5, demandUp: 6, demandDown: -5 },
            /** Quick sims: each point of edge nudges expected goals by this fraction. */
            simEdge: 0.012,
        },
        market: {
            size: 72,
            priceMarkup: 1.15,
            saleCut: 0.85,
            /** Share of the market scouted from abroad (players from every nation can be signed). */
            foreignShare: 0.55,
            /** A free agent costs no transfer fee, just a signing-on fee (× his value). */
            freeAgentFee: 0.3,
            /** Unsigned free agents kept around (the least valuable drift away beyond this). */
            maxFreeAgents: 160,
        },
        /** Player value: base × (ovr/50)^ovrExp × age & growth factors. Wages are value × wageRate per matchday. */
        value: { base: 60_000, ovrExp: 4.2, wageRate: 0.0075 },
    },
    training: {
        /** Session XP: base plus a bonus for the player's rating in the two drilled attributes, × fit. */
        xp: { base: 24, attributes: 18 },
        /** XP multiplier when 0, 1 or 2 of the day's drills are in the player's class core. */
        fit: [0.6, 1, 1.4] as [number, number, number],
        /** The three attributes each class trains best. */
        core: {
            keeper: ['reflexes', 'composure', 'passing'],
            defender: ['tackling', 'reflexes', 'composure'],
            midfielder: ['passing', 'composure', 'dribbling'],
            winger: ['speed', 'pace', 'dribbling'],
            striker: ['shooting', 'composure', 'pace'],
        } as Record<ClassId, StatId[]>,
        /** Chance per session that a drill lifts its attribute by one point. */
        statChance: 0.025,
        /** Injury days healed while sitting out a squad session. */
        heal: 2,
        /** Injury chance per heavy knock taken in a match, and length range (days). */
        knockInjuryChance: 0.07,
        injuryDays: [2, 9] as [number, number],
    },
    /** Player looks: how many skin tones exist (ui/recolor.ts) and how common each hair colour is. */
    looks: {
        skinTones: 9,
        /** black, dark brown, brown, auburn, ginger, blonde, platinum, grey, blue dye, violet dye */
        hairWeights: [16, 14, 14, 7, 5, 9, 4, 3, 1, 1],
    },
    /** Stamina: drained per cell run and per round; scaled so a full match drains the same at any length. */
    fatigue: {
        perCell: 0.32,
        perRound: 0.4,
        /** Extra drain for a burst (sprint / run / press / rush) and for a tackle or slide. */
        burst: 3,
        tackle: 1.5,
        /** Players past this age tire faster (per year). */
        ageFrom: 29,
        agePerYear: 0.04,
        /** Below `tired`: one move point fewer. Below `exhausted`: two, and reactions suffer. */
        tired: 50,
        exhausted: 25,
        exhaustedReaction: 0.08,
        /** Reference match length the drain rates are tuned for. */
        refRounds: 30,
    },
    subs: {
        max: 3,
        bench: 5,
        /** The AI starts making changes from this fraction of the match, for players below `aiBelow` stamina. */
        aiFrom: 0.5,
        aiBelow: 52,
    },
    /** Dead balls: corners and free kicks in the final third get a placement setup. */
    setPieces: {
        /** Placements each side may make during the setup (alternating, attackers first). */
        placements: 3,
        /** Attackers sent into the box by default. */
        runners: 4,
        /** A free kick at least this far forward (0..1 towards goal) becomes a set piece. */
        freeKickForward: 0.62,
        wallSize: 3,
        wallDistance: 3,
        /** Cells around the box where players may be placed. */
        zoneMargin: 2,
        /** Chance the ball goes out for a corner after a parry / a blocked shot / a headed clearance. */
        parryCorner: 0.55,
        blockCorner: 0.5,
        clearCorner: 0.35,
        /** A wide shot took a deflection on the way. */
        wideCorner: 0.5,
        /** A pass or cross out over the byline with a defender within 2 cells of where it went out. */
        bylineCorner: 0.7,
        /** Header duels: defenders goal-side get this head start (cells); composure counts a little. */
        defenderEdge: 0.25,
        composureWeight: 0.006,
    },
    /** Referees: how often missed or reckless challenges are fouls, how freely cards come out. */
    referee: {
        styles: {
            lenient: {
                label: '관대함',
                note: '경기를 흐르게 둡니다. 어드밴티지를 적용하고 카드를 아낍니다.',
                foulOnMiss: 0.16,
                foulOnWin: 0.04,
                slideMult: 1.8,
                card: 0.2,
                red: 0.02,
                advantage: 0.85,
            },
            fair: {
                label: '공정',
                note: '규정대로, 더도 덜도 아니게.',
                foulOnMiss: 0.28,
                foulOnWin: 0.07,
                slideMult: 1.8,
                card: 0.35,
                red: 0.04,
                advantage: 0.6,
            },
            strict: {
                label: '카드 남발',
                note: '모든 것에 휘슬을 붑니다. 태클 조심.',
                foulOnMiss: 0.38,
                foulOnWin: 0.1,
                slideMult: 1.6,
                card: 0.55,
                red: 0.08,
                advantage: 0.25,
            },
        } as Record<
            'lenient' | 'fair' | 'strict',
            {
                label: string;
                note: string;
                foulOnMiss: number;
                foulOnWin: number;
                slideMult: number;
                card: number;
                red: number;
                advantage: number;
            }
        >,
        /** Relative frequency of each style among the referee pool. */
        weights: { lenient: 1, fair: 2, strict: 1 },
        names: [
            'Aldous Penhallow',
            'Brigid Thorne',
            'Cedric Vane',
            'Dorcas Mallory',
            'Edwin Ashgrove',
            'Fenna Crook',
            'Godfrey Lusk',
            'Hester Wren',
            'Ivo Blackmere',
            'Jessamy Rook',
            'Kit Harrowgate',
            'Linnet Shaw',
            'Mortimer Quayle',
            'Nell Fairweather',
            'Osric Dunmore',
            'Prudence Hale',
        ],
    },
    /** Matchday weather nudges the ball: kicks scatter a little more in rain and snow. */
    weather: {
        scatterMult: { clear: 1, rain: 1.12, snow: 1.18, fog: 1.05 } as Record<string, number>,
    },
    cards: {
        /** Second yellow = red; a sent-off player leaves the pitch for the rest of the match. */
        yellowsForRed: 2,
        penaltyScatterMult: 0.55,
        penaltySaveMod: -0.25,
        freeKickScatterMult: 0.85,
    },
    /** Kit sprite folders (under public/assets/cast). `_1`/`_2` are two looks per kit. */
    kits: {
        outfield: ['blue', 'yellow', 'white', 'hoops', 'sky', 'stripes', 'orange', 'red'],
        keepers: ['keeper_pink', 'keeper_black', 'keeper_lime', 'keeper_orange'],
        /** Kits too alike to share a pitch (besides identical ones). */
        clashes: [
            ['blue', 'sky'],
            ['orange', 'red'],
            ['yellow', 'orange'],
        ] as Array<[string, string]>,
    },
    /** Frames per animation strip (measured from the art). */
    animFrames: {
        idle: 12,
        walk: 8,
        run: 8,
        dribble: 8,
        kick: 8,
        pass: 6,
        header: 8,
        trap: 6,
        slide_tackle: 10,
        fall: 8,
        get_up: 8,
        celebrate: 12,
        sad: 12,
        tired: 12,
        clap: 12,
        juggle: 12,
        shout: 12,
        frustrated: 12,
        gk_ready: 12,
        gk_hold: 12,
        gk_catch: 6,
        gk_punch: 6,
        gk_punt: 8,
        gk_throw: 8,
        gk_dive: 10,
    } as Record<string, number>,
};

export type GameConfig = typeof defaultConfig;

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K] };

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const withOverrides = (overrides: DeepPartial<GameConfig>, base: GameConfig = defaultConfig): GameConfig => {
    const merge = (a: unknown, b: unknown): unknown => {
        if (!isPlainObject(a) || !isPlainObject(b)) return b === undefined ? a : b;
        const out: Record<string, unknown> = { ...a };
        for (const [k, v] of Object.entries(b)) out[k] = merge(a[k], v);
        return out;
    };
    return merge(base, overrides) as GameConfig;
};

import { Dialog } from './Dialog';
/** Full-time report: score, goal timeline, team stat bars, Man of the Match, player ratings. */
import { derived } from '@grainular/grains';
import { $each, html, mounted, on } from '@grainular/nord';
import type { MatchController } from './controller';
import { isLightKit, kitColor } from './kits';
import { spriteStyle } from './sprites';
import type { Piece, TeamSide } from '../types';

const ratingClass = (r: number) => (r >= 8 ? 'r-great' : r >= 7 ? 'r-good' : r >= 6 ? 'r-ok' : 'r-poor');

export const MatchReport = (ctl: MatchController, onContinue: () => void, continueLabel = '계속', verdictOverride?: string) => {
    const m = ctl.match;
    const s = ctl.stats;
    const clubs = m.state.clubs;
    const [a, b] = m.state.score;
    const name = (id: string) => m.piece(id).player.name;
    const motm = s.motm();
    const t = [s.team(0), s.team(1)] as const;
    const winner: TeamSide | null = a > b ? 0 : b > a ? 1 : null;
    const human: TeamSide | null = ctl.isHuman(0) && !ctl.isHuman(1) ? 0 : ctl.isHuman(1) && !ctl.isHuman(0) ? 1 : null;
    const verdict =
        human === null
            ? winner === null
                ? '무승부입니다.'
                : `${clubs[winner].name} 승리.`
            : winner === human
              ? '승리!'
              : winner === null
                ? '힘겹게 얻은 무승부.'
                : '패배.';

    const bar = (label: string, x: number, y: number, fmt = (v: number) => String(v)) => {
        const total = Math.max(1, x + y);
        return html`<div class="rbar"><b>${fmt(x)}</b><div class="rbar-track"><i class="l" style="width:${String((x / total) * 100)}%;--kit:${kitColor(clubs[0].kit)}"></i><i class="r" style="width:${String((y / total) * 100)}%;--kit:${kitColor(clubs[1].kit)}"></i></div><b>${fmt(y)}</b><span>${label}</span></div>`;
    };

    const ratings = (team: TeamSide) => {
        const all = m
            .everyone()
            .filter((p) => p.team === team)
            .sort((x, y) => s.rating(y) - s.rating(x));
        return html`<ul class="ratings">${all.map((p: Piece) => {
            const l = s.players.get(p.id);
            const notes = [
                l?.goals ? `${l.goals}G` : '',
                l?.assists ? `${l.assists}A` : '',
                l?.saves ? `${l.saves} SV` : '',
                l?.tacklesWon ? `${l.tacklesWon} TK` : '',
            ]
                .filter(Boolean)
                .join(' ');
            const card = l?.red ? html`<i class="cardchip red"></i>` : l?.yellows ? html`<i class="cardchip yellow"></i>` : html``;
            return html`<li><span class="rnum">${String(p.player.number)}</span><span class="rname">${p.player.name}${card}</span><span class="rnotes">${notes}</span><b class="rating ${ratingClass(s.rating(p))}">${s.rating(p).toFixed(1)}</b></li>`;
        })}</ul>`;
    };

    return Dialog({
        label: '경기 리포트',
        className: 'modal report-modal',
        children: html`<div class="modal-body report">
            <div class="modal-scroll">
                <div class="report-head">
                    <div class="rteam ${isLightKit(clubs[0].kit) ? 'light' : ''}" style="--kit:${kitColor(clubs[0].kit)}">${clubs[0].name}</div>
                    <div class="rscore">${String(a)}<span>–</span>${String(b)}</div>
                    <div class="rteam ${isLightKit(clubs[1].kit) ? 'light' : ''}" style="--kit:${kitColor(clubs[1].kit)}">${clubs[1].name}</div>
                </div>
                <h2 class="verdict">${verdictOverride ?? verdict}</h2>
                <p class="ref-line">심판 ${m.state.referee.name} · ${m.cfg.referee.styles[m.state.referee.style].label} · ${String([...s.players.values()].reduce((n, l) => n + l.fouls, 0))}회 파울</p>
                <div class="report-grid">
                    <section>
                        <h4>득점</h4>
                        ${s.goals.length ? html`<ul class="goals">${s.goals.map((g) => html`<li class="t${String(g.team)}"><b>${String(g.minute)}'</b> ${name(g.scorer)}${g.how === 'penalty' ? ' (PK)' : g.how === 'header' ? ' (헤딩)' : ''}${g.assist ? html`<em> · 도움 ${name(g.assist)}</em>` : html``}</li>`)}</ul>` : html`<p class="muted">무득점. 수비가 승리한 날입니다.</p>`}
                        <h4>경기 기록</h4>
                        <div class="rbars">
                            ${bar('점유율', t[0].possession, t[1].possession, (v) => `${v}%`)}
                            ${bar('슈팅', t[0].shots, t[1].shots)}
                            ${bar('유효 슈팅', t[0].onTarget, t[1].onTarget)}
                            ${bar('패스 성공', t[0].passesOk, t[1].passesOk)}
                            ${bar('태클 성공', t[0].tacklesWon, t[1].tacklesWon)}
                            ${bar('선방', t[0].saves, t[1].saves)}
                        </div>
                    </section>
                    <section class="motm">
                        <h4>MOM (맨 오브 더 매치)</h4>
                        ${
                            motm
                                ? html`<div class="motm-card">
                            <div class="podium"><div class="sprite" style="${spriteStyle(ctl.cfg, motm.player.sprite, 'celebrate', 'down', motm.player)};width:128px;height:128px;background-size:${String((ctl.cfg.animFrames.celebrate ?? 12) * 128)}px 128px;--strip:${String((ctl.cfg.animFrames.celebrate ?? 12) * 128)}px"></div></div>
                            <b>${motm.player.name}</b><span>${clubs[motm.team].name}</span><em class="rating r-great">${s.rating(motm).toFixed(1)}</em>
                        </div>`
                                : html``
                        }
                    </section>
                    <section><h4>${clubs[0].short} 평점</h4>${ratings(0)}</section>
                    <section><h4>${clubs[1].short} 평점</h4>${ratings(1)}</section>
                </div>
            </div>
            <footer><button class="primary" ${on('click', onContinue)}>${continueLabel} →</button></footer>
        </div>`,
    });
};

/**
 * Half time: the score, the goals so far, first-half stats, your tiredest players, and the way to
 * the bench. Play is stopped, so changes made here go through at once.
 */
export const HalftimeReport = (ctl: MatchController, actions: { onContinue: () => void; onBench: () => void }) => {
    const m = ctl.match;
    const s = ctl.stats;
    const clubs = m.state.clubs;
    const [a, b] = m.state.score;
    const name = (id: string) => m.piece(id).player.name;
    const t = [s.team(0), s.team(1)] as const;
    const human: TeamSide = ctl.isHuman(1) && !ctl.isHuman(0) ? 1 : 0;
    const bar = (label: string, x: number, y: number, fmt = (v: number) => String(v)) => {
        const total = Math.max(1, x + y);
        return html`<div class="rbar"><b>${fmt(x)}</b><div class="rbar-track"><i class="l" style="width:${String((x / total) * 100)}%;--kit:${kitColor(clubs[0].kit)}"></i><i class="r" style="width:${String((y / total) * 100)}%;--kit:${kitColor(clubs[1].kit)}"></i></div><b>${fmt(y)}</b><span>${label}</span></div>`;
    };
    // tick-driven so changes made from the bench show up here
    const tired = derived(ctl.tick, () =>
        m.state.pieces
            .filter((p) => p.team === human)
            .sort((x, y) => x.stamina - y.stamina)
            .slice(0, 3),
    );
    const subsLeft = derived(ctl.tick, () => m.subsLeft(human));
    const cfg = ctl.cfg;
    const keys = mounted<HTMLDivElement>((el) => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'b' || e.key === 'B') {
                e.preventDefault();
                actions.onBench();
            }
        };
        el.addEventListener('keydown', onKey);
        return () => el.removeEventListener('keydown', onKey);
    });
    return Dialog({
        label: '전반 종료',
        className: 'modal report-modal halftime-modal',
        children: html`<div class="modal-body report halftime" ${keys}>
            <div class="modal-scroll">
                <p class="ht-kicker">전반 종료</p>
                <div class="report-head">
                    <div class="rteam ${isLightKit(clubs[0].kit) ? 'light' : ''}" style="--kit:${kitColor(clubs[0].kit)}">${clubs[0].name}</div>
                    <div class="rscore">${String(a)}<span>–</span>${String(b)}</div>
                    <div class="rteam ${isLightKit(clubs[1].kit) ? 'light' : ''}" style="--kit:${kitColor(clubs[1].kit)}">${clubs[1].name}</div>
                </div>
                <div class="report-grid ht-grid">
                    <section>
                        <h4>득점</h4>
                        ${s.goals.length ? html`<ul class="goals">${s.goals.map((g) => html`<li class="t${String(g.team)}"><b>${String(g.minute)}'</b> ${name(g.scorer)}${g.how === 'penalty' ? ' (PK)' : g.how === 'header' ? ' (헤딩)' : ''}${g.assist ? html`<em> · 도움 ${name(g.assist)}</em>` : html``}</li>`)}</ul>` : html`<p class="muted">Still goalless.</p>`}
                        <h4>전반 기록</h4>
                        <div class="rbars">
                            ${bar('점유율', t[0].possession, t[1].possession, (v) => `${v}%`)}
                            ${bar('슈팅', t[0].shots, t[1].shots)}
                            ${bar('유효 슈팅', t[0].onTarget, t[1].onTarget)}
                            ${bar('패스 성공', t[0].passesOk, t[1].passesOk)}
                            ${bar('태클 성공', t[0].tacklesWon, t[1].tacklesWon)}
                        </div>
                    </section>
                    <section class="ht-legs">
                        <h4>지친 다리 <small>${clubs[human].short} · ${derived(subsLeft, (n) => `교체 ${n}회 남음`)}</small></h4>
                        <ul class="ht-tired">${$each(tired)
                            .$withKey((p: Piece) => p.id)
                            .$as((p: Piece) => {
                                const st = Math.round(p.stamina);
                                const cls = st < cfg.fatigue.exhausted ? 'low' : st < cfg.fatigue.tired ? 'mid' : '';
                                return html`<li><span class="rnum">${String(p.player.number)}</span><span class="rname">${p.player.name}</span><span class="stam-bar ${cls}"><i style="width:${String(st)}%"></i></span><b>${String(st)}</b></li>`;
                            })}</ul>
                        <p class="muted">${String(cfg.fatigue.tired)} 미만이면 이동이 줄고, ${String(cfg.fatigue.exhausted)} 미만이면 반응이 나빠집니다. 지금 교체하면 킥오프 전에 적용됩니다.</p>
                        <button class="ghost" ${on('click', actions.onBench)}>벤치 및 교체 <kbd>B</kbd></button>
                    </section>
                </div>
            </div>
            <footer><button class="primary" autofocus ${on('click', actions.onContinue)}>후반 시작 <kbd>Enter</kbd></button></footer>
        </div>`,
    });
};

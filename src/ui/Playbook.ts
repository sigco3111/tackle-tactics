/** Reference of every class kit: abilities and passives by perk tier (pick one per tier). Used in-match and in the hub. */
import { html } from '@grainular/nord';
import type { ClassId, GameConfig } from '../config';
import { abilitiesOf, abilityDef, allAbilities, classLevel, passivesOf, type PassiveId } from '../engine/abilities';
import type { Player } from '../types';

const PHASE_LABEL = { pre: '이동 전', move: '일반 이동 대신', act: '이동 후' } as const;
const CLASS_BLURB: Record<ClassId, string> = {
    keeper: '최후방. 슛을 반응으로 막아내고 수비를 조직합니다.',
    defender: '공격을 끊습니다: 먼 거리에서 태클하고, 주자를 따라붙고, 필요하면 파울도 합니다.',
    midfielder: '템포를 지배합니다: 압박하고, 공간으로 패스를 찔러 넣고, 다음에 누가 행동할지 정합니다.',
    winger: '스피드와 속임수: 측면을 돌파하고, 수비수를 제치고, 크로스를 올립니다.',
    striker: '마무리 담당: 뒷공간으로 침투해 알맞은 슛을 고릅니다.',
};

/** Optional `player` highlights what they own and how far they are from the next unlock. */
export const Playbook = (cfg: GameConfig, player?: Player) => {
    const classes = Object.keys(cfg.classes) as ClassId[];
    return html`<div class="playbook">
        ${classes.map((cls) => {
            const lvl = player ? classLevel(player, cls) : undefined;
            const owned = new Set<string>(player ? [...abilitiesOf(cfg, player), ...passivesOf(cfg, player)] : []);
            /** have it / reached the tier but picked the other option / not there yet */
            const state = (id: string, unlock: number) =>
                lvl === undefined ? '' : owned.has(id) ? 'have' : lvl >= unlock ? 'gone' : 'locked';
            const tierSize = (unlock: number) => (cfg.perkTiers[cls] ?? []).find((t) => t.level === unlock)?.options.length ?? 1;
            const abilities = allAbilities(cfg)
                .filter((id) => abilityDef(cfg, id).cls === cls)
                .sort((a, b) => abilityDef(cfg, a).unlock - abilityDef(cfg, b).unlock);
            const passives = (Object.keys(cfg.passives) as PassiveId[]).filter((id) => cfg.passives[id].cls === cls);
            const rows = [
                ...abilities.map((id) => ({
                    unlock: abilityDef(cfg, id).unlock,
                    row: () => {
                        const a = abilityDef(cfg, id);
                        return html`<li class="${state(id, a.unlock)} ${tierSize(a.unlock) > 1 ? 'pick' : ''}">
                        <span class="lv">${String(a.unlock)}</span><span class="ic">${a.icon}</span>
                        <div><b>${a.label}</b> <em>${PHASE_LABEL[a.phase]}${a.cooldown ? ` · 쿨다운 ${a.cooldown}라운드` : ''}</em><p>${a.desc}</p><p class="how">${a.how}</p></div>
                    </li>`;
                    },
                })),
                ...passives.map((id) => ({
                    unlock: cfg.passives[id].unlock,
                    row: () => {
                        const d = cfg.passives[id];
                        return html`<li class="passive ${state(id, d.unlock)} ${tierSize(d.unlock) > 1 ? 'pick' : ''}">
                        <span class="lv">${String(d.unlock)}</span><span class="ic">◆</span>
                        <div><b>${d.label}</b> <em>패시브 · ${'innate' in d && d.innate ? `모든 ${cfg.classes[cls].label}` : '상시 적용'}</em><p>${d.desc}</p></div>
                    </li>`;
                    },
                })),
            ].sort((a, b) => a.unlock - b.unlock);
            return html`<section class="pb-class ${lvl ? 'mine' : ''}">
                <h3>${cfg.classes[cls].label} <small>${cfg.classes[cls].short}${lvl ? ` · 레벨 ${lvl}` : ''}</small></h3>
                <p class="blurb">${CLASS_BLURB[cls]}</p>
                <ul>${rows.map((r) => r.row())}</ul>
            </section>`;
        })}
        <p class="pb-foot">왼쪽 숫자는 선택지가 있는 클래스 레벨입니다. 각 레벨마다 "또는"으로 표시된 항목 중 하나를 고르면 나머지는 영영 사라집니다. 레벨업을 어느 클래스에 올릴지는 직접 정하며, 멀티클래스 선수는 레벨이 있는 각 클래스에서 선택합니다.</p>
    </div>`;
};

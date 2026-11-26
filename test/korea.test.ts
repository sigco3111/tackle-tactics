import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { careerRng, endSeason, newCareer, playMatchday, resolveLetter, seasonDays, seasonSchedule, simulateScore, today, trainingDay, userClub, type Career } from '../src/meta/career';
import { story } from '../src/meta/story';
import { NATION_IDS, NATIONS } from '../src/world/nations';
import { createRng } from '../src/rng';

const cfg = defaultConfig;
const settings = { timerSeconds: 10, rounds: 30, difficulty: 'normal' as const, timeoutPolicy: 'lose' as const };

const playSeason = (c: Career) => {
    for (let guard = 0; guard < 300; guard++) {
        const t = today(cfg, c);
        if (t.kind === 'seasonEnd') return endSeason(cfg, c);
        if (story(c).inbox) resolveLetter(cfg, c, 0);
        if (t.kind === 'match') {
            const rng = careerRng(c);
            const score = simulateScore(cfg, rng, c, t.fixture);
            c.rngState = rng.state();
            playMatchday(cfg, c, { score, knocks: {}, played: userClub(c).lineup });
        } else trainingDay(cfg, c);
    }
    throw new Error('season did not end');
};

describe('korea', () => {
    it('has 17 nations, 5 Korean league tiers and Hangul-only names', () => {
        expect(NATION_IDS).toHaveLength(17);
        const rng = createRng(5);
        const n = NATIONS.korea;
        const towns = n.places(rng);
        expect(towns.length).toBeGreaterThanOrEqual(50);
        expect(new Set(towns).size).toBe(towns.length);
        for (const id of NATION_IDS) {
            const nat = NATIONS[id];
            const r = createRng(11);
            const text = [nat.name, nat.adjective, ...Array.from({ length: 100 }, () => nat.playerName(r)), ...nat.places(r).map((p) => nat.clubName(r, p))].join(' ');
            // Hangul, digits, spaces and the Latin club abbreviations (FC, SC, VfR ...)
            expect(text.replace(/\b(FC|SC|SK|IK|IL|BK|IF|FK|SV|TSV|VfR|AS|US|CD|SE|TE|AC|PS|JK)\b/g, '')).toMatch(/^[\s0-9\-\uac00-\ud7a3]*$/);
        }
    });

    it('never produces the name of a real Korean club', () => {
        const real = ['전북 현대', '울산 HD', '울산 현대', '포항 스틸러스', '수원 삼성', '수원 FC', '인천 유나이티드', '제주 유나이티드', '제주 SK', '강원 FC', '대구 FC', '대전 하나 시티즌',
            '광주 FC', 'FC 서울', '김천 상무', '부천 FC', '성남 FC', '안양 FC', 'FC 안양', '안산 그리너스', '충남아산', '천안 시티', '경남 FC', '부산 아이파크', '전남 드래곤즈', '김포 FC',
            '서울 이랜드', '화성 FC', '충북청주', '성남 일화', '부산 대우', '전북 현대 모터스'];
        const n = NATIONS.korea;
        const rng = createRng(9);
        const names = n.places(rng).flatMap((p) => Array.from({ length: 20 }, () => n.clubName(rng, p)));
        for (const name of names) for (const r of real) expect(name).not.toBe(r);
        expect(new Set(names.map((x) => x.split(' ').at(-1))).size).toBeGreaterThan(3);
    });

    it('a Korean career runs two full seasons; the 34-club international cup finishes', () => {
        const c = newCareer(cfg, 31, settings, { nation: 'korea' });
        expect(c.nation).toBe('korea');
        expect(userClub(c).name).toMatch(/[가-힣]/);
        const first = c.intl!.rounds[0]!;
        const clubsInFirst = new Set([...first.byes, ...first.fixtures.flatMap((f) => [f.home, f.away])]);
        expect(clubsInFirst.size).toBe(34);
        expect(first.label).toBe('예선 라운드');
        const days = seasonDays(cfg, c);
        expect(days).toBe((18 + 6 + 6) * cfg.career.daysPerMatchday);
        expect(seasonSchedule(cfg, c).filter((d) => d.cup)).toHaveLength(c.cup!.rounds.length + c.intl!.rounds.length);
        playSeason(c);
        expect(c.season).toBe(2);
        playSeason(c);
        expect(c.season).toBe(3);
        for (const d of c.divisions) expect(d.clubs).toHaveLength(10);
    }, 120_000);
});

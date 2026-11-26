/**
 * The pre-match overview copy: the commentators open the broadcast and talk through the story of the day.
 * Pure text built from the match setup; MatchView renders it beside the squads on a pitch.
 */
import type { GameConfig, TeamStyle } from '../config';
import type { Match } from '../engine/match';
import type { TeamSide } from '../types';
import { sizeLabel, type Conditions, type Stadium } from '../world/stadium';

export const COMMENTATORS = {
    lead: { name: 'Barnaby Quill', role: '중계' },
    colour: { name: 'Ottilie Marsh', role: '해설 · 전 골키퍼, A매치 2회, 유명한 부러진 손가락 한 개' },
};

const pick = <T>(arr: T[], seed: number) => arr[Math.abs(seed) % arr.length]!;

export type Voice = keyof typeof COMMENTATORS;
/** The opening exchange, as alternating lines from the two commentators. */
export type IntroLine = { who: Voice; text: string };

/** The commentators' opening exchange, with the day's narrative rolled in (career lines come from the caller). */
export const introText = (
    cfg: GameConfig,
    m: Match,
    styles: [TeamStyle, TeamStyle],
    stadium: Stadium | undefined,
    conditions: Conditions | undefined,
    seed: number,
    careerStory: string[] = [],
): IntroLine[] => {
    const [h, a] = m.state.clubs;
    const ground = stadium ? `${stadium.name}, ${sizeLabel(stadium.size)}` : '중립 구장';
    const crowd = stadium ? `${Math.round(stadium.capacity * stadium.fill).toLocaleString('en')}명 입장` : '소수의 열성 팬';
    const welcome = pick(
        [
            `${ground}에서 인사드립니다. ${crowd}. ${h.name} 대 ${a.name}. 저는 ${COMMENTATORS.lead.name}, 옆에는 ${COMMENTATORS.colour.name}입니다.`,
            `${ground}에 오신 것을 환영합니다. ${h.name}이(가) ${a.name}을(를) 홈으로 맞이하고, ${crowd}. ${COMMENTATORS.lead.name}, 그리고 ${COMMENTATORS.colour.name}과 함께합니다.`,
            `${ground}, ${h.name} 대 ${a.name}. ${crowd}. ${COMMENTATORS.lead.name}이(가) 함께하고, 옆에는 늘 그렇듯 장갑을 낀 ${COMMENTATORS.colour.name}이(가) 있습니다.`,
        ],
        seed,
    );
    const weather = conditions
        ? {
              clear: '아름다운 날씨입니다. 오늘은 변명이 통하지 않습니다.',
              rain: '바깥은 젖어 있습니다. 롱패스는 미끄러지고 골키퍼들은 싫어할 겁니다.',
              snow: '눈입니다! 공이 이상하게 움직일 겁니다. 우는 골키퍼도 본 적 있습니다.',
              fog: '안개가 밀려옵니다. 슛은 보기 전에 소리로 먼저 들을 겁니다.',
          }[conditions.weather]
        : '';
    const colour = `${weather} ${pick(
        [
            `오늘의 심판은 ${m.state.referee.name}. ${cfg.referee.styles[m.state.referee.style].note}`,
            `${m.state.referee.name} 심판이 휘슬을 쥡니다. ${cfg.referee.styles[m.state.referee.style].note}`,
        ],
        seed + 1,
    )}`.trim();
    const [sh, sa] = styles.map((s) => cfg.ai.styles[s].label);
    const clash: Record<string, string> = {
        '하이 프레스:점유': '압박 대 인내심 있는 패서들. 누군가는 무너질 겁니다.',
        '점유:하이 프레스': '하이 프레스에 맞서는 인내의 패스 플레이. 침착함이 전부입니다.',
        '로우 블록:직선적': '롱볼에 맞서는 벽. 헤딩이 많이 나올 겁니다.',
        '직선적:로우 블록': '빽빽한 박스 안으로 들어가는 롱볼. 덩치 큰 선수들이 밥값을 할 겁니다.',
    };
    const story = careerStory.length
        ? careerStory
        : [
              clash[`${sh}:${sa}`] ??
                  (sh === sa
                      ? `양 팀 모두 ${sh} 스타일입니다. 거울 대결, 먼저 눈 깜빡이는 쪽이 집니다.`
                      : `${h.name}은(는) ${sh}, ${a.name}은(는) ${sa}. 어느 한쪽은 무너져야 합니다.`),
              conditions && conditions.time !== 'day'
                  ? conditions.time === 'night'
                      ? '오늘 밤은 조명 아래에서 치러집니다.'
                      : '벌써 빛이 사위어 갑니다.'
                  : '',
              pick(
                  [
                      `${cfg.match.rounds}라운드. 하나하나가 소중합니다.`,
                      '오늘의 화폐는 공간입니다. 현명하게 쓰세요.',
                      '공간을 만들고, 공간을 막고, 시계를 이기세요.',
                  ],
                  seed + 2,
              ),
          ].filter(Boolean);
    // the lead opens, the co-commentator answers with conditions and referee, then they trade the story lines
    return [
        { who: 'lead', text: welcome },
        { who: 'colour', text: colour },
        ...story.map((text, i): IntroLine => ({ who: i % 2 ? 'colour' : 'lead', text })),
    ];
};

/** The danger man: the best finisher on the pitch for a side. */
export const dangerMan = (m: Match, team: TeamSide) =>
    m.state.pieces
        .filter((p) => p.team === team && p.player.cls !== 'keeper')
        .toSorted((x, y) => y.player.stats.shooting + y.player.level - (x.player.stats.shooting + x.player.level))[0];

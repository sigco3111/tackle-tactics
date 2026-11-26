/**
 * Coach Marlow's one-time tips: contextual onboarding that appears the first time a situation
 * comes up, pauses the clock while it's on screen, and never nags twice.
 */
export type TipCtx = {
    phase: 'move' | 'act' | 'done';
    isCarrier: boolean;
    canTackle: boolean;
    hasUsableAbility: boolean;
    humanTurns: number;
    reactionHitUs: boolean;
    name: string;
};
export type Tip = { id: string; title: string; text: string; when: (c: TipCtx) => boolean };

export const TIPS: Tip[] = [
    {
        id: 'welcome',
        title: '선수마다 한 번씩 움직입니다',
        text: '잘 들어. 매 라운드 모든 선수가 한 번씩, 빠른 선수부터 두 팀이 번갈아 움직인다. 지금 {name} 선수를 지휘하고 있어. 파란 칸이 갈 수 있는 곳이야. 하나를 클릭하거나 스페이스를 눌러 제자리에 있어. 선수를 공간으로 보내는 것, 그게 이 게임의 전부야.',
        when: (c) => c.phase === 'move' && !c.isCarrier,
    },
    {
        id: 'carrier',
        title: '발밑에 공이 있다',
        text: '좋아, 이제 얘기가 되네. 분홍 칸은 반응 행동이 남은 수비수 옆이야. 그리로 드리블하면 상대가 태클을 시도해. 패스를 하고 싶다면? 스페이스로 제자리에 있으면 공을 찰 수 있어.',
        when: (c) => c.phase === 'move' && c.isCarrier,
    },
    {
        id: 'kick',
        title: '겨냥하고, 기도하라',
        text: '어디든 가리켜 봐. 주황 영역이 공이 떨어질 수 있는 곳이야. 멀리 찰수록 더 흔들려. 롱볼은 공중으로 뜨고, 처음과 끝에서만 끊을 수 있어. 골문을 겨냥하면 슛이야.',
        when: (c) => c.phase === 'act' && c.isCarrier,
    },
    {
        id: 'abilities',
        title: '비장의 기술',
        text: '하단 독에 있는 카드 보이지? 그게 능력이야. 마우스를 올리면 경기장에 효과가 표시되고, 클릭하면 사용해. 클래스마다 고유한 능력 구성이 있고, 훈련으로 레벨이 오르면 열려.',
        when: (c) => c.hasUsableAbility,
    },
    {
        id: 'defend',
        title: '공을 되찾아라',
        text: '상대 공 소유자 바로 옆이야. T 키(또는 상대 클릭)로 태클해. 성공하면 공은 우리 거야. 실패하면 다음 턴까지 균형을 잃으니 타이밍을 잘 골라.',
        when: (c) => c.phase === 'act' && c.canTackle,
    },
    {
        id: 'reaction',
        title: '방금 건 반응 행동이야',
        text: '선수는 라운드마다 반응 행동을 한 번 갖는다. 공이 가까이 오면 태클이나 인터셉트를 하는 거야. 반응을 쓴 선수는 희미한 링이 표시돼. 그쪽을 공략해, 못 막으니까.',
        when: (c) => c.reactionHitUs,
    },
    {
        id: 'focus',
        title: '어디에나 있을 순 없어',
        text: '선수 몇 명이 알아서 움직이는 거 보여? 집중 모드야. 공에서 먼 선수는 신경 쓰지 않아도 대형을 유지해. F 키로 모든 선수, 공 근처, 핵심 대결만 보기를 전환해.',
        when: (c) => c.humanTurns >= 9,
    },
];

export const fillTip = (t: Tip, c: TipCtx) => t.text.replace('{name}', c.name);

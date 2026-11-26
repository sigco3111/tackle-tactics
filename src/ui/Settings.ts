/** Settings modal: display (scale, font, motion), pacing, match defaults, the current career, data. */
import { combined, derived, grain, type Grain } from '@grainular/grains';
import { COIN } from '../meta/player';
import type { Confirm } from './confirm';
import { fullscreen, isDesktop, openExternal, setFullscreen } from './desktop';
import { $if, $render, $switch, attr, html, on } from '@grainular/nord';
import { controlValue, distinct } from './value';
import { Dialog } from './Dialog';
import type { Difficulty, TimeoutPolicy } from '../config';
import type { CareerSettings } from '../meta/career';
import { saveLocation, whenSaved } from '../meta/storage';
import { careerBackup, restoreCareer } from '../meta/career';
import { allTracks, nowPlaying, radio, STATION, trackKey } from './radio';
import { addSongs, musicFolder, myTracks, openMusicFolder, removeSong, rescan, SONG_EXTS } from './myMusic';
import { audio } from './audio';
import { CONTROL_MODES, FONTS, prefs, setPref, UI_SCALES, type AiSpeed } from './prefs';

/** The match options shared by quick matches, new careers and a running career. */
export type MatchOpts = { timerSeconds: number; rounds: number; difficulty: Difficulty; timeoutPolicy: TimeoutPolicy };

export type SettingsProps = {
    onClose: () => void;
    confirm: Confirm;
    /** Defaults for quick matches and new careers. */
    defaults: { get: () => MatchOpts; set: (o: MatchOpts) => void };
    /** The running career's match options, if one is loaded. */
    career?: { name: string; settings: CareerSettings; save: () => void };
    onDeleteCareer?: () => void;
};

const seg = <T extends string | number>(value: Grain<T>, options: Array<[T, string]>, set: (v: T) => void) =>
    html`<div class="seg">${options.map(([v, label]) => {
        const active = derived(value, (current) => current === v);
        return html`<button ${attr({ class: derived(active, (selected) => (selected ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => set(v))}>${label}</button>`;
    })}</div>`;

const slider = (value: Grain<number>, min: number, max: number, step: number, unit: string, set: (v: number) => void) =>
    html`<div class="range"><input type="range" min="${String(min)}" max="${String(max)}" step="${String(step)}" value="${String(value())}" ${controlValue(value)}
        ${on('input', (e) => set(Number((e.currentTarget as HTMLInputElement).value)))} /><output>${derived(value, (v) => `${v}${unit}`)}</output></div>`;

/** One block of match options bound to a getter/setter. */
const matchOptions = (get: () => MatchOpts, set: (o: MatchOpts) => void) => {
    const options = grain(get());
    const put = <K extends keyof MatchOpts>(k: K, v: MatchOpts[K]) => {
        const next = { ...get(), [k]: v };
        set(next);
        options.set(next);
    };
    return html`<div class="set-rows">
        <div class="set-row"><span>행동 제한 시간<small>행동을 잃기 전까지의 초 단위 시간. 꺼짐 = 시간 제한 없음.</small></span>${seg(
            derived(options, (o) => o.timerSeconds),
            [
                [0, '꺼짐'],
                [8, '8s'],
                [10, '10s'],
                [15, '15s'],
                [20, '20s'],
                [30, '30s'],
                [45, '45s'],
            ] as Array<[number, string]>,
            (v) => put('timerSeconds', v),
        )}</div>
        <label class="set-row"><span>경기 길이<small>경기당 라운드 수 (라운드마다 모두 한 번씩 행동)</small></span>${slider(
            derived(options, (o) => o.rounds),
            6,
            40,
            2,
            '',
            (v) => put('rounds', v),
        )}</label>
        <div class="set-row"><span>AI 난이도</span>${seg(
            derived(options, (o) => o.difficulty),
            [
                ['easy', '쉬움'],
                ['normal', '보통'],
                ['hard', '어려움'],
            ],
            (v) => put('difficulty', v),
        )}</div>
        <div class="set-row"><span>시간 초과 시</span>${seg(
            derived(options, (o) => o.timeoutPolicy),
            [
                ['lose', '행동 상실'],
                ['auto', 'AI가 대신 수행'],
            ],
            (v) => put('timeoutPolicy', v),
        )}</div>
    </div>`;
};

/** Where your own songs come from: the folder on desktop, a file picker in the browser. */
const YourSongs = () => {
    const note = grain('');
    const count = derived(myTracks, (list) =>
        list.length ? `${String(list.length)}곡이 방송국에 등록되어 있습니다` : '아직 없음',
    );
    if (isDesktop)
        return html`<div class="set-row your-songs"><span>내 노래<small>이 폴더에 오디오 파일을 넣으면 라디오에 추가됩니다 (크레딧 표시를 위해 "가수 - 제목" 형식 권장). <code>${musicFolder}</code></small></span>
            <div class="set-reset">
                <div class="your-songs-buttons">
                    <button class="ghost" ${on('click', () => void openMusicFolder().catch((e: unknown) => note.set(String(e))))}>음악 폴더 열기</button>
                    <button class="ghost" ${on('click', async () => {
                        await rescan();
                        note.set('폴더를 다시 읽었습니다.');
                    })}>다시 검색</button>
                </div>
                <small role="status">${derived(combined([count, note]), ([n, msg]) => msg || n)}</small>
            </div></div>`;
    return html`<div class="set-row your-songs"><span>내 노래<small>컴퓨터의 오디오 파일을 추가하세요 (MP3, M4A는 어디서나 재생됩니다). 이 브라우저에만 저장됩니다.</small></span>
        <div class="set-reset">
            <label class="button ghost file-pick">노래 추가…<input type="file" multiple accept="audio/*,${SONG_EXTS.map((e) => `.${e}`).join(',')}" hidden ${on(
                'change',
                async (e) => {
                    const input = e.target as HTMLInputElement;
                    const files = [...(input.files ?? [])];
                    input.value = '';
                    if (!files.length) return;
                    note.set('추가하는 중…');
                    const skipped = await addSongs(files);
                    note.set(skipped.length ? `오디오 파일이 아님: ${skipped.join(', ')}` : '');
                },
            )} /></label>
            <small role="status">${derived(combined([count, note]), ([n, msg]) => msg || n)}</small>
        </div></div>`;
};

/** Every song on the station with an on/off switch; clicking a title plays it now. */
const SongList = () => {
    const tracks = allTracks();
    if (!tracks.length) return html`<p class="muted">아직 노래가 없습니다. 위에서 직접 추가해 보세요.</p>`;
    const disabled = derived(prefs, (p) => p.radioDisabled);
    const onCount = derived(disabled, (off) => String(tracks.filter((t) => !off.includes(trackKey(t))).length));
    return html`<div class="songs">
        <div class="songs-head"><span>노래 <small>${String(tracks.length)}곡 중 ${onCount}곡 켜짐 · 제목을 누르면 재생</small></span>
            <button class="ghost" ${on('click', () => setPref('radioDisabled', []))}>모두 켜기</button></div>
        <ul>${tracks.map((t) => {
            const k = trackKey(t);
            const enabled = derived(disabled, (off) => !off.includes(k));
            const now = derived(nowPlaying, (playing) => !!playing && trackKey(playing) === k);
            const cls = derived(combined([enabled, now]), ([isEnabled, playing]) => `${isEnabled ? '' : 'off'} ${playing ? 'now' : ''}`);
            const toggle = (value: 'on' | 'off') => {
                if ((value === 'on') === enabled()) return;
                const off = disabled();
                setPref('radioDisabled', value === 'on' ? off.filter((key) => key !== k) : [...off, k]);
                radio.checkCurrent();
            };
            return html`<li ${attr({ class: cls })}>
                <button class="song-play" title="지금 재생" ${on('click', () => radio.playNow(t))}><i>${derived(now, (playing) => (playing ? '♫' : '▶'))}</i><b>${t.title}</b><span>${t.artist ?? (t.mine ? '내 노래' : STATION)}</span></button>
                ${t.mine && !isDesktop ? html`<button class="ghost song-remove" title="이 브라우저에서 삭제" ${on('click', () => void removeSong(t))}>삭제</button>` : html``}
                ${seg(
                    derived(enabled, (value) => (value ? 'on' : 'off')),
                    [
                        ['on', '켜짐'],
                        ['off', '꺼짐'],
                    ],
                    toggle,
                )}
            </li>`;
        })}</ul>
    </div>`;
};

export const SettingsModal = (props: SettingsProps) => {
    const savePath = grain('…');
    void saveLocation()
        .then((p) => savePath.set(p))
        .catch(() => savePath.set('알 수 없음'));
    const TAB_KO: Record<string, string> = { display: '화면', sound: '사운드', gameplay: '게임플레이', career: '커리어', about: '정보' };
    type Tab = 'display' | 'sound' | 'gameplay' | 'career' | 'about';
    const tab = grain<Tab>('display');
    const pref = <K extends keyof ReturnType<typeof prefs>>(key: K) => distinct(derived(prefs, (p) => p[key]));
    /** How many coach tips have been seen (match and hub), and the confirmation after a reset. */
    const seenTips = derived(pref('tipsSeen'), (seen) => seen.length);
    const tipsReset = grain('');
    const toggle = (key: 'autoZoom' | 'reduceMotion' | 'muted' | 'radioOn' | 'matchIntro' | 'tips') =>
        derived(pref(key), (value) => (value ? 'on' : 'off'));
    const Display = () => {
        return html`<div class="set-rows">
                <div class="set-row"><span>UI 크기<small>UI가 커지면 주변이 덜 보입니다. 즉시 적용됩니다.</small></span>
                    ${seg(
                        pref('uiScale'),
                        UI_SCALES.map((s) => [s, `${Math.round(s * 100)}%`] as [number, string]),
                        (v) => setPref('uiScale', v),
                    )}</div>
                <div class="set-row"><span>크기 조절 방식<small>선명은 화면의 전체 해상도로 게임을 그립니다(큰 화면에 적합). 부드럽게는 완성된 한 장의 화면을 늘립니다. 자동은 Linux에서 선명을 고릅니다.</small></span>
                    ${seg(
                        pref('scaling'),
                        [
                            ['auto', '자동'],
                            ['sharp', '선명'],
                            ['smooth', '부드럽게'],
                        ],
                        (v) => setPref('scaling', v),
                    )}</div>
                <div class="set-row"><span>전체 화면<small>F11 또는 ${isDesktop && navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}+Enter로 어디서든 전환합니다.</small></span>
                    ${seg(
                        derived(fullscreen, (f) => (f ? 'on' : 'off')),
                        [
                            ['off', '창 모드'],
                            ['on', '전체 화면'],
                        ],
                        (v) => void setFullscreen(v === 'on'),
                    )}</div>
                <div class="set-row top"><span>글꼴<small>선수와 그라운드는 어떤 스타일에서도 픽셀 아트로 유지됩니다.</small></span>
                    <div class="font-list">${FONTS.map(
                        (
                            f,
                        ) => html`<button ${attr({ class: derived(pref('font'), (font) => `font-opt ${font === f.id ? 'on' : ''}`) })} data-font="${f.id}" ${on('click', () => setPref('font', f.id))}>
                        <b>${f.label}</b><span class="sample">내셔널 리그 · 128k${COIN} · 뒷공간 침투 · 가나다</span><small>${f.note}</small></button>`,
                    )}</div></div>
                <div class="set-row"><span>자동 줌<small>선수들이 공 주변에 몰리면 카메라가 확대됩니다. 휠 또는 +/−로 직접 줌, 0으로 초기화.</small></span>
                    ${seg(
                        toggle('autoZoom'),
                        [
                            ['on', '켜짐'],
                            ['off', '꺼짐'],
                        ],
                        (v) => setPref('autoZoom', v === 'on'),
                    )}</div>
                <div class="set-row"><span>동작 줄이기<small>깜빡이고 맥동하는 UI 요소를 멈춥니다.</small></span>
                    ${seg(
                        toggle('reduceMotion'),
                        [
                            ['off', '꺼짐'],
                            ['on', '켜짐'],
                        ],
                        (v) => setPref('reduceMotion', v === 'on'),
                    )}</div>
            </div>`;
    };
    const Sound = () => {
        const vol = (
            k: 'sfxVolume' | 'crowdVolume',
            label: string,
            note: string,
        ) => html`<label class="set-row"><span>${label}<small>${note}</small></span>
                ${slider(
                    derived(pref(k), (value) => Math.round(value * 100)),
                    0,
                    100,
                    5,
                    '%',
                    (v) => {
                        setPref(k, v / 100);
                        if (k === 'sfxVolume') audio.play('kick');
                    },
                )}</label>`;
        return html`<div class="set-rows">
                <div class="set-row"><span>사운드<small>경기 중 M으로 전환합니다.</small></span>${seg(
                    derived(pref('muted'), (muted) => (muted ? 'off' : 'on')),
                    [
                        ['on', '켜짐'],
                        ['off', '음소거'],
                    ],
                    (v) => setPref('muted', v === 'off'),
                )}</div>
                ${vol('sfxVolume', '효과음', '킥, 태클, 휘슬, UI.')}
                ${vol('crowdVolume', '관중', '공이 골문에 가까워질수록 커지는 환호 소리.')}
                <h4>라디오 <small>방송국 노래와 내 노래 · N 다음 곡 · R 켜기/끄기</small></h4>
                <div class="set-row"><span>라디오</span>${seg(
                    toggle('radioOn'),
                    [
                        ['on', '켜짐'],
                        ['off', '꺼짐'],
                    ],
                    (v) => radio.setOn(v === 'on'),
                )}</div>
                <label class="set-row"><span>라디오 볼륨</span>${slider(
                    derived(pref('radioVolume'), (value) => Math.round(value * 100)),
                    0,
                    100,
                    5,
                    '%',
                    (v) => setPref('radioVolume', v / 100),
                )}</label>
                <div class="set-row"><span>경기 중<small>작게 설정하면 관중과 해설 소리 아래로 낮춥니다.</small></span>${seg(
                    pref('radioInMatch'),
                    [
                        ['on', '기본'],
                        ['quiet', '작게'],
                        ['off', '꺼짐'],
                    ] as Array<['on' | 'quiet' | 'off', string]>,
                    (v) => setPref('radioInMatch', v),
                )}</div>
                ${YourSongs()}
                ${$render(derived(myTracks, () => SongList()))}
            </div>`;
    };
    const Gameplay = () => {
        return html`<div>
                <div class="set-rows"><div class="set-row"><span>경기 인트로<small>킥오프 전 양 팀 선수, 해설진, 경기장 소개. Enter 또는 Esc로 바로 킥오프.</small></span>
                    ${seg(
                        toggle('matchIntro'),
                        [
                            ['on', '표시'],
                            ['off', '건너뛰기'],
                        ],
                        (v) => setPref('matchIntro', v === 'on'),
                    )}</div>
                <div class="set-row"><span>AI 속도<small>AI 선수가 행동하고 결과가 처리되는 속도.</small></span>
                    ${seg(
                        pref('aiSpeed'),
                        [
                            ['fast', '빠름'],
                            ['normal', '보통'],
                            ['slow', '느림'],
                        ] as Array<[AiSpeed, string]>,
                        (v) => setPref('aiSpeed', v),
                    )}</div>
                <div class="set-row top"><span>지시 대상<small>명령을 내릴 선수 범위. 경기 중 F로 전환합니다.</small></span>
                    <div class="font-list">${CONTROL_MODES.map((m) => html`<button ${attr({ class: derived(pref('controlMode'), (mode) => `font-opt ${mode === m.id ? 'on' : ''}`) })} ${on('click', () => setPref('controlMode', m.id))}><b>${m.label}</b><small>${m.note}</small></button>`)}</div></div>
                <div class="set-row"><span>코치 팁<small>어떤 일이 처음 일어날 때 한 번 나오는 힌트.</small></span>
                    <div class="seg">${seg(
                        toggle('tips'),
                        [
                            ['on', '켜짐'],
                            ['off', '꺼짐'],
                        ],
                        (v) => setPref('tips', v === 'on'),
                    )}</div></div>
                <div class="set-row"><span>튜토리얼 메시지<small>경기와 커리어 허브의 모든 코치 팁을 다시 표시합니다.</small></span>
                    <div class="set-reset">
                        <button class="ghost" ${attr({ disabled: derived(seenTips, (n) => n === 0) })} ${on('click', () => {
                            const n = seenTips();
                            setPref('tipsSeen', []);
                            setPref('tips', true);
                            tipsReset.set(`팁 ${n}개가 다시 표시됩니다.`);
                        })}>튜토리얼 메시지 초기화</button>
                        <small role="status">${derived(combined([seenTips, tipsReset]), ([n, done]) => done || (n ? `지금까지 ${n}개 확인` : '아직 본 팁 없음'))}</small>
                    </div></div>
                </div>
                <h4>경기 기본값 <small>빠른 경기 및 새 커리어</small></h4>
                ${matchOptions(props.defaults.get, props.defaults.set)}
                ${isDesktop ? html`` : Backup()}
            </div>`;
    };
    /** Browser saves live in this browser only: a file backup to keep, and the way back. */
    const backupNote = grain('');
    const Backup = () => html`<h4>커리어 백업 <small>저장 데이터는 이 브라우저에만 있습니다</small></h4>
        <div class="set-rows">
            <div class="set-row"><span>내보내기<small>커리어를 파일로 내려받습니다. 브라우저 데이터가 지워질 때를 대비해 하나 보관하세요.</small></span>
                <div class="set-reset"><button class="ghost" ${attr({ disabled: !careerBackup() })} ${on('click', () => {
                    const raw = careerBackup();
                    if (!raw) return;
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
                    a.download = `tackle-tactics-${(props.career?.name ?? 'career').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                })}>백업 내보내기</button></div></div>
            <div class="set-row"><span>가져오기<small>백업 파일을 불러옵니다. 이 브라우저의 커리어를 대체합니다.</small></span>
                <div class="set-reset">
                    <label class="button ghost file-pick">백업 가져오기<input type="file" accept=".json,application/json" hidden ${on(
                        'change',
                        async (e) => {
                            const input = e.target as HTMLInputElement;
                            const file = input.files?.[0];
                            input.value = '';
                            if (!file) return;
                            if (
                                careerBackup() &&
                                !(await props.confirm({
                                    title: '이 커리어를 교체할까요?',
                                    body: '이 브라우저의 커리어가 백업으로 교체됩니다.',
                                    action: '백업 가져오기',
                                }))
                            )
                                return;
                            const why = restoreCareer(await file.text());
                            if (why) return backupNote.set(why);
                            backupNote.set('불러왔습니다. 다시 시작합니다…');
                            await whenSaved();
                            location.reload();
                        },
                    )} /></label>
                    <small role="status">${backupNote}</small>
                </div></div>
        </div>`;
    const Career = () => {
        const c = props.career;
        if (!c) return html`<p class="muted">불러온 커리어가 없습니다.</p>`;
        return html`<div>
            <h4>${c.name} <small>다음 경기부터 적용</small></h4>
            ${matchOptions(
                () => c.settings,
                (o) => {
                    Object.assign(c.settings, o);
                    c.save();
                },
            )}
            <h4>저장 파일 <small>변경할 때마다 자동 저장</small></h4>
            <p class="save-path">${savePath}</p>
            ${
                props.onDeleteCareer
                    ? html`<div class="danger-zone"><span>이 커리어 저장 데이터를 삭제합니다. 되돌릴 수 없습니다.</span>
                <button class="warn" ${on('click', async () => {
                    if (
                        await props.confirm({
                            title: '이 커리어를 삭제할까요?',
                            body: `“${c.name}” 은(는) 현재 저장 슬롯에서 삭제됩니다.`,
                            action: '커리어 삭제',
                        })
                    )
                        props.onDeleteCareer!();
                })}>커리어 삭제</button></div>`
                    : html``
            }
        </div>`;
    };
    const link = (href: string, text: string) =>
        html`<a href="${href}" target="_blank" rel="noopener" ${on('click', openExternal)}>${text}</a>`;
    /** THIRD-PARTY-NOTICES.txt (made by the build, scripts/notices.mjs), loaded when asked for. */
    const notices = grain('');
    const About = () => html`<div class="about">
        <h4>바이브 코딩으로 만든 게임</h4>
        <p>Tackle Tactics는 모든 코드를 직접 쓰지 않고 AI 코딩 도우미(Claude Opus 5.5, GPT 6.2 Sol)에게 지시해 만든 취미 프로젝트입니다.
        설계, 결정, 플레이 테스트는 사람이 했지만 코드의 상당 부분은 그렇지 않습니다. 거친 부분, 어색한 밸런스, 간혹 버그가 있을 수 있으니 발견하면 알려 주세요.</p>
        <h4>크레딧</h4>
        <dl class="credits-list">
            <dt>디자인·기획</dt><dd>Sebastian Heinz</dd>
            <dt>코드</dt><dd>다음 도구로 작성: Claude Opus 5.5 (Claude Code) and GPT 6.2 Sol</dd>
            <dt>선수·그라운드·경기장 아트</dt><dd>한국어판용으로 직접 제작한 그래픽(별도 라이선스 미지정). 원작은 bubbabba의 <i>Soccer Match – Top Down Football Tileset & Players</i>(유료, 이 판에는 미포함)를 사용했습니다. ${link('https://bubbabba.itch.io', 'bubbabba')}</dd>
            <dt>라디오</dt><dd>노래 제작: ${link('https://suno.com', 'Suno')}</dd>
            <dt>글꼴</dt><dd>Barlow Condensed, Inter, Silkscreen, Pixelify Sans, VT323, Noto Sans Symbols (SIL Open Font License, via ${link('https://fontsource.org', 'Fontsource')})</dd>
            <dt>소스</dt><dd>${link('https://github.com/IamSebastianDev/tackle-tactics', 'github.com/IamSebastianDev/tackle-tactics')}</dd>
            <dt>사용 기술</dt><dd>${link('https://www.npmjs.com/package/@grainular/nord', 'Nørd & Grains')}, TypeScript, Vite, ${link('https://tauri.app', 'Tauri')}</dd>
        </dl>
        <p class="muted">클럽, 선수, 국가, 리그는 모두 가상입니다. 실제와 닮은 부분이 있더라도 오마주일 뿐 주장이 아닙니다.</p>
        <h4>라이선스 <small>게임 코드는 MIT</small></h4>
        <p>오픈소스 소프트웨어와 글꼴도 게임의 일부입니다. 해당 라이선스:</p>
        ${$if(derived(notices, Boolean))
            .$then(() => html`<pre class="notices">${notices}</pre>`)
            .$else(
                () =>
                    html`<button class="ghost" ${on('click', () =>
                        fetch('THIRD-PARTY-NOTICES.txt')
                            // a dev server answers a missing file with the game's index.html: only real text counts
                            .then((r) =>
                                r.ok && !r.headers.get('content-type')?.includes('html')
                                    ? r.text()
                                    : Promise.reject(new Error(String(r.status))),
                            )
                            .catch(() => '라이선스 목록은 릴리스 빌드에 포함되며, 이 빌드에는 없습니다.')
                            .then((t) => notices.set(t)),
                    )}>서드파티 라이선스 보기</button>`,
            )}
    </div>`;
    const tabs: Tab[] = ['display', 'sound', 'gameplay'];
    if (props.career) tabs.push('career');
    tabs.push('about');
    return Dialog({
        label: '설정',
        className: 'modal settings-modal',
        dismiss: props.onClose,
        children: html`<div class="modal-body">
            <header><h2>설정</h2><button class="ghost" ${on('click', props.onClose)}>닫기 <kbd>Esc</kbd></button></header>
            <div class="seg tabs">${tabs.map((id) => {
                const active = derived(tab, (current) => current === id);
                return html`<button ${attr({ class: derived(active, (selected) => (selected ? 'on' : '')), 'aria-pressed': derived(active, String) })} ${on('click', () => tab.set(id))}>${TAB_KO[id]}</button>`;
            })}</div>
            <div class="modal-scroll set-body">${$switch(tab).$case('display', Display).$case('sound', Sound).$case('gameplay', Gameplay).$case('about', About).$default(Career)}</div>
            <p class="set-version" title="버그를 제보할 때 함께 알려 주세요">Tackle Tactics v${__APP_VERSION__}${__APP_COMMIT__ ? html` <span>· 빌드 ${__APP_COMMIT__}</span>` : html``}</p>
        </div>`,
    });
};

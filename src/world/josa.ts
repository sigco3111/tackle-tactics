/** Korean particles that follow the final sound of the preceding word. */
const finalInfo = (w: string): { jong: boolean; rieul: boolean } => {
    const s = w.replace(/[\s)\]"'”’.,!?·\-]+$/u, '');
    const ch = s.charCodeAt(s.length - 1);
    if (ch >= 0xac00 && ch <= 0xd7a3) {
        const j = (ch - 0xac00) % 28;
        return { jong: j !== 0, rieul: j === 8 };
    }
    if (/[0-9]/.test(s.at(-1) ?? '')) return { jong: '013678'.includes(s.at(-1)!), rieul: s.at(-1) === '1' || s.at(-1) === '8' };
    return { jong: false, rieul: false };
};
const PAIRS: Record<string, [string, string]> = { 이: ['이', '가'], 은: ['은', '는'], 을: ['을', '를'], 과: ['과', '와'] };
export const josa = (word: string, kind: '이' | '은' | '을' | '과' | '로'): string => {
    const { jong, rieul } = finalInfo(word);
    if (kind === '로') return word + (jong && !rieul ? '으로' : '로');
    const [a, b] = PAIRS[kind]!;
    return word + (jong ? a : b);
};
/** Resolve "이(가)", "은(는)", "을(를)" written after a word. */
export const fixJosa = (text: string): string =>
    text.replace(/(\S*?)(이\(가\)|은\(는\)|을\(를\))/gu, (_m, w: string, p: string) => {
        const { jong } = finalInfo(w);
        const [a, b] = PAIRS[p[0]!]!;
        return w + (jong ? a : b);
    });

/**
 * Latin → Hangul transliteration for the invented nations' names (loanword style: pronounced
 * after each nation's real-world inspiration, stops get "으", n/m/l/ng can close a syllable).
 * It is deterministic, so the same piece always gives the same Hangul within a nation.
 */
export type Lang = 'en' | 'es' | 'pt' | 'fr' | 'de' | 'no' | 'sl' | 'fi' | 'hu' | 'gr' | 'tr' | 'ar' | 'af' | 'ja' | 'it';

const INI: Record<string, number> = { ss: 10, g: 0, n: 2, d: 3, r: 5, m: 6, b: 7, s: 9, '': 11, j: 12, ch: 14, k: 15, t: 16, p: 17, h: 18 };
const MED: Record<string, number> = {
    a: 0, ae: 1, ya: 2, eo: 4, e: 5, ye: 7, o: 8, wa: 9, oe: 11, yo: 12, u: 13, wo: 14, we: 15, wi: 16, yu: 17, eu: 18, i: 20,
};
const FIN: Record<string, number> = { g: 1, n: 4, l: 8, m: 16, ng: 21 };

type Ph = { c: string } | { v: string } | { coda: string };
const LL_SPLIT = new Set<string>(['es', 'pt']);

const syl = (ini: string, med: string, fin = '') => String.fromCharCode(0xac00 + INI[ini]! * 588 + MED[med]! * 28 + (fin ? FIN[fin]! : 0));

const strip = (s: string) =>
    s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/ø/g, 'o')
        .replace(/æ/g, 'ae')
        .replace(/å/g, 'a');

const VOW = new Set(['a', 'e', 'i', 'o', 'u', 'y']);
const isV = (ch: string | undefined) => ch !== undefined && VOW.has(ch);

/** Whole words that deserve a fixed rendering. */
const WORDS: Record<string, string> = {
    // fixed spellings the sample sheet promised
    highmarch: '하이마치', marshden: '마슈든', brookwick: '브룩윅', brightwater: '브라이트워터', magnus: '망누스', brandbrink: '브란트브링크',
    westerdijk: '베스터다이크', delaville: '들라빌',
    saint: '생', san: '산', sao: '상', santa: '산타', santo: '산투', porto: '포르투', rio: '히우', monte: '몬테', villa: '비야', vila: '빌라', ville: '빌',
    real: '레알', sporting: '스포르팅', club: '클루브', deportivo: '데포르티보', atletico: '아틀레티코', independiente: '인데펜디엔테',
    estudiantes: '에스투디안테스', sportivo: '스포르티보', union: '우니온', unione: '우니오네', dynamo: '디나모', lokomotiv: '로코모티프',
    spartak: '스파르타크', partizan: '파르티잔', metalist: '메탈리스트', zarja: '자랴', racing: '라싱', olympique: '올랭피크', stade: '스타드',
    avant: '아방', en: '앙', wanderers: '워더러스', rovers: '로버스', athletic: '애슬레틱', united: '유나이티드', guild: '길드', company: '컴퍼니',
    vanguard: '뱅가드', wardens: '워든스', fellowship: '펠로십', rangers: '레인저스', order: '오더', blades: '블레이즈', thistle: '시슬',
    albion: '앨비언', county: '카운티', academicals: '아카데미컬스', town: '타운', swifts: '스위프츠', stars: '스타스', eagles: '이글스',
    warriors: '워리어스', kestrels: '케스트럴스', rising: '라이징', esporte: '이스포르치', clube: '클루비', associacao: '아소시아상', uniao: '우니앙',
    gremio: '그레미우', ittihad: '이티하드', nahda: '나흐다', shabab: '샤밥', najma: '나즈마', al: '알', vasas: '바샤시', haladas: '호러더시',
    aris: '아리스', ethnikos: '에트니코스', asteras: '아스테라스', atromitos: '아트로미토스', panionios: '파니오니오스', calcio: '칼초',
};

/** Tokens kept in Latin letters (club-type abbreviations). */
const KEEP = new Set(['FC', 'SC', 'SK', 'IK', 'IL', 'BK', 'IF', 'FK', 'SV', 'TSV', 'VfR', 'AS', 'US', 'CD', 'SE', 'TE', 'AC', 'PS', 'JK', 'KC']);

const parse = (raw: string, lang: Lang): Ph[] => {
    let w = strip(raw);
    const out: Ph[] = [];
    if (lang === 'en') w = w.replace(/rch$/, 'ch').replace(/igh/g, 'ai').replace(/er$/, 'eo');
    if (lang === 'no') w = w.replace(/vn/g, 'un').replace(/fj/g, 'fi').replace(/hl/g, 'l').replace(/rd$/, 'r');
    if (lang === 'de') w = w.replace(/stadt/g, 'shtat').replace(/dt/g, 't').replace(/^st/, 'sht');
    if (lang === 'fr') {
        // nasal vowels (an/en/am/em/on/in/un before a consonant or at the end) and silent final consonants
        w = w.replace(/(ll|rr|nn|tt)e(?=[bcdfghjklmnpqrstvwxz])/g, '$1');
        w = w.replace(/(a|e|o|i|u)(n|m)(?=[bcdfghjklpqrstvwxz]|$)/g, (_m, a: string) => `${({ a: 'A', e: 'A', o: 'O', i: 'E', u: 'E' } as Record<string, string>)[a]!}`);
        w = w.replace(/([aeiou]|[AOE])(p|t|d|s|x|c)$/g, '$1').replace(/([AOE])(p|t|d|s|x|c)+$/g, '$1');
    }
    const c = (x: string) => out.push({ c: x });
    const v = (x: string) => out.push({ v: x });
    let i = 0;
    const at = (n: number) => w[i + n];
    const rest = (s: string) => w.startsWith(s, i);
    while (i < w.length) {
        const ch = w[i]!;
        const nx = at(1);
        const prevV = isV(w[i - 1]);
        if (ch === 'A') { v('a'); out.push({ coda: 'ng' }); i++; continue; }
        if (ch === 'O') { v('o'); out.push({ coda: 'ng' }); i++; continue; }
        if (ch === 'E') { v('ae'); out.push({ coda: 'ng' }); i++; continue; }
        // vowels
        if (isV(ch)) {
            const two = w.slice(i, i + 2);
            if (lang === 'en' && two === 'eo' && i === w.length - 2) { v('eo'); i += 2; continue; }
            const three = w.slice(i, i + 3);
            if (three === 'eau' && lang === 'fr') { v('o'); i += 3; continue; }
            if (two === 'ou' && (lang === 'fr' || lang === 'pt' || lang === 'en' || lang === 'no' || lang === 'af')) { v(lang === 'en' ? 'u' : 'u'); i += 2; continue; }
            if (two === 'oo') { v('u'); i += 2; continue; }
            if (two === 'ee') { v('i'); i += 2; continue; }
            if (two === 'ea' && lang === 'en') { v('i'); i += 2; continue; }
            if (two === 'ai') { if (lang === 'fr') v('e'); else { v('a'); v('i'); } i += 2; continue; }
            if (two === 'ei') { if (lang === 'de' || lang === 'hu') { v('a'); v('i'); } else { v('e'); v('i'); } i += 2; continue; }
            if (two === 'au') { if (lang === 'fr') v('o'); else { v('a'); v('u'); } i += 2; continue; }
            if (two === 'ie' && (lang === 'de')) { v('i'); i += 2; continue; }
            if (two === 'oi') { if (lang === 'fr') { v('wa'); } else { v('o'); v('i'); } i += 2; continue; }
            if (two === 'eu') { if (lang === 'de') { v('o'); v('i'); } else if (lang === 'fr') v('oe'); else { v('e'); v('u'); } i += 2; continue; }
            if (two === 'ae') { v('e'); i += 2; continue; }
            if (two === 'oe') { v('o'); v('e'); i += 2; continue; }
            if (ch === 'y') {
                if (!prevV && i > 0 && !isV(nx)) { v('i'); i++; continue; }
                if (isV(nx)) { c('Y'); i++; continue; }
                v('i'); i++; continue;
            }
            if (ch === 'e' && i === w.length - 1 && i > 1 && !isV(w[i - 1]) && (lang === 'en' || lang === 'fr')) { i++; continue; }
            if (ch === 'u' && (w[i - 1] === 'q' || (w[i - 1] === 'g' && (nx === 'e' || nx === 'i') && (lang === 'fr' || lang === 'es' || lang === 'pt')))) { if (lang === 'en' && w[i - 1] === 'q') v('wo'); i++; continue; }
            if (ch === 'e' && lang === 'en') { v('e'); i++; continue; }
            v(ch === 'e' && (lang === 'fr') && i === w.length - 1 ? 'e' : ch);
            i++;
            continue;
        }
        // consonants
        if (rest('ch')) {
            if (lang === 'fr') c('Sh'); else if (lang === 'de' || lang === 'gr' || lang === 'sl' || lang === 'hu' || lang === 'ar') { if (lang === 'ar' || lang === 'gr') c('h'); else if (lang === 'de' && (isV(w[i + 2]) === false && i + 2 < w.length || i + 2 >= w.length)) { c('H'); } else c('ch'); } else c('ch');
            i += 2; continue;
        }
        if (rest('sch') && lang === 'de') { c('Sh'); i += 3; continue; }
        if (rest('sh')) { c('Sh'); i += 2; continue; }
        if (rest('ph')) { c('p'); i += 2; continue; }
        if (rest('th')) { c(lang === 'en' ? 's' : 't'); i += 2; continue; }
        if (rest('kh')) { c('h'); i += 2; continue; }
        if (rest('gh')) { c('g'); i += 2; continue; }
        if (rest('ts') && lang === 'ja') { c('ts'); i += 2; continue; }
        if (rest('tz')) { c('ts'); i += 2; continue; }
        if (rest('ng') && (!isV(w[i + 2]) || i + 2 >= w.length)) { out.push({ coda: 'ng' }); i += 2; continue; }
        if (rest('ck')) { c('k'); i += 2; continue; }
        if (rest('ll')) { if (LL_SPLIT.has(lang)) { c('Y'); } else if (isV(w[i + 2])) { out.push({ coda: 'l' }); c('l'); } else out.push({ coda: 'l' }); i += 2; continue; }
        if (rest('nh') && lang === 'pt') { c('n'); v('i'); i += 2; continue; }
        if (rest('lh') && lang === 'pt') { c('l'); c('Y'); i += 2; continue; }
        if (rest('qu')) { c('k'); if (lang === 'en') { v('wo'); } i += 2; continue; }
        if (rest('gn') && (lang === 'fr' || lang === 'it')) { c('n'); i += 2; continue; }
        if (rest('ss') || rest('tt') || rest('pp') || rest('kk') || rest('rr') || rest('mm') || rest('nn') || rest('dd') || rest('ff') || rest('gg') || rest('bb') || rest('cc') || rest('zz')) {
            i += 1; continue;
        }
        switch (ch) {
            case 'c': if ((nx === 'e' || nx === 'i' || nx === 'y') && lang === 'it') c('ch'); else if ((nx === 'e' || nx === 'i' || nx === 'y') && lang !== 'de' && lang !== 'hu') c('s'); else c(lang === 'tr' ? 'ch' : 'k'); break;
            case 'g': if ((nx === 'e' || nx === 'i') && (lang === 'fr' || lang === 'it' || lang === 'pt' || lang === 'en')) c(lang === 'fr' || lang === 'pt' ? 'Zh' : 'j'); else if ((nx === 'e' || nx === 'i') && lang === 'es') c('h'); else c('g'); break;
            case 'h': if (lang === 'fr' || lang === 'es' || lang === 'pt' || lang === 'it') break; c('h'); break;
            case 'j': if (lang === 'es') c('h'); else if (lang === 'de' || lang === 'no' || lang === 'fi' || lang === 'sl' || lang === 'hu') c('Y'); else if (lang === 'fr' || lang === 'pt') c('Zh'); else c('j'); break;
            case 'k': c('k'); break;
            case 'q': c('k'); break;
            case 'r': c('r'); break;
            case 's': if (lang === 'de' && isV(nx) && (i === 0 || prevV)) c('z'); else c('s'); break;
            case 'v': c(lang === 'de' ? 'p' : 'b'); break;
            case 'w': if (lang === 'de') c('b'); else if (isV(nx)) c('W'); else break; break;
            case 'x': c('k'); c('s'); break;
            case 'z': if (lang === 'de') c('ts'); else c('j'); break;
            case 'b': case 'd': case 'f': case 'l': case 'm': case 'n': case 'p': case 't':
                if (ch === 'd' && lang === 'ar' && nx === 'h') { c('d'); break; }
                c(ch); break;
            default: break;
        }
        i++;
    }
    return out;
};

const P: Record<string, string> = { b: 'b', d: 'd', f: 'p', l: 'r', m: 'm', n: 'n', p: 'p', t: 't', k: 'k', g: 'g', s: 's', r: 'r', h: 'h', j: 'j', z: 'j', ch: 'ch', ts: 'ch' };

/** Build syllables from phonemes. */
const build = (ph: Ph[], lang: Lang): string => {
    let out = '';
    const sylls: Array<{ ini: string; med: string; fin: string }> = [];
    const push = (ini: string, med: string) => sylls.push({ ini, med, fin: '' });
    for (let k = 0; k < ph.length; k++) {
        const p = ph[k]!;
        const nxt = ph[k + 1];
        if ('c' in p) {
            const cc = p.c;
            if (nxt && 'v' in nxt) {
                // consonant + vowel syllable
                let ini = cc === 'ts' && lang === 'ja' ? 'ss' : (P[cc] ?? 'b');
                let med = nxt.v;
                if (cc === 'Y') { ini = ''; med = ({ a: 'ya', e: 'ye', o: 'yo', u: 'yu', i: 'i', eu: 'eu', ya: 'ya', ye: 'ye', yo: 'yo', yu: 'yu', wa: 'wa', wo: 'wo', we: 'we', wi: 'wi' } as Record<string, string>)[med] ?? med; }
                else if (cc === 'W') { ini = ''; med = ({ a: 'wa', e: 'we', i: 'wi', o: 'wo', u: 'u', wo: 'wo' } as Record<string, string>)[med] ?? med; }
                else if (cc === 'Sh') { ini = 's'; med = ({ a: 'ya', e: 'ye', o: 'yo', u: 'yu', i: 'i' } as Record<string, string>)[med] ?? med; }
                else if (cc === 'Zh') { ini = 'j'; }
                else if (cc === 'H') { ini = 'h'; }
                else if (cc === 'z') { ini = 'j'; }
                if (ini === 'ss' && med === 'u') med = 'eu';
                if (med === 'e' && lang !== 'en') med = 'e';
                if (med === 'o' && lang === 'ja') med = 'o';
                push(ini, med);
                k++;
                continue;
            }
            // consonant without a vowel
            if (cc !== 'l' && cc !== 'r' && nxt && 'c' in nxt && nxt.c === 'l' && ph[k + 2] && 'v' in ph[k + 2]!) {
                sylls.push({ ini: P[cc] ?? 'b', med: 'eu', fin: 'l' });
                push('r', (ph[k + 2] as { v: string }).v);
                k += 2;
                continue;
            }
            const prev = sylls[sylls.length - 1];
            const cl = P[cc];
            if ((cc === 'n' || cc === 'm' || cc === 'l') && prev && !prev.fin && !(lang === 'ja' && false)) {
                prev.fin = cc === 'n' ? 'n' : cc === 'm' ? 'm' : 'l';
                continue;
            }
            if (cc === 'ch' && lang === 'en') { push('ch', 'i'); continue; }
            if (cc === 'Sh') { push('s', 'yu'); continue; }
            if (cc === 'Y') { continue; }
            if (cc === 'W') { continue; }
            if (cc === 'Zh') { push('j', 'eu'); continue; }
            if (cc === 'H') { push('h', 'eu'); continue; }
            push(cl ?? 'b', 'eu');
            continue;
        }
        if ('coda' in p) {
            const prev = sylls[sylls.length - 1];
            if (prev && !prev.fin) prev.fin = p.coda;
            else if (p.coda === 'ng') push('', 'eu');
            continue;
        }
        // vowel without consonant
        push('', p.v);
    }
    for (const s of sylls) out += syl(s.ini, s.med, s.fin);
    return out;
};

const word = (raw: string, lang: Lang) => {
    const key = strip(raw);
    if (WORDS[key]) return WORDS[key]!;
    return build(parse(raw, lang), lang);
};

/** Transliterate a name (words separated by space or hyphen; digits and abbreviations stay). */
export const toHangul = (text: string, lang: Lang): string =>
    text.replace(/[A-Za-zÀ-ÿ']+/g, (w) => (KEEP.has(w) ? w : word(lang === 'ja' ? w.replace(/fu/gi, (m) => (m[0] === 'F' ? 'Hu' : 'hu')) .replace(/'/g, '') : w.replace(/'/g, ''), lang)));

/**
 * Nations: invented countries, each with a recognisable naming flavour, its own place names,
 * club naming habits and a flag. A career is set in one nation's pyramid; players carry a
 * nationality, so squads and the transfer market mix in players from abroad.
 *
 * Name pools are either a plain list or two halves glued together (`glue`), which keeps the
 * data small while giving every nation a few hundred surnames and well over 50 towns.
 */
import type { Rng } from '../rng';
import { toHangul, type Lang } from './hangul';

export const NATION_IDS = [
    'highmarch',
    'valdoria',
    'nordhavn',
    'zaravia',
    'ostmark',
    'gallavre',
    'lusmar',
    'pampora',
    'caledra',
    'suvela',
    'varhely',
    'thalassa',
    'anvara',
    'qasira',
    'kassara',
    'kiyora',
    'korea',
] as const;
export type NationId = (typeof NATION_IDS)[number];
export const DEFAULT_NATION: NationId = 'highmarch';

export type Nation = {
    id: NationId;
    name: string;
    /** "Valdorian midfielder". */
    adjective: string;
    /** CSS background painting the flag. */
    flag: string;
    playerName: (rng: Rng) => string;
    /** Distinct town names for a whole pyramid (at least 50), shuffled. */
    places: (rng: Rng) => string[];
    clubName: (rng: Rng, place: string) => string;
};

// ------------------------------------------------------------------ building blocks

type Pool = readonly string[] | { a: readonly string[]; b: readonly string[] };
const glue = (a: readonly string[], b: readonly string[]): Pool => ({ a, b });
const draw = (rng: Rng, pool: Pool) => ('a' in pool ? rng.pick(pool.a) + rng.pick(pool.b) : rng.pick(pool));
const every = (pool: Pool) => ('a' in pool ? pool.a.flatMap((x) => pool.b.map((y) => x + y)) : [...pool]);

type Spec = {
    name: string;
    adjective: string;
    flag: string;
    first: Pool;
    last: Pool;
    towns: Pool;
    /** Club name patterns; `#` is the town. */
    clubs: readonly string[];
    /** Pronunciation of the nation's inspiration, for the Hangul rendering (`ko`: already Korean). */
    lang: Lang | 'ko';
};

const make = (id: NationId, s: Spec): Nation => {
    const ko = s.lang === 'ko';
    const hangul = (text: string) => (ko ? text : toHangul(text, s.lang as Lang));
    return {
        id,
        name: hangul(s.name),
        adjective: hangul(s.adjective),
        flag: s.flag,
        // Korean names run family name first, with no space
        playerName: (rng) => (ko ? `${draw(rng, s.last)}${draw(rng, s.first)}` : hangul(`${draw(rng, s.first)} ${draw(rng, s.last)}`)),
        places: (rng) => [...new Set(every(s.towns).map(hangul))].sort(() => rng() - 0.5),
        clubName: (rng, place) => hangul(rng.pick(s.clubs)).replace('#', place),
    };
};

// ------------------------------------------------------------------ flags
// Each flag is modelled on its real-world inspiration, so it reads at a glance even at 18×12px.
// All layouts are CSS background layers (first layer on top).

const stripes = (dir: 'bottom' | 'right', bands: Array<[string, number]>) => {
    let at = 0;
    const stops = bands.map(([col, w]) => {
        const stop = `${col} ${at}% ${at + w}%`;
        at += w;
        return stop;
    });
    return `linear-gradient(to ${dir}, ${stops.join(', ')})`;
};
const h3 = (a: string, b: string, c: string) =>
    stripes('bottom', [
        [a, 33.4],
        [b, 33.2],
        [c, 33.4],
    ]);
const v3 = (a: string, b: string, c: string) =>
    stripes('right', [
        [a, 33.4],
        [b, 33.2],
        [c, 33.4],
    ]);
/** A vertical bar from x0% to x1% and a horizontal bar from y0% to y1%. */
const bars = (col: string, [x0, x1]: [number, number], [y0, y1]: [number, number]) =>
    `linear-gradient(to right, transparent ${x0}%, ${col} ${x0}% ${x1}%, transparent ${x1}%), linear-gradient(to bottom, transparent ${y0}%, ${col} ${y0}% ${y1}%, transparent ${y1}%)`;
/** St George style: a centred cross. */
const centredCross = (field: string, c: string) => `${bars(c, [44, 56], [41, 59])}, ${field}`;
/** Nordic cross, shifted to the hoist; optionally with a border (Norway). */
const nordic = (field: string, c: string, border?: string) =>
    border
        ? `${bars(c, [29, 39], [42.5, 57.5])}, ${bars(border, [26, 42], [38, 62])}, ${field}`
        : `${bars(c, [28, 40], [41, 59])}, ${field}`;
const saltire = (field: string, c: string) =>
    `linear-gradient(to bottom right, transparent 44%, ${c} 44% 56%, transparent 56%), linear-gradient(to bottom left, transparent 44%, ${c} 44% 56%, transparent 56%), ${field}`;
/** A filled circle; `r` is a share of the gradient ray, so it scales with the flag. */
const dot = (col: string, at: string, r: number) => `radial-gradient(circle at ${at}, ${col} 0 ${r}%, transparent ${r + 0.8}%)`;
/** A rhombus touching the middle of each edge (Brazil), as four corner triangles. */
const rhombus = (col: string) =>
    [
        ['to bottom right', '0 0'],
        ['to bottom left', '100% 0'],
        ['to top right', '0 100%'],
        ['to top left', '100% 100%'],
    ]
        .map(([dir, pos]) => `linear-gradient(${dir}, transparent 50%, ${col} 50%) ${pos} / 50% 50% no-repeat`)
        .join(', ');

const C = {
    red: '#c8323a',
    white: '#f2efe6',
    blue: '#2a4fa0',
    navy: '#1f3a78',
    yellow: '#f2c230',
    gold: '#e0b046',
    green: '#2f8a4c',
    black: '#22262b',
    sky: '#74acdf',
    finBlue: '#1f4f9f',
    greekBlue: '#2d63b0',
};

/** Taegukgi as an SVG background: one taegeuk S-curve and the four trigrams (geon, gam, ri, gon). */
function koreaFlag(): string {
    const bar = (y: number, broken: boolean) =>
        broken
            ? `<rect x="-3.25" y="${y - 0.6}" width="2.8" height="1.2"/><rect x="0.45" y="${y - 0.6}" width="2.8" height="1.2"/>`
            : `<rect x="-3.25" y="${y - 0.6}" width="6.5" height="1.2"/>`;
    const tri = (cx: number, cy: number, rot: number, broken: [boolean, boolean, boolean]) =>
        `<g transform="translate(${cx} ${cy}) rotate(${rot})">${broken.map((b, k) => bar((k - 1) * 1.85, b)).join('')}</g>`;
    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 24" preserveAspectRatio="none"><rect width="36" height="24" fill="#fff"/>` +
        `<g transform="rotate(-33.69 18 12)"><path d="M12 12A6 6 0 0 1 24 12A3 3 0 0 1 18 12A3 3 0 0 0 12 12Z" fill="#cd2e3a"/><path d="M24 12A6 6 0 0 1 12 12A3 3 0 0 1 18 12A3 3 0 0 0 24 12Z" fill="#0047a0"/></g>` +
        `<g fill="#000">${tri(7.5, 5, -56.31, [false, false, false])}${tri(28.5, 5, 56.31, [true, false, true])}${tri(7.5, 19, 56.31, [false, true, false])}${tri(28.5, 19, -56.31, [true, true, true])}</g></svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / 100% 100% no-repeat, ${C.white}`;
}

const FLAGS: Record<NationId, string> = {
    // England
    highmarch: centredCross(C.white, C.red),
    // Spain
    valdoria: stripes('bottom', [
        [C.red, 25],
        [C.yellow, 50],
        [C.red, 25],
    ]),
    // Norway
    nordhavn: nordic(C.red, C.navy, C.white),
    // Serbia
    zaravia: h3(C.red, C.blue, C.white),
    // Germany
    ostmark: h3(C.black, '#d22c2c', '#f2c230'),
    // France
    gallavre: v3(C.blue, C.white, C.red),
    // Brazil: blue globe on a yellow rhombus on green
    lusmar: `${dot(C.navy, '50% 50%', 22)}, ${rhombus(C.yellow)}, ${C.green}`,
    // Argentina: sky / white / sky with the sun
    pampora: `${dot(C.gold, '50% 50%', 10)}, ${h3(C.sky, C.white, C.sky)}`,
    // Scotland
    caledra: saltire('#1f5fae', C.white),
    // Finland
    suvela: nordic(C.white, C.finBlue),
    // Hungary
    varhely: h3(C.red, C.white, C.green),
    // Greece: nine stripes, a white cross on the blue canton
    thalassa: [
        `linear-gradient(to right, transparent 40%, ${C.white} 40% 60%, transparent 60%) 0 0 / 37% 55.6% no-repeat`,
        `linear-gradient(to bottom, ${C.greekBlue} 40%, ${C.white} 40% 60%, ${C.greekBlue} 60%) 0 0 / 37% 55.6% no-repeat`,
        `repeating-linear-gradient(to bottom, ${C.greekBlue} 0 11.11%, ${C.white} 11.11% 22.22%)`,
    ].join(', '),
    // Turkey: crescent (a red disc biting a white one) and a star
    anvara: `${dot(C.white, '60% 50%', 8)}, ${dot(C.red, '44% 50%', 20)}, ${dot(C.white, '38% 50%', 25)}, ${C.red}`,
    // the red-hoisted Arab tricolour (UAE)
    qasira: `linear-gradient(to right, ${C.red} 0 26%, transparent 26%), ${h3(C.green, C.white, C.black)}`,
    // Ghana: red / gold / green with the black star
    kassara: `${dot(C.black, '50% 50%', 9)}, ${h3(C.red, C.gold, C.green)}`,
    // Japan
    kiyora: `${dot('#bc002d', '50% 50%', 30)}, ${C.white}`,
    // South Korea: drawn as SVG (3:2, taegeuk diameter = half the height, four trigrams on the diagonals)
    korea: koreaFlag(),
};

// ------------------------------------------------------------------ the nations

const SPECS: Record<NationId, Spec> = {
    // the original fantasy-English pool
    highmarch: {
        name: 'Highmarch',
        lang: 'en',
        adjective: 'Highmarch',
        flag: FLAGS.highmarch,
        first: glue(
            [
                'Bra',
                'Kel',
                'Mor',
                'Tav',
                'Ul',
                'Fen',
                'Dar',
                'Ise',
                'Rho',
                'Sel',
                'Vak',
                'Or',
                'Lio',
                'Jas',
                'Ner',
                'Qua',
                'Zel',
                'Ash',
                'Bel',
                'Cor',
            ],
            ['an', 'ric', 'o', 'enn', 'is', 'ard', 'ion', 'el', 'us', 'wyn', 'ek', 'ara', 'im', 'oth', 'ay', 'en'],
        ),
        last: glue(
            [
                'Ash',
                'Stone',
                'Iron',
                'Wyn',
                'Hollow',
                'Thorn',
                'Brook',
                'Gale',
                'Mire',
                'Frost',
                'Oak',
                'Ember',
                'Raven',
                'Silver',
                'Marsh',
            ],
            ['ford', 'vale', 'wick', 'hart', 'more', 'shaw', 'by', 'well', 'den', 'ley', 'ridge', 'crest'],
        ),
        towns: [
            'Mirewick',
            'Thornvale',
            'Galehaven',
            'Emberfall',
            'Ravenmoor',
            'Oakshaw',
            'Frostcrest',
            'Silverbrook',
            'Ironridge',
            'Hollowden',
            'Ashford',
            'Brightwater',
            'Coldharbour',
            'Duskmere',
            'Elderglen',
            'Fallowmere',
            'Greywatch',
            'Highcairn',
            'Ivywood',
            'Kingsreach',
            'Larkspur',
            'Mossbank',
            'Northmarch',
            'Oldcastle',
            'Pinehold',
            'Quarrydeep',
            'Redwater',
            'Stormhaven',
            'Tallow Cross',
            'Underhill',
            'Valewood',
            'Westerfold',
            'Yarrowby',
            'Ambergate',
            'Blackfen',
            'Cindervale',
            'Deepholm',
            'Eastwatch',
            'Foxhollow',
            'Glimmerdell',
            'Harrowgate',
            'Ironhaven',
            'Juniper Bay',
            'Kestrel Moor',
            'Lanternfall',
            'Marrowdeep',
            'Nettlecombe',
            'Owlbridge',
            'Pyrewood',
            'Ravensgate',
        ],
        clubs: [
            '# Wanderers',
            '# Rovers',
            '# Athletic',
            '# Guild',
            '# Company',
            '# Vanguard',
            '# Wardens',
            '# Fellowship',
            '# Rangers',
            '# United',
            '# Order',
            '# Blades',
        ],
    },
    valdoria: {
        name: 'Valdoria',
        lang: 'it',
        adjective: 'Valdorian',
        flag: FLAGS.valdoria,
        first: [
            'Teodar',
            'Mareno',
            'Luciano',
            'Alessio',
            'Ramiro',
            'Dario',
            'Felipe',
            'Gianno',
            'Sergio',
            'Rocco',
            'Nico',
            'Salvo',
            'Emilio',
            'Tomas',
            'Iker',
            'Matteo',
            'Andrés',
            'Bruno',
            'Cesar',
            'Leandro',
        ],
        last: glue(
            ['Alba', 'Castel', 'Ferr', 'Mont', 'Rov', 'Sant', 'Bel', 'Corv', 'Var', 'Esp', 'Lor', 'Marin'],
            ['ez', 'ini', 'ano', 'ello', 'ara', 'ero', 'osa', 'etti', 'aldo', 'ira'],
        ),
        towns: glue(
            ['Castel', 'Monte', 'Villa', 'Porto', 'Roca', 'Alba', 'Santa', 'Val', 'Ponte', 'Rio', 'Torre', 'Bosco'],
            ['mar', 'vera', 'nova', 'fiore', 'bella', 'sol', 'luce', 'rossa', 'doro', 'alta'],
        ),
        clubs: ['Sporting #', 'Real #', 'Atlético #', 'Unione #', '# Calcio', 'CD #', 'Racing #'],
    },
    nordhavn: {
        name: 'Nordhavn',
        lang: 'no',
        adjective: 'Nordhavn',
        flag: FLAGS.nordhavn,
        first: [
            'Sigvar',
            'Halvard',
            'Eirik',
            'Torben',
            'Asger',
            'Leif',
            'Rune',
            'Ivar',
            'Bjarne',
            'Steinar',
            'Oskar',
            'Arvid',
            'Kjell',
            'Magnus',
            'Ragnar',
            'Sindre',
            'Trygve',
            'Vidar',
            'Einar',
            'Joar',
        ],
        last: glue(
            ['Hald', 'Berg', 'Lund', 'Sol', 'Strand', 'Vik', 'Dahl', 'Fjell', 'Holm', 'Nord', 'Ask', 'Ring'],
            ['sen', 'strom', 'gaard', 'heim', 'vik', 'lund', 'by', 'dal', 'qvist', 'nes'],
        ),
        towns: glue(
            ['Kjel', 'Stor', 'Hav', 'Fjor', 'Sval', 'Ulf', 'Vinter', 'Bjorn', 'Grim', 'Sol', 'Ask', 'Ravn'],
            ['vik', 'havn', 'by', 'dal', 'stad', 'holm', 'fjord', 'borg', 'sund', 'nes'],
        ),
        clubs: ['# IF', '# BK', 'IK #', '# FK', '# SK', 'IL #'],
    },
    zaravia: {
        name: 'Zaravia',
        lang: 'sl',
        adjective: 'Zaravian',
        flag: FLAGS.zaravia,
        first: [
            'Dren',
            'Milan',
            'Bojan',
            'Luka',
            'Stanko',
            'Vuk',
            'Radek',
            'Pavel',
            'Zoran',
            'Mirko',
            'Tomas',
            'Ivo',
            'Danek',
            'Goran',
            'Jarek',
            'Kazim',
            'Lev',
            'Oleg',
            'Rasto',
            'Teodor',
        ],
        last: glue(
            ['Kov', 'Petr', 'Bran', 'Mil', 'Rad', 'Vol', 'Dragi', 'Stan', 'Zor', 'Bel', 'Novo', 'Jask'],
            ['ovic', 'ski', 'enko', 'ak', 'ar', 'ev', 'in', 'ek', 'ov', 'ic'],
        ),
        towns: glue(
            ['Brez', 'Kras', 'Vel', 'Dobr', 'Zlat', 'Gor', 'Mir', 'Novi', 'Star', 'Bel', 'Ost', 'Rad'],
            ['na', 'ograd', 'ovo', 'ica', 'ava', 'sko', 'in', 'ets', 'nik', 'ova'],
        ),
        clubs: ['Dynamo #', 'Lokomotiv #', 'Spartak #', 'FK #', 'Zarja #', 'Metalist #', 'Partizan #'],
    },
    ostmark: {
        name: 'Ostmark',
        lang: 'de',
        adjective: 'Ostmark',
        flag: FLAGS.ostmark,
        first: [
            'Joren',
            'Lukas',
            'Fenno',
            'Henrik',
            'Matthis',
            'Jannik',
            'Wim',
            'Bastian',
            'Ruud',
            'Till',
            'Anton',
            'Floris',
            'Konrad',
            'Sem',
            'Gerrit',
            'Malte',
            'Niels',
            'Ole',
            'Pim',
            'Timo',
        ],
        last: glue(
            ['Brand', 'Vander', 'Hof', 'Stein', 'Krau', 'Linde', 'Wester', 'Ber', 'Molen', 'Faber', 'Kamp', 'Schoen'],
            ['auer', 'meer', 'mann', 'berg', 'dijk', 'hof', 'er', 'inga', 'ke', 'brink'],
        ),
        towns: glue(
            ['Ober', 'Linden', 'Alt', 'Neu', 'Wester', 'Hohen', 'Stein', 'Rosen', 'Mark', 'Eichen', 'Bruck', 'Hafen'],
            ['dorf', 'burg', 'heim', 'feld', 'hausen', 'au', 'stadt', 'kirchen', 'berg', 'wald'],
        ),
        clubs: ['SV #', 'FC #', 'TSV #', 'Union #', 'SC #', 'VfR #', '# 04'],
    },
    gallavre: {
        name: 'Gallavre',
        lang: 'fr',
        adjective: 'Gallavrian',
        flag: FLAGS.gallavre,
        first: [
            'Étienne',
            'Lucien',
            'Mathis',
            'Bastien',
            'Théo',
            'Florian',
            'Rémi',
            'Gaspard',
            'Hugo',
            'Noé',
            'Clément',
            'Julien',
            'Yanis',
            'Aurélien',
            'Baptiste',
            'Maxence',
            'Corentin',
            'Loïc',
            'Adrien',
            'Sacha',
        ],
        last: glue(
            ['Beau', 'Mont', 'Dela', 'Fon', 'Ver', 'Char', 'Lac', 'Roche', 'Bel', 'Du', 'Gran', 'Lefe'],
            ['mont', 'rier', 'taine', 'court', 'reau', 'ville', 'lier', 'noir', 'fort', 'champ'],
        ),
        towns: glue(
            ['Saint-', 'Beau', 'Mont', 'Ville', 'Belle', 'Clair', 'Font', 'Roche', 'Mar', 'Val'],
            ['vallon', 'mont', 'lieu', 'rive', 'fleur', 'champ', 'pierre', 'bois', 'lac', 'sur-Mer'],
        ),
        clubs: ['Olympique #', 'AS #', 'Stade #', 'Racing Club #', '# FC', 'US #', 'En Avant #'],
    },
    lusmar: {
        name: 'Lusmar',
        lang: 'pt',
        adjective: 'Lusmarine',
        flag: FLAGS.lusmar,
        first: [
            'Joaquim',
            'Tiago',
            'Rodrigo',
            'Duarte',
            'Vitor',
            'Gonçalo',
            'Rafael',
            'Caio',
            'Thiago',
            'Bernardo',
            'Leandro',
            'Matheus',
            'Nuno',
            'Fábio',
            'Diogo',
            'Renan',
            'Igor',
            'Murilo',
            'André',
            'Otávio',
        ],
        last: glue(
            ['Carv', 'Ferr', 'Oliv', 'Mour', 'Pere', 'Sil', 'Barr', 'Tav', 'Coel', 'Mach', 'Rib', 'Fons'],
            ['eira', 'alho', 'ado', 'inha', 'es', 'ares', 'eto', 'ão', 'ira', 'oso'],
        ),
        towns: glue(
            ['Porto ', 'Vila ', 'Rio ', 'São ', 'Monte ', 'Praia ', 'Serra ', 'Ponta ', 'Vale ', 'Campo '],
            ['Alegre', 'Novo', 'Verde', 'Real', 'Bravo', 'Claro', 'Feliz', 'Formoso', 'Doce', 'Grande'],
        ),
        clubs: ['Esporte Clube #', 'Associação #', '# FC', 'Sport #', 'União #', 'Grêmio #', 'Atlético #'],
    },
    pampora: {
        name: 'Pampora',
        lang: 'es',
        adjective: 'Pamporan',
        flag: FLAGS.pampora,
        first: [
            'Santiago',
            'Matías',
            'Facundo',
            'Joaquín',
            'Lautaro',
            'Franco',
            'Emiliano',
            'Nahuel',
            'Agustín',
            'Bautista',
            'Gonzalo',
            'Ezequiel',
            'Thiago',
            'Valentín',
            'Rodrigo',
            'Lisandro',
            'Máximo',
            'Julián',
            'Tobías',
            'Ramiro',
        ],
        last: glue(
            ['Agu', 'Bar', 'Cab', 'Ech', 'Gar', 'Luc', 'Med', 'Ord', 'Pal', 'Sor', 'Vill', 'Zub'],
            ['ero', 'ilar', 'rera', 'everría', 'ay', 'ina', 'óñez', 'acios', 'ía', 'ales'],
        ),
        towns: glue(
            ['Cerro ', 'Paso ', 'Lomas ', 'Arroyo ', 'Sierra ', 'Laguna ', 'Llano ', 'Campo ', 'Barra ', 'Alto '],
            ['Verde', 'Blanco', 'Hondo', 'Grande', 'del Sur', 'Seco', 'Largo', 'Alegre', 'Bravo', 'Claro'],
        ),
        clubs: ['Club Atlético #', 'Deportivo #', '# Juniors', 'Independiente #', 'Estudiantes #', 'Sportivo #', 'Unión #'],
    },
    caledra: {
        name: 'Caledra',
        lang: 'en',
        adjective: 'Caledran',
        flag: FLAGS.caledra,
        first: [
            'Ewan',
            'Callum',
            'Rhys',
            'Owain',
            'Cillian',
            'Lachlan',
            'Niall',
            'Dougal',
            'Fergus',
            'Taran',
            'Ruairi',
            'Euan',
            'Gethin',
            'Kieran',
            'Angus',
            'Ronan',
            'Bryn',
            'Declan',
            'Iolo',
            'Finlay',
        ],
        last: glue(
            ['Mac', 'Mc', 'Dun', 'Glen', 'Kil', 'Bal', 'Strath', 'Ard', 'Inver', 'Car'],
            ['allan', 'kerrow', 'leod', 'more', 'ross', 'lachan', 'naird', 'bride', 'garth', 'morran'],
        ),
        towns: glue(
            ['Inver', 'Kil', 'Bal', 'Dun', 'Glen', 'Strath', 'Aber', 'Llan', 'Ard', 'Pen'],
            ['carra', 'mory', 'dree', 'loch', 'garth', 'nevis', 'ruthin', 'more', 'fyne', 'craig'],
        ),
        clubs: ['# Thistle', '# Albion', '# County', '# Academicals', '# Town', '# Athletic', '# Swifts'],
    },
    suvela: {
        name: 'Suvela',
        lang: 'fi',
        adjective: 'Suvelan',
        flag: FLAGS.suvela,
        first: [
            'Eero',
            'Joonas',
            'Aleksi',
            'Teemu',
            'Lauri',
            'Mikko',
            'Olli',
            'Ville',
            'Jari',
            'Antti',
            'Kalle',
            'Sami',
            'Tuomas',
            'Niko',
            'Juho',
            'Veikko',
            'Oskari',
            'Arttu',
            'Henri',
            'Paavo',
        ],
        last: glue(
            ['Lah', 'Vir', 'Kor', 'Mak', 'Hei', 'Nie', 'Salo', 'Kos', 'Rin', 'Jar', 'Tuo', 'Val'],
            ['tinen', 'tanen', 'pela', 'inen', 'kkinen', 'mi', 'nen', 'kela', 'ola', 'vonen'],
        ),
        towns: glue(
            ['Jarvi', 'Kuusi', 'Koivu', 'Mets', 'Salmi', 'Kallio', 'Ranta', 'Vaara', 'Harju', 'Lumi'],
            ['la', 'koski', 'vesi', 'niemi', 'maki', 'lahti', 'saari', 'joki', 'linna', 'vaara'],
        ),
        clubs: ['# PS', 'FC #', '# JK', '# Ilves', '# Palloseura', '# Pallo'],
    },
    varhely: {
        name: 'Varhely',
        lang: 'hu',
        adjective: 'Varhelyi',
        flag: FLAGS.varhely,
        first: [
            'Bence',
            'Zoltán',
            'Levente',
            'Máté',
            'Gergo',
            'Ákos',
            'Balázs',
            'Csaba',
            'Tamás',
            'Dani',
            'Bálint',
            'Marcell',
            'Dominik',
            'Kristóf',
            'Ádám',
            'Barnabás',
            'Zsolt',
            'László',
            'Norbert',
            'Szabolcs',
        ],
        last: glue(
            ['Kov', 'Sza', 'Nagy', 'Hor', 'Var', 'Tót', 'Bal', 'Fek', 'Mol', 'Ker', 'Szi', 'Pap'],
            ['ács', 'bó', 'váth', 'ga', 'ady', 'ai', 'ok', 'eti', 'nár', 'ész'],
        ),
        towns: glue(
            ['Szeg', 'Vár', 'Kis', 'Nagy', 'Fehér', 'Bala', 'Duna', 'Kér', 'Tisza', 'Hegy', 'Mezo'],
            ['hely', 'vár', 'falu', 'háza', 'vaszar', 'kút', 'telek', 'domb', 'szállás', 'patak'],
        ),
        clubs: ['# FC', '# SE', '# TE', 'Vasas #', 'Haladás #', '# AC'],
    },
    thalassa: {
        name: 'Thalassa',
        lang: 'gr',
        adjective: 'Thalassan',
        flag: FLAGS.thalassa,
        first: [
            'Nikos',
            'Giorgos',
            'Stavros',
            'Dimitris',
            'Kostas',
            'Yannis',
            'Petros',
            'Andreas',
            'Christos',
            'Manolis',
            'Vasilis',
            'Thanos',
            'Lefteris',
            'Spyros',
            'Alexis',
            'Markos',
            'Panos',
            'Ilias',
            'Fotis',
            'Tasos',
        ],
        last: glue(
            ['Pap', 'Kar', 'Ant', 'Ste', 'Dim', 'Vla', 'Kon', 'Geor', 'Mav', 'Hari', 'Lam', 'Zer'],
            ['adopoulos', 'idis', 'akis', 'ou', 'opoulos', 'atos', 'elis', 'iou', 'akos', 'alis'],
        ),
        towns: glue(
            ['Kal', 'Ag', 'Ner', 'Thes', 'Lim', 'Pyr', 'Hal', 'Kor', 'Mel', 'Ast', 'Elef'],
            ['ion', 'amata', 'ia', 'os', 'ados', 'ini', 'ari', 'eus', 'ena', 'ikos'],
        ),
        clubs: ['AE #', 'PAS #', 'Aris #', 'Ethnikos #', 'Asteras #', 'Atromitos #', 'Panionios #'],
    },
    anvara: {
        name: 'Anvara',
        lang: 'tr',
        adjective: 'Anvaran',
        flag: FLAGS.anvara,
        first: [
            'Emre',
            'Burak',
            'Kerem',
            'Mert',
            'Cenk',
            'Onur',
            'Selim',
            'Arda',
            'Tolga',
            'Baris',
            'Yusuf',
            'Efe',
            'Kaan',
            'Ozan',
            'Serkan',
            'Volkan',
            'Umut',
            'Alper',
            'Deniz',
            'Halil',
        ],
        last: glue(
            ['Yil', 'Kara', 'Demir', 'Ak', 'Ars', 'Kos', 'Özt', 'Çel', 'Ay', 'Tun', 'Gül', 'Erd'],
            ['maz', 'kaya', 'ci', 'dag', 'soy', 'tas', 'ürk', 'oglu', 'ik', 'er'],
        ),
        towns: glue(
            ['Ak', 'Kara', 'Yesil', 'Kizil', 'Bey', 'Deniz', 'Göl', 'Ova', 'Tas', 'Sari'],
            ['tepe', 'köy', 'dere', 'kent', 'pinar', 'ova', 'hisar', 'yurt', 'kale', 'bag'],
        ),
        clubs: ['#spor', '# SK', '# Genclik', '# Idmanyurdu', '# Belediyespor', '#gucu'],
    },
    qasira: {
        name: 'Qasira',
        lang: 'ar',
        adjective: 'Qasiri',
        flag: FLAGS.qasira,
        first: [
            'Karim',
            'Yassin',
            'Amir',
            'Samir',
            'Nabil',
            'Tarek',
            'Hakim',
            'Rami',
            'Bilal',
            'Omar',
            'Zaid',
            'Mehdi',
            'Ilyas',
            'Anas',
            'Faris',
            'Hamza',
            'Idris',
            'Khalil',
            'Nasser',
            'Walid',
        ],
        last: [
            'Haddad',
            'Mansour',
            'Saleh',
            'Nasri',
            'Amrani',
            'Benali',
            'Khatib',
            'Hamdan',
            'Rahmani',
            'Ziani',
            'Bakkali',
            'Toumi',
            'Darwish',
            'Fayed',
            'Jaziri',
            'Karimi',
            'Lahlou',
            'Masri',
            'Qadri',
            'Sabri',
            'Tazi',
            'Yousef',
            'Zaher',
            'Idrissi',
            'Hassani',
        ],
        towns: glue(
            ['Dar ', 'Wadi ', 'Ras ', 'Bab ', 'Ain ', 'Bir ', 'Qasr ', 'Tell ', 'Jebel ', 'Souk '],
            ['Hamra', 'Zahra', 'Salam', 'Noor', 'Kabir', 'Safa', 'Amal', 'Rima', 'Najm', 'Badr'],
        ),
        clubs: ['Al #', 'Ittihad #', 'Nahda #', '# SC', 'Shabab #', 'Najma #'],
    },
    kassara: {
        name: 'Kassara',
        lang: 'af',
        adjective: 'Kassaran',
        flag: FLAGS.kassara,
        first: [
            'Kofi',
            'Yaw',
            'Kwesi',
            'Emeka',
            'Chidi',
            'Tunde',
            'Seydou',
            'Moussa',
            'Ibrahim',
            'Amadou',
            'Sekou',
            'Oumar',
            'Kwabena',
            'Obinna',
            'Femi',
            'Lamine',
            'Babajide',
            'Mamadou',
            'Kelechi',
            'Adama',
        ],
        last: [
            'Mensah',
            'Owusu',
            'Asante',
            'Boateng',
            'Okafor',
            'Adeyemi',
            'Diallo',
            'Traoré',
            'Koné',
            'Ndiaye',
            'Sarr',
            'Okonkwo',
            'Appiah',
            'Danso',
            'Eze',
            'Bamba',
            'Camara',
            'Keita',
            'Osei',
            'Nwosu',
            'Diop',
            'Kanu',
            'Afolabi',
            'Sissoko',
            'Agyeman',
        ],
        towns: glue(
            ['Ako', 'Bon', 'Kum', 'Tam', 'Ade', 'Oko', 'Wa', 'Seko', 'Nya', 'Bama'],
            ['si', 'ndo', 'ma', 'koro', 'ba', 'le', 'ra', 'tu', 'wa', 'na'],
        ),
        clubs: ['# Stars', '# Eagles', '# Warriors', '# United', 'AS #', '# Rangers', 'Real #'],
    },
    kiyora: {
        name: 'Kiyora',
        lang: 'ja',
        adjective: 'Kiyoran',
        flag: FLAGS.kiyora,
        first: [
            'Haruto',
            'Ren',
            'Sota',
            'Yuto',
            'Kaito',
            'Daichi',
            'Riku',
            'Takumi',
            'Shota',
            'Kenji',
            'Hiroki',
            'Yuma',
            'Ryo',
            'Kosei',
            'Daiki',
            'Itsuki',
            'Sora',
            'Taiga',
            'Kazuki',
            'Hayato',
        ],
        last: glue(
            ['Taka', 'Naka', 'Yama', 'Ishi', 'Mori', 'Kawa', 'Hoshi', 'Fuji', 'Aki', 'Matsu', 'Ono', 'Sugi'],
            ['da', 'mura', 'moto', 'kawa', 'no', 'shima', 'zaki', 'hara', 'ta', 'gawa'],
        ),
        towns: glue(
            ['Taka', 'Naga', 'Yama', 'Ishi', 'Mori', 'Kawa', 'Hoshi', 'Fuji', 'Aki', 'Matsu'],
            ['saki', 'oka', 'hama', 'zawa', 'yama', 'ta', 'mura', 'shiro', 'nagi', 'tsu'],
        ),
        clubs: ['# FC', 'FC #', '# SC', '# Athletic', '# Kestrels', '# Rising'],
    },
    // South Korea: real towns and counties, invented clubs and players
    korea: {
        name: '대한민국',
        lang: 'ko',
        adjective: '한국',
        flag: FLAGS.korea,
        first: [
            '도윤', '서준', '시우', '하준', '지호', '준우', '지훈', '민재', '현우', '건우', '태현', '승우', '우진', '예준', '주원',
            '민준', '지후', '성민', '재윤', '동현', '준혁', '시윤', '유찬', '정우', '은우', '진우', '태민', '승민', '도현', '상현',
        ],
        last: ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '전'],
        towns: [
            '춘천', '원주', '강릉', '속초', '동해', '삼척', '태백', '홍천', '횡성', '영월', '평창', '정선', '철원', '화천', '양구', '인제', '양양',
            '청주', '충주', '제천', '보은', '옥천', '영동', '진천', '괴산', '음성', '단양', '천안', '공주', '보령', '아산', '서산', '논산', '당진',
            '금산', '부여', '서천', '청양', '홍성', '예산', '태안', '전주', '군산', '익산', '정읍', '남원', '김제', '완주', '진안', '무주', '장수',
            '임실', '순창', '고창', '부안', '목포', '여수', '순천', '나주', '광양', '담양', '곡성', '구례', '고흥', '보성', '화순', '장흥', '강진',
            '해남', '영암', '무안', '함평', '영광', '장성', '완도', '진도', '신안', '포항', '경주', '김천', '안동', '구미', '영주', '영천', '상주',
            '문경', '경산', '의성', '청송', '영양', '영덕', '청도', '고령', '성주', '칠곡', '예천', '봉화', '울진', '창원', '진주', '통영', '사천',
            '김해', '밀양', '거제', '양산', '의령', '함안', '창녕', '남해', '하동', '산청', '함양', '거창', '합천', '제주', '서귀포', '남양주',
            '가평', '양평', '여주', '이천', '안성', '평택', '파주', '포천', '연천', '동두천', '의정부', '양주', '구리', '하남',
            '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '수원', '성남', '고양', '용인', '부천', '안산', '안양', '화성', '시흥',
            '김포', '광명', '군포', '오산', '의왕', '과천',
        ],
        clubs: ['# 아틀레틱', '# 로버스', '# 레인저스', '# 스포츠클럽', '# 스트라이커스', '# 레이더스', '# 이글스'],
    },
};

/** Three-letter code for a town: initials for two-word names ("Cerro Verde" → CVE), else its first letters. */
export const shortCode = (place: string) => {
    if (/[가-힣]/.test(place)) return place.replace(/\s+/g, '').slice(0, 2);
    const words = place
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[\s-]+/)
        .map((w) => w.replace(/[^A-Za-z]/g, ''))
        .filter(Boolean);
    const code = words.length > 1 ? words[0]![0]! + words[1]!.slice(0, 2) : (words[0] ?? '').slice(0, 3);
    return code.toUpperCase();
};

export const NATIONS = Object.fromEntries(NATION_IDS.map((id) => [id, make(id, SPECS[id])])) as Record<NationId, Nation>;

export const nationOf = (id: string | undefined): Nation => NATIONS[(id ?? DEFAULT_NATION) as NationId] ?? NATIONS[DEFAULT_NATION];

/** A nationality for a player at a club in `home`: mostly local, `foreignShare` of the time from abroad. */
export const pickNationality = (rng: Rng, home: NationId, foreignShare: number): NationId =>
    rng.chance(foreignShare) ? rng.pick(NATION_IDS.filter((n) => n !== home)) : home;

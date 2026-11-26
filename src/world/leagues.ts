/**
 * What each nation calls its divisions, top flight first, in the style of its real-world
 * inspiration (without the sponsors' trademarks). Each tier has a full name and a short one for
 * tight spots (tabs, table cells).
 */
import type { NationId } from './nations';

type Tier = [name: string, short: string];

const LEAGUES: Record<NationId, Tier[]> = {
    // England
    highmarch: [
        ['Premier Division', 'Premier'],
        ['Championship', 'Champ.'],
        ['League One', 'Lg One'],
        ['League Two', 'Lg Two'],
        ['National League', 'National'],
    ],
    // Spain
    valdoria: [
        ['Primera División', '1ª Div'],
        ['Segunda División', '2ª Div'],
        ['Primera Federación', '1ª Fed'],
        ['Segunda Federación', '2ª Fed'],
        ['Tercera Federación', '3ª Fed'],
    ],
    // Norway
    nordhavn: [
        ['Eliteserien', 'Elite'],
        ['1. divisjon', '1. div'],
        ['2. divisjon', '2. div'],
        ['3. divisjon', '3. div'],
        ['4. divisjon', '4. div'],
    ],
    // Serbia
    zaravia: [
        ['Superliga', 'Super'],
        ['Prva liga', 'Prva'],
        ['Srpska liga', 'Srpska'],
        ['Zonska liga', 'Zonska'],
        ['Okružna liga', 'Okružna'],
    ],
    // Germany
    ostmark: [
        ['Meisterliga', 'Meister'],
        ['2. Meisterliga', '2. Meister'],
        ['3. Liga', '3. Liga'],
        ['Regionalliga', 'Regional'],
        ['Oberliga', 'Ober'],
    ],
    // France
    gallavre: [
        ['Première Ligue', 'Ligue 1'],
        ['Deuxième Ligue', 'Ligue 2'],
        ['National', 'Nat.'],
        ['National 2', 'Nat. 2'],
        ['National 3', 'Nat. 3'],
    ],
    // Brazil
    lusmar: [
        ['Série A', 'Série A'],
        ['Série B', 'Série B'],
        ['Série C', 'Série C'],
        ['Série D', 'Série D'],
        ['Estadual', 'Estadual'],
    ],
    // Argentina
    pampora: [
        ['Liga Profesional', 'Profesional'],
        ['Primera Nacional', 'Nacional'],
        ['Primera B', 'Prim. B'],
        ['Primera C', 'Prim. C'],
        ['Primera D', 'Prim. D'],
    ],
    // Scotland
    caledra: [
        ['Premiership', 'Prem.'],
        ['Championship', 'Champ.'],
        ['League One', 'Lg One'],
        ['League Two', 'Lg Two'],
        ['Highland League', 'Highland'],
    ],
    // Finland
    suvela: [
        ['Mestaruussarja', 'Mestaruus'],
        ['Ykkösliiga', 'Ykkösliiga'],
        ['Ykkönen', 'Ykkönen'],
        ['Kakkonen', 'Kakkonen'],
        ['Kolmonen', 'Kolmonen'],
    ],
    // Hungary
    varhely: [
        ['Nemzeti Bajnokság I', 'NB I'],
        ['Nemzeti Bajnokság II', 'NB II'],
        ['Nemzeti Bajnokság III', 'NB III'],
        ['Megyei I', 'Megyei I'],
        ['Megyei II', 'Megyei II'],
    ],
    // Greece
    thalassa: [
        ['Alpha Ethniki', 'Alpha'],
        ['Beta Ethniki', 'Beta'],
        ['Gamma Ethniki', 'Gamma'],
        ['Delta Ethniki', 'Delta'],
        ['Epsilon Ethniki', 'Epsilon'],
    ],
    // Turkey
    anvara: [
        ['Süper Lig', 'Süper'],
        ['1. Lig', '1. Lig'],
        ['2. Lig', '2. Lig'],
        ['3. Lig', '3. Lig'],
        ['Bölgesel Lig', 'Bölgesel'],
    ],
    // UAE
    qasira: [
        ['Dawri Al-Nukhba', 'Nukhba'],
        ['Al-Darajah Al-Ula', 'Al-Ula'],
        ['Al-Darajah Al-Thaniya', 'Al-Thaniya'],
        ['Al-Darajah Al-Thalitha', 'Al-Thalitha'],
        ['Al-Darajah Al-Rabi’a', 'Al-Rabi’a'],
    ],
    // Ghana
    kassara: [
        ['Premier League', 'Premier'],
        ['Division One', 'Div One'],
        ['Division Two', 'Div Two'],
        ['Regional League', 'Regional'],
        ['District League', 'District'],
    ],
    // Japan
    kiyora: [
        ['Ichibu League', 'Ichibu'],
        ['Nibu League', 'Nibu'],
        ['Sanbu League', 'Sanbu'],
        ['Yonbu League', 'Yonbu'],
        ['Chiiki League', 'Chiiki'],
    ],
    // South Korea
    korea: [
        ['슈퍼리그', '슈퍼'],
        ['챔피언십', '챔피'],
        ['내셔널리그', '내셔널'],
        ['지역리그', '지역'],
        ['아마추어리그', '아마'],
    ],
};

/** A division's name in its nation ("Regionalliga"); deeper tiers than listed fall back to numbers. */
export const leagueName = (nation: NationId, tier: number) => LEAGUES[nation][tier]?.[0] ?? `${String(tier + 1)}부 리그`;

/** The short form for tabs and table cells ("Regional"). */
export const leagueShort = (nation: NationId, tier: number) => LEAGUES[nation][tier]?.[1] ?? `${String(tier + 1)}부`;

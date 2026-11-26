/**
 * The player's own songs on the radio, next to the station's.
 *
 * Desktop: every audio file in a "Tackle Tactics" folder in the system Music folder
 * (src-tauri/src/lib.rs: music_folder, list_music, read_song, open_music_folder). The folder is
 * scanned at startup and on Rescan; a song's bytes are read only when it plays.
 *
 * Browser: songs added with a file picker, kept in the game's IndexedDB (this browser and site only).
 */
import { grain } from '@grainular/grains';
import { idb, SONGS } from '../meta/storage';
import { isDesktop } from './desktop';
import type { Track } from './radio';

/** Files the radio tries to play. What actually plays depends on the platform's web engine. */
export const SONG_EXTS = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'aif', 'aiff'];

/** The player's songs (empty until `initMyMusic` ran). */
export const myTracks = grain<Track[]>([]);
/** Desktop: where the folder is, for the settings screen. */
export const musicFolder = grain('');

const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args);

/** "03 - Artist - Title.mp3" → the title and artist, like the station's songs. */
const parseName = (file: string) => {
    const name = file
        .replace(/\.[^.]+$/, '')
        .replace(/_/g, ' ')
        .replace(/^\d{1,3}\s*[-.)]?\s+/, '')
        .trim();
    const parts = name.split(/\s+[-–—]\s+/);
    return parts.length >= 2 ? { artist: parts[0]!.trim(), title: parts.slice(1).join(' - ').trim() } : { artist: null, title: name };
};

const toTrack = (id: string, file: string): Track => ({ url: '', ...parseName(file), mine: id });

/** Read the folder (desktop) or the stored songs (browser). */
export const initMyMusic = async () => {
    try {
        if (isDesktop) {
            musicFolder.set(await invoke<string>('music_folder'));
            const names = await invoke<string[]>('list_music');
            myTracks.set(names.map((n) => toTrack(n, n)));
        } else if (typeof indexedDB !== 'undefined') {
            const keys = (await idb<IDBValidKey[]>('readonly', (s) => s.getAllKeys(), SONGS)) as string[];
            myTracks.set(keys.sort().map((k) => toTrack(k, k)));
        }
    } catch (e) {
        console.error('곡을 읽을 수 없습니다', e);
    }
};

export const rescan = initMyMusic;

/** Desktop: show the folder in Finder / Explorer. */
export const openMusicFolder = () => invoke('open_music_folder');

/** Browser: keep picked files (same name replaces). Returns the names it skipped. */
export const addSongs = async (files: FileList | File[]) => {
    const skipped: string[] = [];
    for (const f of Array.from(files)) {
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        if (!SONG_EXTS.includes(ext)) {
            skipped.push(f.name);
            continue;
        }
        await idb('readwrite', (s) => s.put(f.slice(0, f.size, f.type), f.name), SONGS);
    }
    await initMyMusic();
    return skipped;
};

/** Browser: forget a stored song. */
export const removeSong = async (t: Track) => {
    if (!t.mine || isDesktop) return;
    await idb('readwrite', (s) => s.delete(t.mine!), SONGS);
    await initMyMusic();
};

// one object URL at a time: a song is a few MB
let current: string | null = null;
const fromMemory = (blob: Blob) => {
    if (current) URL.revokeObjectURL(current);
    current = URL.createObjectURL(blob);
    return current;
};

/**
 * Linux desktop: WebKitGTK streams media from the app's own tauri:// URLs unreliably (the station
 * stayed silent), so a station song is read whole and played from memory like the player's own.
 */
export const playFromMemory = isDesktop && /Linux/.test(navigator.userAgent);

const fetchBlob = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${String(res.status)} for ${url}`);
    return res.blob();
};
/** The next station song, read while the current one plays, so the change is instant. */
let ahead: { url: string; blob: Promise<Blob> } | null = null;

export const preloadStation = (t: Track | undefined) => {
    if (!playFromMemory || !t || t.mine || ahead?.url === t.url) return;
    const blob = fetchBlob(t.url);
    blob.catch(() => undefined); // a failed preload is retried when the song comes up
    ahead = { url: t.url, blob };
};

export const stationUrl = async (t: Track): Promise<string> => {
    const blob = ahead?.url === t.url ? ahead.blob : fetchBlob(t.url);
    if (ahead?.url === t.url) ahead = null;
    return fromMemory(await blob);
};

/** Where to play one of the player's songs from (loads it now). */
export const songUrl = async (t: Track): Promise<string> => {
    const blob = isDesktop
        ? new Blob([await invoke<ArrayBuffer>('read_song', { name: t.mine })])
        : await idb<Blob | undefined>('readonly', (s) => s.get(t.mine!), SONGS);
    if (!blob) throw new Error(`곡을 찾을 수 없음: ${t.mine}`);
    return fromMemory(blob);
};

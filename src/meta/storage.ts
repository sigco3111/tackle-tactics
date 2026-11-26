/**
 * The one career save slot.
 *
 * Desktop (Tauri): a JSON file in the app's data folder, written by Rust (src-tauri/src/lib.rs)
 * atomically (temp file + rename) with the previous save kept as `career.json.bak`; a damaged
 * file falls back to the backup.
 *
 * Browser: IndexedDB, gzip-compressed. A full-world career is several MB of JSON, over the ~5 MB
 * localStorage allows; compressed it is a few hundred KB. An older localStorage save moves over once.
 *
 * Either way the save is read once at startup (`initStorage`), so reads stay synchronous; writes
 * are queued so the newest one always wins.
 */
const KEY = 'tackle-tactics:career';
const desktop = typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;

let cache: string | null = null;
let writing: Promise<void> = Promise.resolve();
let pending: string | null | undefined;

const invoke = async <T>(cmd: string, args?: Record<string, unknown>) => (await import('@tauri-apps/api/core')).invoke<T>(cmd, args);

// ------------------------------------------------------------------ browser: IndexedDB + gzip

const DB = 'tackle-tactics';
const STORE = 'saves';
/** The player's own radio songs in the browser build (src/ui/myMusic.ts). */
export const SONGS = 'songs';

const openDb = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB, 2);
        req.onupgradeneeded = () => {
            for (const name of [STORE, SONGS]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

/** One request in its own transaction on a store of the game's database. */
export const idb = async <T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>, store = STORE) => {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(store, mode);
            const req = run(tx.objectStore(store));
            tx.oncomplete = () => resolve(req.result);
            tx.onerror = tx.onabort = () => reject(tx.error ?? req.error);
        });
    } finally {
        db.close();
    }
};

const gzip = (text: string) => new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
const gunzip = (blob: Blob) => new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();

const browserRead = async (): Promise<string | null> => {
    const blob = await idb<Blob | undefined>('readonly', (s) => s.get(KEY));
    return blob ? gunzip(blob) : null;
};
const browserWrite = async (data: string | null) => {
    if (data === null) await idb('readwrite', (s) => s.delete(KEY));
    else {
        const blob = await gzip(data);
        await idb('readwrite', (s) => s.put(blob, KEY));
    }
};

/** Whether the browser has IndexedDB at all (if not, fall back to localStorage). */
let idbOk = !desktop && typeof indexedDB !== 'undefined';

// ------------------------------------------------------------------ the slot

/** Load the save once at startup (moving an older localStorage save into the new home once). */
export const initStorage = async () => {
    try {
        cache = desktop ? await invoke<string | null>('read_save') : idbOk ? await browserRead() : localStorage.getItem(KEY);
        if (cache === null && (desktop || idbOk)) {
            const legacy = localStorage.getItem(KEY);
            if (legacy) {
                if (desktop) await invoke('write_save', { data: legacy });
                else await browserWrite(legacy);
                cache = legacy;
                localStorage.removeItem(KEY);
            }
        }
    } catch (e) {
        console.error('세이브를 읽을 수 없습니다', e);
        if (!desktop && idbOk) {
            // a browser without a working IndexedDB (some private modes): plain localStorage
            idbOk = false;
            try {
                cache = localStorage.getItem(KEY);
            } catch {
                cache = null;
            }
        }
    }
    // closing the tab mid-write would lose the newest save: ask first
    if (!desktop) addEventListener('beforeunload', (e) => pending !== undefined && e.preventDefault());
};

export const readSave = (): string | null => cache;

const flush = () => {
    writing = writing.then(async () => {
        const data = pending;
        if (data === undefined) return;
        try {
            if (desktop) {
                if (data === null) await invoke('delete_save');
                else await invoke('write_save', { data });
            } else if (idbOk) await browserWrite(data);
            else if (data === null) localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, data);
        } catch (e) {
            console.error('세이브를 저장할 수 없습니다', e);
        } finally {
            if (pending === data) pending = undefined;
        }
    });
};

export const writeSave = (data: string): boolean => {
    cache = data;
    pending = data;
    flush();
    return true;
};

export const deleteSave = () => {
    cache = null;
    pending = null;
    flush();
};

/** Resolves once every queued save write has been stored (call before quitting). */
export const whenSaved = () => writing;

/** Where the save lives, for the settings screen. */
export const saveLocation = async (): Promise<string> =>
    desktop ? invoke<string>('save_path') : '브라우저 저장소 (이 브라우저와 사이트에서만 유효합니다. 가끔 백업을 내보내세요)';

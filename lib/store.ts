/**
 * A tiny key-value store on IndexedDB, for the large, rarely written things: playlist copies, feed drafts,
 * lenses and cached judgments. localStorage caps out near 5 MB, which a few thousand liked videos exceed.
 * Small, frequently written progress stays in localStorage (lib/library.ts).
 */

const DB = "jev";
const STORE = "kv";

let db: Promise<IDBDatabase> | undefined;

function open() {
  db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return db;
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) {
  return open().then((database) => new Promise<T>((resolve, reject) => {
    const request = act(database.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

export type StoreKey = "library" | "feeds" | "lenses" | "judgments";

/** Resolves undefined when nothing is stored or IndexedDB is unavailable. */
export const readStore = (key: StoreKey) => typeof indexedDB === "undefined"
  ? Promise.resolve(undefined)
  : run<unknown>("readonly", (store) => store.get(key)).catch(() => undefined);

/** Writes are fire-and-forget; a failed write keeps the previous copy. */
export const writeStore = (key: StoreKey, value: unknown) => {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return run("readwrite", (store) => store.put(value, key)).then(() => undefined, () => undefined);
};

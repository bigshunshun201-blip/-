(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.RocoDataStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function create(options = {}) {
    const dbName = options.dbName || "roco-shortdrama-studio";
    const storeName = options.storeName || "workspace";
    const indexedDb = options.indexedDb === undefined ? globalThis.indexedDB : options.indexedDb;
    const fallbackStorage = options.fallbackStorage === undefined ? globalThis.localStorage : options.fallbackStorage;
    let dbPromise;
    const writeChains = new Map();

    function openDb() {
      if (!indexedDb) return Promise.reject(new Error("IndexedDB unavailable"));
      if (dbPromise) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        const request = indexedDb.open(dbName, 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      });
      return dbPromise;
    }

    async function readIndexedDb(key) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
      });
    }

    async function writeIndexedDb(key, value) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put(value, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error("IndexedDB write failed"));
        transaction.onabort = () => reject(transaction.error || new Error("IndexedDB write aborted"));
      });
    }

    function readFallback(key) {
      const raw = fallbackStorage?.getItem(key);
      return raw ? JSON.parse(raw) : undefined;
    }

    async function get(key) {
      try {
        const stored = await readIndexedDb(key);
        if (stored !== undefined) return stored;
        const legacy = readFallback(key);
        if (legacy !== undefined) await set(key, legacy);
        return legacy;
      } catch (_) {
        return readFallback(key);
      }
    }

    function set(key, value) {
      const snapshot = typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
      const previous = writeChains.get(key) || Promise.resolve();
      const next = previous.catch(() => {}).then(async () => {
        try {
          await writeIndexedDb(key, snapshot);
          fallbackStorage?.removeItem?.(key);
          return "indexeddb";
        } catch (indexedDbError) {
          if (!fallbackStorage) throw indexedDbError;
          fallbackStorage.setItem(key, JSON.stringify(snapshot));
          return "localStorage";
        }
      });
      writeChains.set(key, next);
      return next;
    }

    return { get, set };
  }

  return { create };
});

import type { AppState } from '../types';
import {
  createLocalPersistenceKey,
  decryptPersistedState,
  encryptPersistedState,
  isPersistedStateEnvelope,
} from './localPersistence';

const DB_NAME = 'competitor-org-mapping';
const STATE_STORE_NAME = 'state';
const META_STORE_NAME = 'meta';
const DB_VERSION = 2;
const STATE_KEY = 'current';
const PERSISTENCE_KEY = 'persistence-key';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE_NAME)) {
        db.createObjectStore(STATE_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readStoreValue<T>(store: IDBObjectStore, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function writeStoreValue(store: IDBObjectStore, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteStoreValue(store: IDBObjectStore, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function readPersistenceKey(db: IDBDatabase): Promise<CryptoKey | undefined> {
  const transaction = db.transaction(META_STORE_NAME, 'readonly');
  return readStoreValue<CryptoKey>(transaction.objectStore(META_STORE_NAME), PERSISTENCE_KEY);
}

export async function loadPersistedState(): Promise<AppState | null> {
  const db = await openDatabase();
  const transaction = db.transaction(STATE_STORE_NAME, 'readonly');
  const stateStore = transaction.objectStore(STATE_STORE_NAME);
  const persisted = await readStoreValue<unknown>(stateStore, STATE_KEY);
  if (!persisted) return null;

  if (!isPersistedStateEnvelope(persisted)) {
    return persisted as AppState;
  }

  const key = await readPersistenceKey(db);
  if (!key) {
    throw new Error('本地缓存缺少解密密钥。请重新导入项目包，或清空浏览器本地数据后重试。');
  }

  try {
    return await decryptPersistedState(persisted, key);
  } catch (error) {
    throw new Error(
      `本地缓存无法解密：${error instanceof Error ? error.message : String(error)}。请导入加密项目包恢复。`,
    );
  }
}

export async function persistState(state: AppState): Promise<void> {
  const db = await openDatabase();
  let key = await readPersistenceKey(db);
  if (!key) {
    key = await createLocalPersistenceKey();
  }

  const envelope = await encryptPersistedState(state, key);
  const transaction = db.transaction([STATE_STORE_NAME, META_STORE_NAME], 'readwrite');
  const stateStore = transaction.objectStore(STATE_STORE_NAME);
  const metaStore = transaction.objectStore(META_STORE_NAME);

  await Promise.all([
    writeStoreValue(stateStore, STATE_KEY, envelope),
    writeStoreValue(metaStore, PERSISTENCE_KEY, key),
  ]);
}

export async function clearPersistedState(): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction([STATE_STORE_NAME, META_STORE_NAME], 'readwrite');
  const stateStore = transaction.objectStore(STATE_STORE_NAME);
  const metaStore = transaction.objectStore(META_STORE_NAME);

  await Promise.all([
    deleteStoreValue(stateStore, STATE_KEY),
    deleteStoreValue(metaStore, PERSISTENCE_KEY),
  ]);
}

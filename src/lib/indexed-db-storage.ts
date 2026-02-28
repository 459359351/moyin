// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * File Storage Adapter for Zustand
 * Uses Electron's file system for unlimited storage
 * Falls back to localStorage in browser
 */

import type { StateStorage } from 'zustand/middleware';

// Type declarations for the fileStorage API exposed by preload
declare global {
  interface Window {
    fileStorage?: {
      getItem: (key: string) => Promise<string | null>;
      setItem: (key: string, value: string) => Promise<boolean>;
      removeItem: (key: string) => Promise<boolean>;
      exists: (key: string) => Promise<boolean>;
      listKeys: (prefix: string) => Promise<string[]>;
      removeDir: (prefix: string) => Promise<boolean>;
    };
  }
}

const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!window.fileStorage;
};

// Check if data has meaningful content (not just empty state)
const hasRichData = (jsonStr: string | null): boolean => {
  if (!jsonStr) return false;
  try {
    const data = JSON.parse(jsonStr);
    const state = data.state || data;

    // Check common store patterns for meaningful data
    if (state.projects && Array.isArray(state.projects) && state.projects.length > 1) return true;
    if (state.splitScenes && Array.isArray(state.splitScenes) && state.splitScenes.length > 0) return true;
    if (state.scenes && Array.isArray(state.scenes) && state.scenes.length > 0) return true;
    if (state.episodes && Array.isArray(state.episodes) && state.episodes.length > 0) return true;
    if (state.characters && Array.isArray(state.characters) && state.characters.length > 0) return true;
    if (state.media && Array.isArray(state.media) && state.media.length > 0) return true;

    // For director store, check nested project data
    if (state.projects && typeof state.projects === 'object') {
      for (const projectId of Object.keys(state.projects)) {
        const proj = state.projects[projectId];
        if (proj.splitScenes && proj.splitScenes.length > 0) return true;
        if (proj.screenplay) return true;
      }
    }

    // Check data size as fallback (more than 1KB likely has real data)
    return jsonStr.length > 1000;
  } catch {
    return jsonStr.length > 1000;
  }
};

export const fileStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    console.log(`[Storage] getItem: ${name}, isElectron: ${isElectron()}`);
    if (isElectron()) {
      try {
        // Get data from all sources
        const fileData = await window.fileStorage!.getItem(name);
        const localData = localStorage.getItem(name);
        let idbData: string | null = null;
        try {
          idbData = await getFromIndexedDB(name);
        } catch (e) {
          // IndexedDB not available
        }

        console.log(`[Storage] Data sizes for ${name}: file=${fileData?.length || 0}, local=${localData?.length || 0}, idb=${idbData?.length || 0}`);

        // Determine which data source has the richest data
        const fileHasData = hasRichData(fileData);
        const localHasData = hasRichData(localData);
        const idbHasData = hasRichData(idbData);

        console.log(`[Storage] Rich data check for ${name}: file=${fileHasData}, local=${localHasData}, idb=${idbHasData}`);

        // Priority: localStorage > IndexedDB > file (for migration)
        // If localStorage or IndexedDB has richer data, migrate it
        if (localHasData && !fileHasData) {
          console.log(`[Storage] Migrating ${name} from localStorage to file storage (richer data)...`);
          await window.fileStorage!.setItem(name, localData!);
          localStorage.removeItem(name);
          console.log(`[Storage] Migration complete for ${name}`);
          return localData;
        }

        if (idbHasData && !fileHasData && !localHasData) {
          console.log(`[Storage] Migrating ${name} from IndexedDB to file storage (richer data)...`);
          await window.fileStorage!.setItem(name, idbData!);
          await removeFromIndexedDB(name);
          console.log(`[Storage] Migration complete for ${name}`);
          return idbData;
        }

        // Clean up old data if file storage has the data
        if (fileHasData) {
          if (localData) {
            console.log(`[Storage] Cleaning up localStorage for ${name}`);
            localStorage.removeItem(name);
          }
          if (idbData) {
            console.log(`[Storage] Cleaning up IndexedDB for ${name}`);
            await removeFromIndexedDB(name);
          }
          return fileData;
        }

        // Return whatever we have
        return fileData || localData || idbData || null;
      } catch (error) {
        console.error('File storage getItem error:', error);
      }
    }
    // Browser mode: try IndexedDB first (unlimited storage), then localStorage (legacy migration)
    try {
      const idbData = await getFromIndexedDB(name);
      if (idbData) return idbData;
    } catch {
      // IndexedDB not available
    }
    // Check localStorage for legacy data and migrate to IndexedDB
    const localData = localStorage.getItem(name);
    if (localData) {
      console.log(`[Storage] Migrating ${name} from localStorage to IndexedDB (browser mode)...`);
      try {
        await saveToIndexedDB(name, localData);
        localStorage.removeItem(name);
        console.log(`[Storage] Browser migration complete for ${name}`);
      } catch {
        // Migration failed, still return the data
      }
    }
    return localData;
  },

  setItem: async (name: string, value: string): Promise<void> => {
    console.log(`[Storage] setItem: ${name}, size: ${value.length} chars, isElectron: ${isElectron()}`);
    if (isElectron()) {
      try {
        const result = await window.fileStorage!.setItem(name, value);
        console.log(`[Storage] File save result for ${name}:`, result);
        return;
      } catch (error) {
        console.error('[Storage] File storage setItem error:', error);
      }
    }
    // Browser mode: use IndexedDB (no 5MB limit like localStorage)
    try {
      await saveToIndexedDB(name, value);
      // Clean up localStorage if data was migrated
      try { localStorage.removeItem(name); } catch { }
    } catch (error) {
      console.error('[Storage] IndexedDB setItem error, trying localStorage:', error);
      // Last resort: try localStorage (may fail for large data)
      try {
        localStorage.setItem(name, value);
      } catch (lsError) {
        console.error('[Storage] localStorage setItem also failed (QuotaExceeded):', lsError);
      }
    }
  },

  removeItem: async (name: string): Promise<void> => {
    if (isElectron()) {
      try {
        await window.fileStorage!.removeItem(name);
        return;
      } catch (error) {
        console.error('File storage removeItem error:', error);
      }
    }
    // Browser mode: clean up from both IndexedDB and localStorage
    try { await removeFromIndexedDB(name); } catch { }
    try { localStorage.removeItem(name); } catch { }
  },
};

// Helper: open IndexedDB with auto-creation of object store
const openIDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    try {
      const request = indexedDB.open('moyin-creator-db');
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('zustand-storage')) {
          db.createObjectStore('zustand-storage');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // If the DB was created by another module without the 'zustand-storage' store,
        // we need to close and reopen with a bumped version to trigger onupgradeneeded.
        if (!db.objectStoreNames.contains('zustand-storage')) {
          const currentVersion = db.version;
          db.close();
          const upgradeRequest = indexedDB.open('moyin-creator-db', currentVersion + 1);
          upgradeRequest.onerror = () => reject(upgradeRequest.error);
          upgradeRequest.onupgradeneeded = () => {
            const upgradeDb = upgradeRequest.result;
            if (!upgradeDb.objectStoreNames.contains('zustand-storage')) {
              upgradeDb.createObjectStore('zustand-storage');
            }
          };
          upgradeRequest.onsuccess = () => resolve(upgradeRequest.result);
        } else {
          resolve(db);
        }
      };
    } catch (e) {
      reject(e);
    }
  });
};

// Helper to get data from IndexedDB
const getFromIndexedDB = (name: string): Promise<string | null> => {
  return new Promise(async (resolve) => {
    try {
      const db = await openIDB();
      if (!db.objectStoreNames.contains('zustand-storage')) {
        db.close();
        resolve(null);
        return;
      }
      const transaction = db.transaction('zustand-storage', 'readonly');
      const store = transaction.objectStore('zustand-storage');
      const getRequest = store.get(name);
      getRequest.onerror = () => { db.close(); resolve(null); };
      getRequest.onsuccess = () => { db.close(); resolve(getRequest.result ?? null); };
    } catch {
      resolve(null);
    }
  });
};

// Helper to save data to IndexedDB
const saveToIndexedDB = (name: string, value: string): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    try {
      const db = await openIDB();
      if (!db.objectStoreNames.contains('zustand-storage')) {
        db.close();
        reject(new Error('zustand-storage object store not found after openIDB'));
        return;
      }
      const transaction = db.transaction('zustand-storage', 'readwrite');
      const store = transaction.objectStore('zustand-storage');
      const putRequest = store.put(value, name);
      putRequest.onerror = () => { db.close(); reject(putRequest.error); };
      putRequest.onsuccess = () => { db.close(); resolve(); };
    } catch (e) {
      reject(e);
    }
  });
};

const removeFromIndexedDB = (name: string): Promise<void> => {
  return new Promise(async (resolve) => {
    try {
      const db = await openIDB();
      if (!db.objectStoreNames.contains('zustand-storage')) {
        db.close();
        resolve();
        return;
      }
      const transaction = db.transaction('zustand-storage', 'readwrite');
      const store = transaction.objectStore('zustand-storage');
      store.delete(name);
      db.close();
      resolve();
    } catch {
      resolve();
    }
  });
};

// Migration helper (kept for backward compatibility, but migration now happens in getItem)
export const migrateFromLocalStorage = async (_key: string): Promise<void> => {
  // Migration now happens automatically in fileStorage.getItem
};

// For backward compatibility
export const indexedDBStorage = fileStorage;

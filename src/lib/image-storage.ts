// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * Image Storage Utility
 * Handles saving and loading images via Electron IPC
 */

// Type declarations for the imageStorage API exposed by preload
declare global {
  interface Window {
    imageStorage?: {
      saveImage: (url: string, category: string, filename: string) => Promise<{ success: boolean; localPath?: string; error?: string }>;
      getImagePath: (localPath: string) => Promise<string | null>;
      deleteImage: (localPath: string) => Promise<boolean>;
      readAsBase64: (localPath: string) => Promise<{ success: boolean; base64?: string; mimeType?: string; size?: number; error?: string }>;
      getAbsolutePath: (localPath: string) => Promise<string | null>;
    };
  }
}

export type ImageCategory = 'characters' | 'scenes' | 'shots' | 'wardrobe' | 'videos';

// ==================== IndexedDB Image Cache (Browser Mode) ====================

const IDB_NAME = 'moyin-image-cache';
const IDB_STORE = 'images';
let idbInstance: IDBDatabase | null = null;

/**
 * Open (or reuse) the image-cache IndexedDB.
 */
function openImageCacheDB(): Promise<IDBDatabase> {
  if (idbInstance) return Promise.resolve(idbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    request.onsuccess = () => {
      idbInstance = request.result;
      resolve(idbInstance);
    };
  });
}

/**
 * Save an image (data URL, blob URL, or remote URL) into browser IndexedDB.
 * Returns an `idb-image://{key}` identifier.
 */
async function saveImageToBrowserStorage(url: string, key: string): Promise<string> {
  try {
    let blob: Blob;
    if (url.startsWith('data:')) {
      // Convert data URL to Blob
      const response = await fetch(url);
      blob = await response.blob();
    } else if (url.startsWith('blob:')) {
      const response = await fetch(url);
      blob = await response.blob();
    } else {
      // Remote URL - fetch and store
      const response = await fetch(url);
      blob = await response.blob();
    }

    const db = await openImageCacheDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(blob, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return `idb-image://${key}`;
  } catch (error) {
    console.error('[ImageCache] Failed to save image to IndexedDB:', error);
    return url; // Fallback to original URL
  }
}

/**
 * Resolve an `idb-image://{key}` URL to an object URL for display.
 * Returns null if not found or not an idb-image URL.
 */
export async function resolveIdbImageUrl(idbUrl: string): Promise<string | null> {
  if (!idbUrl.startsWith('idb-image://')) return null;
  const key = idbUrl.replace('idb-image://', '');
  try {
    const db = await openImageCacheDB();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const request = tx.objectStore(IDB_STORE).get(key);
      request.onsuccess = () => resolve(request.result as Blob | undefined);
      request.onerror = () => reject(request.error);
    });
    if (blob) {
      return URL.createObjectURL(blob);
    }
    return null;
  } catch (error) {
    console.error('[ImageCache] Failed to resolve idb-image:', error);
    return null;
  }
}

/**
 * Delete an image from browser IndexedDB cache.
 */
export async function deleteIdbImage(idbUrl: string): Promise<boolean> {
  if (!idbUrl.startsWith('idb-image://')) return false;
  const key = idbUrl.replace('idb-image://', '');
  try {
    const db = await openImageCacheDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if running in Electron environment
 */
export const isElectron = (): boolean => {
  return typeof window !== 'undefined' && !!window.imageStorage;
};

/**
 * Save an image from URL to local storage
 * @param url - The URL of the image to save
 * @param category - Category folder (characters, scenes, shots, wardrobe)
 * @param filename - Optional filename hint
 * @returns Local path (local-image://...) or original URL if not in Electron
 */
export async function saveImageToLocal(
  url: string,
  category: ImageCategory,
  filename: string = 'image.png'
): Promise<string> {
  // If already a persistent URL, return as-is
  if (url.startsWith('local-image://') || url.startsWith('idb-image://')) {
    return url;
  }

  // Electron mode: use native file system
  if (isElectron()) {
    try {
      const result = await window.imageStorage!.saveImage(url, category, filename);
      if (result.success && result.localPath) {
        console.log(`Image saved locally: ${result.localPath}`);
        return result.localPath;
      } else {
        console.error('Failed to save image:', result.error);
        return url;
      }
    } catch (error) {
      console.error('Error saving image:', error);
      return url;
    }
  }

  // Browser mode: save to IndexedDB
  const key = `${category}/${filename.replace(/\.\w+$/, '')}_${Date.now()}`;
  return saveImageToBrowserStorage(url, key);
}

/**
 * Resolve a local-image:// path to an actual file:// URL
 * Falls back to the original path if not a local-image path or not in Electron
 */
export async function resolveImagePath(path: string): Promise<string> {
  // If not a local-image path, return as-is
  if (!path.startsWith('local-image://')) {
    return path;
  }

  // If not in Electron, can't resolve local paths
  if (!isElectron()) {
    console.warn('Not running in Electron, cannot resolve local image path');
    return path;
  }

  try {
    const resolvedPath = await window.imageStorage!.getImagePath(path);
    return resolvedPath || path;
  } catch (error) {
    console.error('Error resolving image path:', error);
    return path;
  }
}

/**
 * Delete a locally stored image
 */
export async function deleteLocalImage(localPath: string): Promise<boolean> {
  if (!localPath.startsWith('local-image://')) {
    return false;
  }

  if (!isElectron()) {
    return false;
  }

  try {
    return await window.imageStorage!.deleteImage(localPath);
  } catch (error) {
    console.error('Error deleting image:', error);
    return false;
  }
}

/**
 * Read a local image as base64 (for AI API calls like video generation)
 * Works with local-image://, idb-image://, file://, or absolute paths
 * @returns base64 data URL (e.g., "data:image/png;base64,...")
 */
export async function readImageAsBase64(imagePath: string): Promise<string | null> {
  // If already a data URL, return as-is
  if (imagePath.startsWith('data:')) {
    return imagePath;
  }

  // If it's a remote URL, fetch and convert
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    try {
      const response = await fetch(imagePath);
      const blob = await response.blob();
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (error) {
      console.error('Error fetching remote image:', error);
      return null;
    }
  }

  // Browser mode: resolve idb-image:// from IndexedDB
  if (imagePath.startsWith('idb-image://')) {
    const key = imagePath.replace('idb-image://', '');
    try {
      const db = await openImageCacheDB();
      const blob = await new Promise<Blob | undefined>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const request = tx.objectStore(IDB_STORE).get(key);
        request.onsuccess = () => resolve(request.result as Blob | undefined);
        request.onerror = () => reject(request.error);
      });
      if (blob) {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        });
      }
      return null;
    } catch (error) {
      console.error('Error reading idb-image as base64:', error);
      return null;
    }
  }

  // For local images, use Electron IPC
  if (!isElectron()) {
    console.warn('Not running in Electron, cannot read local image');
    return null;
  }

  try {
    const result = await window.imageStorage!.readAsBase64(imagePath);
    if (result.success && result.base64) {
      return result.base64;
    }
    console.error('Failed to read image:', result.error);
    return null;
  } catch (error) {
    console.error('Error reading image as base64:', error);
    return null;
  }
}

/**
 * Get the absolute file path for a local-image:// URL
 * Useful for local video generation tools like FFmpeg
 */
export async function getAbsoluteImagePath(localPath: string): Promise<string | null> {
  if (!localPath.startsWith('local-image://')) {
    // Already an absolute path or other format
    return localPath;
  }

  if (!isElectron()) {
    console.warn('Not running in Electron, cannot get absolute path');
    return null;
  }

  try {
    return await window.imageStorage!.getAbsolutePath(localPath);
  } catch (error) {
    console.error('Error getting absolute path:', error);
    return null;
  }
}

/**
 * Save a video from URL to local storage
 * @param url - The URL of the video to save
 * @param filename - Optional filename hint
 * @returns Local path (local-image://videos/...) or original URL if not in Electron
 */
export async function saveVideoToLocal(
  url: string,
  filename: string = 'video.mp4'
): Promise<string> {
  // If not in Electron or already local, return as-is
  if (!isElectron() || url.startsWith('local-image://') || url.startsWith('data:')) {
    return url;
  }

  try {
    const result = await window.imageStorage!.saveImage(url, 'videos', filename);

    if (result.success && result.localPath) {
      console.log(`Video saved locally: ${result.localPath}`);
      return result.localPath;
    } else {
      console.error('Failed to save video:', result.error);
      return url;
    }
  } catch (error) {
    console.error('Error saving video:', error);
    return url;
  }
}

// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
/**
 * useResolvedImageUrl — Resolve image URLs for display in <img> tags.
 *
 * Handles URL formats:
 * - `https://...` / `http://...` → pass through
 * - `data:image/...` → pass through (legacy base64)
 * - `local-image://...` → pass through (Electron custom protocol handles directly)
 * - `idb-image://...` → resolve from IndexedDB blob cache (browser mode)
 * - `null/undefined/''` → null
 *
 * Note: `local-image://` is registered as a privileged Electron protocol
 * (bypassCSP, secure) with a handler in main process, so it can be used
 * directly in <img src> without converting to file:// URLs.
 */

import { useState, useEffect, useMemo } from 'react';
import { resolveIdbImageUrl } from '@/lib/image-storage';

/**
 * React hook to resolve an image URL for rendering.
 * Synchronous formats pass through directly; `idb-image://` URLs are resolved
 * asynchronously from IndexedDB.
 */
export function useResolvedImageUrl(rawUrl: string | null | undefined): string | null {
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);

  // For non-idb URLs, return immediately via memo
  const isIdb = rawUrl?.startsWith('idb-image://') ?? false;
  const directUrl = useMemo(() => {
    if (!rawUrl) return null;
    if (isIdb) return null; // Will be resolved async
    return rawUrl;
  }, [rawUrl, isIdb]);

  // Async resolution for idb-image:// URLs
  useEffect(() => {
    if (!rawUrl || !isIdb) {
      setResolvedUrl(null);
      return;
    }

    let cancelled = false;
    resolveIdbImageUrl(rawUrl).then((url) => {
      if (!cancelled) {
        setResolvedUrl(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rawUrl, isIdb]);

  return isIdb ? resolvedUrl : directUrl;
}

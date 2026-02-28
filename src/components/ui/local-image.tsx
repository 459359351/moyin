// Copyright (c) 2025 hotflow2024
// Licensed under AGPL-3.0-or-later. See LICENSE for details.
// Commercial licensing available. See COMMERCIAL_LICENSE.md.
"use client";

/**
 * LocalImage Component
 * Handles displaying images that may be stored locally (local-image://) or in IndexedDB (idb-image://)
 * The local-image:// protocol is handled by Electron's custom protocol handler
 * The idb-image:// protocol is resolved via IndexedDB in browser mode
 */

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { resolveIdbImageUrl } from "@/lib/image-storage";

interface LocalImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  fallback?: string;
}

export function LocalImage({ src, fallback, className, alt, ...props }: LocalImageProps) {
  const [error, setError] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(
    src.startsWith('idb-image://') ? null : src
  );

  // Resolve idb-image:// URLs to object URLs
  useEffect(() => {
    if (!src.startsWith('idb-image://')) {
      setResolvedSrc(src);
      setError(false);
      return;
    }

    let revoked = false;
    resolveIdbImageUrl(src).then((objectUrl) => {
      if (revoked) {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        return;
      }
      if (objectUrl) {
        setResolvedSrc(objectUrl);
        setError(false);
      } else {
        setResolvedSrc(null);
        setError(true);
      }
    });

    return () => {
      revoked = true;
      // Note: we don't revoke here because the img tag might still be using it
      // The browser will clean up when the object URL is no longer referenced
    };
  }, [src]);

  const handleError = () => {
    if (!error && fallback) {
      setError(true);
      setResolvedSrc(fallback);
    } else {
      setError(true);
    }
  };

  if ((error && !fallback) || (!resolvedSrc && !src.startsWith('idb-image://'))) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground text-xs",
          className
        )}
        style={props.style}
      >
        图片加载失败
      </div>
    );
  }

  // Still loading idb-image
  if (!resolvedSrc) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground text-xs animate-pulse",
          className
        )}
        style={props.style}
      >
        加载中...
      </div>
    );
  }

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      className={className}
      onError={handleError}
      {...props}
    />
  );
}

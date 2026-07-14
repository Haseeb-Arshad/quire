import { useEffect, useState } from "react";
import { getImage } from "./library";

// Resolve a stored Blob to a temporary object URL, revoked automatically when
// the consumer unmounts or the id changes.
export function useBlobUrl(
  id: string | undefined,
  enabled: boolean,
  fetcher: (id: string) => Promise<Blob | undefined>
): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!id || !enabled) {
      setUrl(undefined);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;
    void fetcher(id).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled]);

  return url;
}

// Figure bitmaps: a small module-level blob cache keeps re-mounted figures
// (chapter paging re-renders sections) from hitting IndexedDB every time.
// Object URLs are still created/revoked per mount.
const imageBlobCache = new Map<string, Blob>();
const IMAGE_CACHE_LIMIT = 24;

export function useImageBlobUrl(imageId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    if (!imageId) {
      setUrl(undefined);
      return;
    }
    let objectUrl: string | undefined;
    let cancelled = false;

    const attach = (blob: Blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    };

    const cached = imageBlobCache.get(imageId);
    if (cached) {
      // Refresh LRU position.
      imageBlobCache.delete(imageId);
      imageBlobCache.set(imageId, cached);
      attach(cached);
    } else {
      void getImage(imageId).then((stored) => {
        if (!stored || cancelled) return;
        imageBlobCache.set(imageId, stored.blob);
        while (imageBlobCache.size > IMAGE_CACHE_LIMIT) {
          const oldest = imageBlobCache.keys().next().value;
          if (oldest === undefined) break;
          imageBlobCache.delete(oldest);
        }
        attach(stored.blob);
      });
    }

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl(undefined);
    };
  }, [imageId]);

  return url;
}

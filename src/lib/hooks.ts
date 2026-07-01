import { useEffect, useState } from "react";

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

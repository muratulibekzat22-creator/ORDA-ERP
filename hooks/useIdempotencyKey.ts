"use client";

import { useCallback, useRef } from "react";

/**
 * Keeps one request key while an operation is retried and releases it only
 * after the operation has completed successfully or been explicitly cancelled.
 */
export function useIdempotencyKey() {
  const keyRef = useRef<string | null>(null);

  const getKey = useCallback(() => {
    if (!keyRef.current) {
      keyRef.current = crypto.randomUUID();
    }

    return keyRef.current;
  }, []);

  const reset = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { getKey, reset };
}

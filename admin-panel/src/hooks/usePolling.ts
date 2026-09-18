import { useCallback, useEffect, useRef, useState } from "react";
import { NetworkError } from "../api/client.js";

interface PollingState<T> {
  data: T | null;
  error: Error | null;
  isOffline: boolean;
  loading: boolean;
  refetch: () => void;
}

export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 10000): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const poll = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setIsOffline(false);
      setError(null);
    } catch (err) {
      if (err instanceof NetworkError) {
        setIsOffline(true);
      } else {
        setError(err as Error);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void poll();
    const handle = window.setInterval(() => void poll(), intervalMs);
    return () => window.clearInterval(handle);
  }, [poll, intervalMs]);

  return { data, error, isOffline, loading, refetch: () => void poll() };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { NetworkError } from "../api/client.js";

interface PollingState<T> {
  data: T | null;
  lastUpdatedAt: Date | null;
  error: Error | null;
  isOffline: boolean;
  refetch: () => void;
}

/**
 * Polls every intervalMs (default 5-10s per docs/01-architecture.md). On a
 * network failure, keeps showing the last-known snapshot with lastUpdatedAt
 * so the UI can render an "offline as of [time]" banner instead of a blank
 * screen — never clears data on a failed poll.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 7000): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const poll = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setLastUpdatedAt(new Date());
      setIsOffline(false);
      setError(null);
    } catch (err) {
      if (err instanceof NetworkError) {
        setIsOffline(true);
      } else {
        setError(err as Error);
      }
    }
  }, []);

  useEffect(() => {
    void poll();
    const handle = window.setInterval(() => void poll(), intervalMs);
    return () => window.clearInterval(handle);
  }, [poll, intervalMs]);

  return { data, lastUpdatedAt, error, isOffline, refetch: () => void poll() };
}

import { useCallback, useEffect, useRef, useState } from 'react';

// Loads data with `load()` when `deps` change, then again every `intervalMs`
// (pass 0/null to load once). Returns { data, error, loading, reload }.
// Answers from an older request (e.g. the previous run's page) are ignored.
export function usePolling(load, deps, intervalMs) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const mine = generation.current;
    try {
      const data = await loadRef.current();
      if (mine === generation.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (mine === generation.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  // New deps (e.g. another run id): start fresh.
  useEffect(() => {
    generation.current += 1;
    setState({ data: null, error: null, loading: true });
    reload();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!intervalMs) return undefined;
    const timer = setInterval(reload, intervalMs);
    return () => clearInterval(timer);
  }, [reload, intervalMs]);

  return { ...state, reload };
}

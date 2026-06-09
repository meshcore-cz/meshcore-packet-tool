export function queryState(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function hashState(): URLSearchParams {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

export function writeUrlState(
  query: Record<string, string | number | null | undefined>,
  hash: Record<string, string | number | null | undefined> = {},
  options: { clearQueryPrefixes?: string[]; clearHashPrefixes?: string[] } = {},
) {
  const url = new URL(window.location.href);
  clearPrefixes(url.searchParams, options.clearQueryPrefixes ?? []);
  applyParams(url.searchParams, query);

  const hashParams = hashState();
  clearPrefixes(hashParams, options.clearHashPrefixes ?? []);
  applyParams(hashParams, hash);
  url.hash = hashParams.toString();

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

export function readStoredState(key: string): { query: URLSearchParams; hash: URLSearchParams } {
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return { query: new URLSearchParams(), hash: new URLSearchParams() };
    const parsed = JSON.parse(raw) as { query?: string; hash?: string };
    return {
      query: new URLSearchParams(parsed.query ?? ""),
      hash: new URLSearchParams(parsed.hash ?? ""),
    };
  } catch {
    return { query: new URLSearchParams(), hash: new URLSearchParams() };
  }
}

export function writeStoredState(
  key: string,
  query: Record<string, string | number | null | undefined>,
  hash: Record<string, string | number | null | undefined> = {},
) {
  try {
    const queryParams = new URLSearchParams();
    const hashParams = new URLSearchParams();
    applyParams(queryParams, query);
    applyParams(hashParams, hash);
    sessionStorage.setItem(storageKey(key), JSON.stringify({
      query: queryParams.toString(),
      hash: hashParams.toString(),
    }));
  } catch {
    // Ignore storage errors; URL sharing still works.
  }
}

function storageKey(key: string): string {
  return `meshcore-packet-tool:${key}`;
}

function clearPrefixes(params: URLSearchParams, prefixes: string[]) {
  if (prefixes.length === 0) return;
  for (const key of Array.from(params.keys())) {
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      params.delete(key);
    }
  }
}

function applyParams(params: URLSearchParams, updates: Record<string, string | number | null | undefined>) {
  for (const [key, value] of Object.entries(updates)) {
    const s = value == null ? "" : String(value);
    if (s === "") {
      params.delete(key);
    } else {
      params.set(key, s);
    }
  }
}

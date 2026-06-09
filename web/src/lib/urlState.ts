export function queryState(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function hashState(): URLSearchParams {
  return new URLSearchParams(window.location.hash.replace(/^#/, ""));
}

export function writeUrlState(
  query: Record<string, string | number | null | undefined>,
  hash: Record<string, string | number | null | undefined> = {},
) {
  const url = new URL(window.location.href);
  applyParams(url.searchParams, query);

  const hashParams = hashState();
  applyParams(hashParams, hash);
  url.hash = hashParams.toString();

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
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

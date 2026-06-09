// Thin wrapper around @meshcore-cz/meshpkt — re-exports everything the rest of
// the app needs and adds the two small UI helpers that aren't part of the SDK.
export * from "@meshcore-cz/meshpkt";
export type { ErrResult, MeshcoreWasm } from "@meshcore-cz/meshpkt";
export { load as loadWasm } from "@meshcore-cz/meshpkt";

import type { ErrResult } from "@meshcore-cz/meshpkt";

export function isError(v: object): v is ErrResult {
  return "error" in v;
}

export function fmtTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

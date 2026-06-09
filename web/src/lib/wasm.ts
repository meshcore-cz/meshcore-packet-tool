// Re-export everything from the generated interface file.
// Interfaces, MeshcoreWasm, RouteTypes and PayloadTypes all live in wasm.gen.ts.
export * from "./wasm.gen";
export type { ErrResult, MeshcoreWasm } from "./wasm.gen";

import type { MeshcoreWasm, ErrResult } from "./wasm.gen";
import { meshcoreOpNames } from "./wasm.gen";

declare class Go {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

declare global {
  interface Window {
    meshpktCall?: (opName: string, argsJSON: string) => object;
  }
}

// ── runtime helpers ───────────────────────────────────────────────────────────

export function isError(v: object): v is ErrResult {
  return "error" in v;
}

export function fmtTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

// ── WASM loader (TinyGo) ──────────────────────────────────────────────────────

const wasmBase = import.meta.env.BASE_URL;
const wasmFile = `${wasmBase}meshpkt.wasm`;

let wasmReady: Promise<MeshcoreWasm>;

async function loadWasmExec(): Promise<void> {
  if (typeof (window as unknown as Record<string, unknown>)["Go"] !== "undefined") return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${wasmBase}wasm_exec.js`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${wasmBase}wasm_exec.js — run \`make wasm\` first`));
    document.head.appendChild(s);
  });
}

function buildMeshcore(call: (opName: string, argsJSON: string) => object): MeshcoreWasm {
  const api = {} as MeshcoreWasm;
  for (const name of meshcoreOpNames) {
    (api as Record<string, (...args: unknown[]) => object>)[name] = (...args: unknown[]) =>
      call(name, JSON.stringify(args));
  }
  return api;
}

async function waitForMeshpktCall(): Promise<(opName: string, argsJSON: string) => object> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (window.meshpktCall) return window.meshpktCall;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("meshpktCall not registered — rebuild WASM with TinyGo");
}

export function loadWasm(): Promise<MeshcoreWasm> {
  if (wasmReady) return wasmReady;
  wasmReady = (async () => {
    await loadWasmExec();
    const go = new Go();
    let instance: WebAssembly.Instance;
    try {
      const result = await WebAssembly.instantiateStreaming(fetch(wasmFile), go.importObject);
      instance = result.instance;
    } catch {
      const buf = await fetch(wasmFile).then((r) => r.arrayBuffer());
      const result = await WebAssembly.instantiate(buf, go.importObject);
      instance = result.instance;
    }
    go.run(instance);
    const call = await waitForMeshpktCall();
    return buildMeshcore(call);
  })();
  return wasmReady;
}

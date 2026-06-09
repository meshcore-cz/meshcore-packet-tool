type StartMessage = {
  type: "start";
  wasmBase: string;
  packetHex: string;
  durationMs: number;
  batchSize: number;
};

type DoneMessage = {
  type: "done";
  count: number;
  elapsedMs: number;
  error?: string;
};

type ProgressMessage = {
  type: "progress";
  count: number;
  elapsedMs: number;
};

declare class Go {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

type WorkerScope = DedicatedWorkerGlobalScope & {
  Go?: typeof Go;
  meshpktCall?: (opName: string, argsJSON: string) => object;
};

const scope = self as WorkerScope;

async function loadWasm(wasmBase: string): Promise<(opName: string, argsJSON: string) => object> {
  if (!scope.Go) {
    scope.importScripts(`${wasmBase}wasm_exec.js`);
  }

  const go = new scope.Go!();
  const wasmFile = `${wasmBase}meshpkt.wasm`;
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

  const deadline = performance.now() + 10_000;
  while (performance.now() < deadline) {
    if (scope.meshpktCall) return scope.meshpktCall;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("meshpktCall not registered in worker");
}

async function runBenchmark(msg: StartMessage): Promise<DoneMessage> {
  const call = await loadWasm(msg.wasmBase);
  const argsJSON = JSON.stringify([msg.packetHex]);

  const warmup = call("decodeEnvelope", argsJSON);
  if ("error" in warmup) {
    return { type: "done", count: 0, elapsedMs: 0, error: String(warmup.error) };
  }

  let count = 0;
  const started = performance.now();
  const end = started + msg.durationMs;
  const batchSize = Math.max(1, msg.batchSize);
  let nextProgressAt = started + 50;

  while (performance.now() < end) {
    for (let i = 0; i < batchSize; i++) {
      const result = call("decodeEnvelope", argsJSON);
      if ("error" in result) {
        return { type: "done", count, elapsedMs: performance.now() - started, error: String(result.error) };
      }
    }
    count += batchSize;

    const now = performance.now();
    if (now >= nextProgressAt) {
      scope.postMessage({ type: "progress", count, elapsedMs: now - started } satisfies ProgressMessage);
      nextProgressAt = now + 50;
    }
  }

  return { type: "done", count, elapsedMs: performance.now() - started };
}

scope.onmessage = async (event: MessageEvent<StartMessage>) => {
  if (event.data.type !== "start") return;
  try {
    scope.postMessage(await runBenchmark(event.data));
  } catch (e) {
    scope.postMessage({ type: "done", count: 0, elapsedMs: 0, error: String(e) } satisfies DoneMessage);
  }
};

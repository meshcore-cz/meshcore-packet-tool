<script lang="ts">
  import { isError, type MeshcoreWasm } from "./wasm";

  let { mc }: { mc: MeshcoreWasm } = $props();

  const samplePacket =
    "21068034ed885125d3ec9c576026260a1aee38afc08b4f64ac5d6334004d75fbd8a9e295d05a144d7cbe2bd3799df48a1e21d66ece16bf5e97f49290";

  type BenchResult = {
    packets: number;
    elapsedMs: number;
    packetsPerSecond: number;
    workers: number;
    batchSize: number;
  };

  type WorkerResult = { count: number; elapsedMs: number; error?: string };
  type WorkerRun = {
    worker: Worker;
    index: number;
    resolve: (result: WorkerResult) => void;
  };
  type WorkerMessage =
    | { type: "progress"; count: number; elapsedMs: number }
    | { type: "done"; count: number; elapsedMs: number; error?: string };

  let packetHex = $state(samplePacket);
  let durationSec = $state(3);
  let workerCount = $state(Math.min(8, navigator.hardwareConcurrency || 8));
  let batchSize = $state(1000);
  let running = $state(false);
  let error = $state("");
  let result = $state<BenchResult | null>(null);
  let livePackets = $state(0);
  let liveElapsedMs = $state(0);
  let liveWorkersDone = $state(0);

  let activeWorkers: WorkerRun[] = [];
  let runStartedAt = 0;
  let progressTimer: number | undefined;
  let workerCounts: number[] = [];

  function sanitizeHex(s: string): string {
    return s.trim().replace(/\s/g, "");
  }

  function clampSettings() {
    durationSec = Math.max(0.25, Math.min(30, Number(durationSec) || 1));
    workerCount = Math.max(1, Math.min(32, Math.floor(Number(workerCount) || 1)));
    batchSize = Math.max(1, Math.min(100000, Math.floor(Number(batchSize) || 1)));
  }

  function stop() {
    for (const run of activeWorkers) {
      run.worker.terminate();
      run.resolve({ count: workerCounts[run.index] ?? 0, elapsedMs: performance.now() - runStartedAt });
    }
    activeWorkers = [];
    running = false;
    if (progressTimer !== undefined) {
      clearInterval(progressTimer);
      progressTimer = undefined;
    }
  }

  function refreshLiveProgress() {
    livePackets = workerCounts.reduce((sum, count) => sum + count, 0);
    liveElapsedMs = running ? performance.now() - runStartedAt : liveElapsedMs;
  }

  function liveRate(): number {
    if (!liveElapsedMs) return 0;
    return livePackets / (liveElapsedMs / 1000);
  }

  function progressPct(): number {
    if (!durationSec) return 0;
    return Math.min(100, (liveElapsedMs / (durationSec * 1000)) * 100);
  }

  async function run() {
    stop();
    clampSettings();
    error = "";
    result = null;
    livePackets = 0;
    liveElapsedMs = 0;
    liveWorkersDone = 0;

    const hex = sanitizeHex(packetHex);
    if (!hex) {
      error = "Paste a packet hex string first.";
      return;
    }

    const parsed = mc.decodeEnvelope(hex);
    if (isError(parsed)) {
      error = parsed.error;
      return;
    }

    running = true;
    runStartedAt = performance.now();
    const durationMs = durationSec * 1000;
    const workers = workerCount;
    workerCounts = Array.from({ length: workers }, () => 0);
    progressTimer = window.setInterval(refreshLiveProgress, 50);

    try {
      const runs = Array.from({ length: workers }, (_, index) => runWorker(index, hex, durationMs, batchSize));
      const results = await Promise.all(runs);
      const failed = results.find((r) => r.error);
      if (failed?.error) {
        error = failed.error;
        return;
      }

      const packets = results.reduce((sum, r) => sum + r.count, 0);
      const elapsedMs = Math.max(performance.now() - runStartedAt, ...results.map((r) => r.elapsedMs));
      result = {
        packets,
        elapsedMs,
        packetsPerSecond: packets / (elapsedMs / 1000),
        workers,
        batchSize,
      };
    } finally {
      stop();
    }
  }

  function runWorker(index: number, hex: string, durationMs: number, batch: number): Promise<WorkerResult> {
    return new Promise((resolve) => {
      const worker = new Worker(new URL("./benchmark.worker.ts", import.meta.url));
      activeWorkers.push({ worker, index, resolve });
      worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
        if (event.data.type === "progress") {
          workerCounts[index] = event.data.count;
          refreshLiveProgress();
          return;
        }
        workerCounts[index] = event.data.count;
        liveWorkersDone += 1;
        refreshLiveProgress();
        worker.terminate();
        activeWorkers = activeWorkers.filter((run) => run.worker !== worker);
        resolve({ count: event.data.count, elapsedMs: event.data.elapsedMs, error: event.data.error });
      };
      worker.onerror = (event) => {
        worker.terminate();
        activeWorkers = activeWorkers.filter((run) => run.worker !== worker);
        resolve({ count: 0, elapsedMs: 0, error: event.message });
      };
      worker.postMessage({
        type: "start",
        wasmBase: import.meta.env.BASE_URL,
        packetHex: hex,
        durationMs,
        batchSize: batch,
      });
    });
  }
</script>

<div class="panel">
  <section>
    <h3>Decode benchmark</h3>
    <p class="hint">
      Measures `decodeEnvelope` throughput. Each worker runs its own TinyGo WASM instance for the selected duration.
    </p>

    <label>
      <span class="lbl">Hex packet</span>
      <textarea bind:value={packetHex} rows={4} class="mono" placeholder="Paste hex-encoded MeshCore packet…"></textarea>
    </label>

    <div class="settings">
      <label>
        <span class="lbl">Duration (seconds)</span>
        <input type="number" bind:value={durationSec} min="0.25" max="30" step="0.25" />
      </label>
      <label>
        <span class="lbl">Workers / threads</span>
        <input type="number" bind:value={workerCount} min="1" max="32" step="1" />
      </label>
      <label>
        <span class="lbl">Batch size</span>
        <input type="number" bind:value={batchSize} min="1" max="100000" step="100" />
      </label>
    </div>

    <div class="actions">
      <button class="primary" onclick={run} disabled={running}>{running ? "Running…" : "Run benchmark"}</button>
      {#if running}
        <button onclick={stop}>Stop</button>
      {/if}
    </div>

    {#if error}
      <div class="error">{error}</div>
    {/if}
  </section>

  {#if running}
    <div class="progress-card">
      <div class="progress-top">
        <div>
          <div class="progress-label">Live throughput</div>
          <div class="progress-rate">{Math.round(liveRate()).toLocaleString()} packets/sec</div>
        </div>
        <div class="progress-meta">
          {(liveElapsedMs / 1000).toFixed(1)}s / {durationSec.toFixed(1)}s
          <br />
          {liveWorkersDone}/{workerCount} workers done
        </div>
      </div>
      <div class="bar" aria-label="Benchmark progress">
        <div class="bar-fill" style={`width: ${progressPct()}%`}></div>
      </div>
      <div class="progress-count">{livePackets.toLocaleString()} packets decoded so far</div>
    </div>
  {/if}

  {#if result}
    <div class="result-card">
      <div class="score">{Math.round(result.packetsPerSecond).toLocaleString()} packets/sec</div>
      <table>
        <tbody>
          <tr><td>Total packets</td><td>{result.packets.toLocaleString()}</td></tr>
          <tr><td>Elapsed</td><td>{(result.elapsedMs / 1000).toFixed(2)}s</td></tr>
          <tr><td>Workers</td><td>{result.workers}</td></tr>
          <tr><td>Batch size</td><td>{result.batchSize.toLocaleString()}</td></tr>
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .panel {
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  h3 {
    margin: 0 0 8px;
    color: #f0f6fc;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .hint {
    margin: 0 0 14px;
    color: #8b949e;
    font-size: 13px;
    line-height: 1.5;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .lbl {
    color: #8b949e;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  input, textarea {
    width: 100%;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #e6edf3;
    font: inherit;
    padding: 10px 12px;
  }
  textarea { resize: vertical; }
  input:focus, textarea:focus {
    outline: none;
    border-color: #1f6feb;
  }
  .mono {
    font-family: "SF Mono", Consolas, monospace;
    font-size: 12px;
  }
  .settings {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
    margin-top: 14px;
  }
  .actions {
    display: flex;
    gap: 10px;
    margin-top: 16px;
  }
  button {
    background: #21262d;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #e6edf3;
    cursor: pointer;
    font: inherit;
    font-weight: 500;
    padding: 10px 16px;
  }
  button:hover:not(:disabled) { background: #30363d; }
  button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
  }
  button.primary {
    background: #1f6feb;
    border-color: #1f6feb;
    color: white;
  }
  button.primary:hover:not(:disabled) { background: #388bfd; }
  .error {
    margin-top: 12px;
    background: #3d1f1f;
    border: 1px solid #6e2a2a;
    border-radius: 6px;
    color: #f97583;
    padding: 10px 12px;
  }
  .progress-card {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 16px;
  }
  .progress-top {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
  }
  .progress-label {
    color: #8b949e;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .progress-rate {
    color: #3fb950;
    font-size: 24px;
    font-weight: 700;
    margin-top: 2px;
  }
  .progress-meta {
    color: #8b949e;
    font-size: 12px;
    line-height: 1.5;
    text-align: right;
  }
  .bar {
    background: #21262d;
    border-radius: 999px;
    height: 8px;
    overflow: hidden;
  }
  .bar-fill {
    background: #1f6feb;
    height: 100%;
    transition: width 0.1s linear;
  }
  .progress-count {
    color: #8b949e;
    font-size: 12px;
    margin-top: 10px;
  }
  .result-card {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 8px;
    padding: 16px;
  }
  .score {
    color: #3fb950;
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 12px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
  }
  td {
    border-top: 1px solid #21262d;
    padding: 8px 0;
  }
  td:first-child { color: #8b949e; width: 180px; }
  @media (max-width: 700px) {
    .settings { grid-template-columns: 1fr; }
  }
</style>

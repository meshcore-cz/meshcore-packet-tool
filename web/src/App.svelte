<script lang="ts">
  import { onMount } from "svelte";
  import { loadWasm, type MeshcoreWasm } from "./lib/wasm";
  import PacketWorkspace from "./lib/PacketWorkspace.svelte";
  import BenchmarkPanel from "./lib/BenchmarkPanel.svelte";
  import { queryState, writeUrlState } from "./lib/urlState";

  let mc = $state<MeshcoreWasm | null>(null);
  let loadError = $state("");
  let activeTab = $state<"packet" | "benchmark">("packet");
  let urlReady = $state(false);

  onMount(async () => {
    const view = queryState().get("view");
    if (view === "benchmark") activeTab = "benchmark";
    urlReady = true;

    try {
      mc = await loadWasm();
    } catch (e) {
      loadError = String(e);
    }
  });

  $effect(() => {
    if (!urlReady) return;
    writeUrlState({ view: activeTab === "benchmark" ? "benchmark" : undefined }, {});
  });
</script>

<div class="app">
  <header>
    <div class="title-row">
      <h1>MeshCore Packet Tool</h1>
      {#if mc}
        <span class="badge">WASM ready</span>
      {/if}
    </div>
    <p class="subtitle">Encode and decode MeshCore radio packet wire format in your browser</p>
  </header>

  {#if loadError}
    <div class="fatal">
      <strong>Failed to load WASM module:</strong> {loadError}
      <br />Run <code>make wasm</code> in the example directory first, then refresh.
    </div>
  {:else}
    {#if activeTab === "benchmark"}
      <nav class="top-tabs">
        <button onclick={() => (activeTab = "packet")}>← Packet Tool</button>
        <button class="active">Benchmark</button>
      </nav>
    {/if}

    <div class="panel-wrap">
      {#if !mc}
        <div class="loading">Loading WASM module…</div>
      {:else if activeTab === "packet"}
        <PacketWorkspace {mc} />
      {:else}
        <BenchmarkPanel {mc} />
      {/if}
    </div>

    {#if activeTab === "packet"}
      <div class="bench-link">
        <button class="link-btn" onclick={() => (activeTab = "benchmark")}>Run benchmark</button>
      </div>
    {/if}
  {/if}

  <footer>
    powered by
    <a href="https://github.com/meshcore-cz/meshpkt" target="_blank" rel="noreferrer">meshpkt</a>
    ·
    part of
    <a href="https://github.com/meshcore-cz/meshcore-go" target="_blank" rel="noreferrer">meshcore-go SDK</a>
    ·
    <a href="https://github.com/meshcore-cz/meshcore-packet-tool" target="_blank" rel="noreferrer">source code</a>
  </footer>
</div>

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; }
  :global(body) {
    margin: 0;
    background: #0d1117;
    color: #e6edf3;
    font-family: "Segoe UI", system-ui, sans-serif;
    font-size: 14px;
    min-height: 100vh;
  }
  .app {
    max-width: 860px;
    margin: 0 auto;
    padding: 28px 16px 48px;
  }
  header { margin-bottom: 24px; }
  .title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  h1 { margin: 0; font-size: 20px; font-weight: 600; color: #f0f6fc; }
  .badge {
    font-size: 11px; font-weight: 500;
    background: #1a3a2a; color: #3fb950;
    border: 1px solid #238636; border-radius: 20px; padding: 2px 8px;
  }
  .subtitle { margin: 0; color: #8b949e; font-size: 13px; }
  .top-tabs { display: flex; gap: 8px; margin-bottom: 20px; }
  .top-tabs button {
    background: #21262d; border: 1px solid #30363d; border-radius: 6px;
    color: #8b949e; cursor: pointer; font-size: 13px; font-family: inherit; padding: 6px 14px;
  }
  .top-tabs button:hover { color: #e6edf3; }
  .top-tabs button.active { color: #79c0ff; border-color: #1f6feb; background: #1f3a5c; }
  .panel-wrap { width: 100%; }
  .loading { color: #8b949e; padding: 48px; text-align: center; }
  .fatal {
    background: #3d1f1f; border: 1px solid #6e2a2a; border-radius: 6px;
    padding: 16px; color: #f97583; line-height: 1.6;
  }
  .fatal code { background: #1c1c1c; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
  .bench-link { margin-top: 12px; text-align: right; }
  .link-btn { background: none; border: none; color: #8b949e; cursor: pointer; font-size: 12px; font-family: inherit; padding: 0; }
  .link-btn:hover { color: #58a6ff; }
  footer { margin-top: 28px; color: #8b949e; font-size: 12px; text-align: center; }
  footer a { color: #58a6ff; text-decoration: none; }
  footer a:hover { text-decoration: underline; }
</style>

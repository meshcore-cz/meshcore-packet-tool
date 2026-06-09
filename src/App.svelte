<script lang="ts">
  import { onMount } from "svelte";
  import { fade } from "svelte/transition";
  import { loadWasm, type MeshcoreWasm } from "./lib/wasm";
  import PacketWorkspace from "./lib/PacketWorkspace.svelte";
  import appPkg from "../package.json";
  const meshpktVersion = (appPkg.dependencies["@meshcore-cz/meshpkt"] as string).replace(/^[\^~]/, "");

  let mc = $state<MeshcoreWasm | null>(null);
  let loadError = $state("");
  let showLoader = $state(false);

  onMount(async () => {
    // Only show the loader if WASM takes more than 300ms — avoids a flash on fast connections
    const loaderTimer = setTimeout(() => { showLoader = true; }, 300);
    try {
      mc = await loadWasm();
    } catch (e) {
      loadError = String(e);
    }
    clearTimeout(loaderTimer);
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
    </div>
  {:else}
    <div class="panel-wrap">
      {#if !mc}
        {#if showLoader}
          <div class="loading" in:fade={{ duration: 150 }}>
            <div class="loader-rings">
              <span></span><span></span><span></span>
            </div>
            <div class="loader-label">Loading codec…</div>
          </div>
        {/if}
      {:else}
        <div in:fade={{ duration: 500 }}>
          <PacketWorkspace {mc} />
        </div>
      {/if}
    </div>
  {/if}

  {#if mc}
    <footer in:fade={{ duration: 500 }}>
      powered by
      <a href="https://github.com/meshcore-cz/meshpkt" target="_blank" rel="noreferrer">meshpkt</a> v{meshpktVersion} 
      ·
      part of
      <a href="https://github.com/meshcore-cz/meshcore-go" target="_blank" rel="noreferrer">meshcore-go</a> SDK 
      ·
      <a href="https://github.com/meshcore-cz/meshcore-packet-tool" target="_blank" rel="noreferrer">source code</a>
    </footer>
  {/if}
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
.panel-wrap { width: 100%; }
  /* ── Loader ───────────────────────────────────────────────────────────────── */
  .loading {
    display: flex; flex-direction: column; align-items: center;
    gap: 20px; padding: 72px 0;
  }
  .loader-rings {
    position: relative; width: 48px; height: 48px;
  }
  .loader-rings span {
    position: absolute; inset: 0; border-radius: 50%;
    border: 2px solid transparent;
    border-top-color: #1f6feb;
    animation: spin 1.1s linear infinite;
  }
  .loader-rings span:nth-child(2) {
    inset: 8px; border-top-color: #388bfd;
    animation-duration: 0.85s; animation-direction: reverse;
  }
  .loader-rings span:nth-child(3) {
    inset: 16px; border-top-color: #79c0ff;
    animation-duration: 0.6s;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .loader-label { color: #6e7681; font-size: 12px; letter-spacing: 0.06em; }
  .fatal {
    background: #3d1f1f; border: 1px solid #6e2a2a; border-radius: 6px;
    padding: 16px; color: #f97583; line-height: 1.6;
  }
  .fatal code { background: #1c1c1c; padding: 2px 6px; border-radius: 4px; font-family: monospace; }
footer { margin-top: 28px; color: #8b949e; font-size: 12px; text-align: center; }
  footer a { color: #58a6ff; text-decoration: none; }
  footer a:hover { text-decoration: underline; }
</style>

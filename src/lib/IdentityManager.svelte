<script lang="ts">
  import { isError, type MeshcoreWasm } from "./wasm";
  import { identities } from "./identities.svelte";

  let { mc }: { mc: MeshcoreWasm } = $props();

  let importing  = $state(false);
  let impPrivKey = $state("");
  let importErr  = $state("");
  let copiedId   = $state<string | null>(null);

  function generate() {
    const r = mc.generateKeypair();
    if (isError(r)) return;
    identities.add({ id: crypto.randomUUID(), privateKey: r.privateKey, publicKey: r.publicKey });
  }

  function confirmImport() {
    const privateKey = impPrivKey.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(privateKey)) { importErr = "Private key must be 64 hex chars (32 bytes)"; return; }
    const r = mc.keypairFromPrivkey(privateKey);
    if (isError(r)) { importErr = r.error; return; }
    identities.add({ id: crypto.randomUUID(), privateKey, publicKey: r.publicKey });
    importing = false; impPrivKey = "";
  }

  function cancelImport() { importing = false; impPrivKey = ""; importErr = ""; }

  async function copy(text: string, tag: string) {
    await navigator.clipboard.writeText(text).catch(() => {});
    copiedId = tag;
    setTimeout(() => { copiedId = null; }, 1400);
  }

  function truncKey(k: string | undefined) { if (!k) return "???"; return k.slice(0, 8) + "…" + k.slice(-8); }
</script>

<div class="id-manager">
  <div class="id-header">
    <span class="id-label">IDENTITIES</span>
    <div class="id-actions">
      <button class="sm" onclick={generate}>Generate</button>
      <button class="sm" onclick={() => { importing = true; importErr = ""; }} disabled={importing}>Import</button>
    </div>
  </div>

  {#if importing}
    <div class="import-form">
      <label>
        <span class="lbl">Private key (64 hex chars — 32 bytes)</span>
        <input class="mono" bind:value={impPrivKey} placeholder="64 hex chars" spellcheck={false}
          onkeydown={e => e.key === "Enter" && confirmImport()} />
      </label>
      {#if importErr}<div class="err">{importErr}</div>{/if}
      <div class="import-btns">
        <button class="action-btn" onclick={confirmImport}>Save</button>
        <button onclick={cancelImport}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if identities.list.length === 0 && !importing}
    <div class="empty">No identities — click Generate to create one.</div>
  {/if}

  {#each identities.list as id (id.id)}
    <div class="id-row">
      <div class="id-keys">
        <span class="key-line mono" title={id.publicKey}>pub  <span class="key-val">{truncKey(id.publicKey)}</span></span>
        <span class="key-line mono" title={id.privateKey}>priv <span class="key-val dim">{truncKey(id.privateKey)}</span></span>
      </div>
      <div class="id-btns">
        <button class="sm use-btn"  title="Fill current form with this keypair" onclick={() => identities.fill(id)}>sign</button>
        <button class="sm copy-btn" title="Copy public key"  onclick={() => copy(id.publicKey,  id.id + "pub")} >{copiedId === id.id + "pub"  ? "✓" : "pub"}</button>
        <button class="sm copy-btn" title="Copy private key" onclick={() => copy(id.privateKey, id.id + "priv")}>{copiedId === id.id + "priv" ? "✓" : "priv"}</button>
        <button class="sm del-btn"  title="Delete"           onclick={() => identities.remove(id.id)}>✕</button>
      </div>
    </div>
  {/each}
</div>

<style>
  .id-manager {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;
  }
  .id-header { display: flex; align-items: center; }
  .id-label  { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #8b949e; flex: 1; }
  .id-actions { display: flex; gap: 6px; }

  .import-form {
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    padding: 12px; display: flex; flex-direction: column; gap: 10px;
  }
  .import-btns { display: flex; gap: 8px; }
  .action-btn {
    background: #1f6feb; border: 1px solid #1f6feb; border-radius: 6px;
    color: #fff; cursor: pointer; font-family: inherit; font-size: 13px;
    font-weight: 600; padding: 6px 14px; transition: background 0.1s;
  }
  .action-btn:hover { background: #388bfd; }

  .id-row {
    display: flex; align-items: center; gap: 10px;
    padding: 7px 10px; background: #0d1117;
    border: 1px solid #21262d; border-radius: 6px;
  }
  .id-keys { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .key-line { font-size: 11px; color: #6e7681; display: flex; gap: 4px; }
  .key-val  { color: #8b949e; }
  .key-val.dim { color: #484f58; }

  .id-btns  { display: flex; gap: 4px; flex-shrink: 0; }
  .copy-btn { font-size: 11px; padding: 4px 8px; min-width: 36px; }
  .del-btn  { font-size: 11px; padding: 4px 8px; color: #6e7681; }
  .del-btn:hover  { color: #f97583; background: #3d1f1f; border-color: #6e2a2a; }
  .use-btn  { color: #58a6ff; border-color: #1f6feb33; }
  .use-btn:hover  { background: #1f3a5c; border-color: #1f6feb; color: #79c0ff; }

  .empty { color: #484f58; font-size: 12px; padding: 4px 0; }
  .err   { background: #3d1f1f; border: 1px solid #6e2a2a; border-radius: 6px; color: #f97583; font-size: 12px; padding: 7px 10px; }

  label { display: flex; flex-direction: column; gap: 4px; }
  .lbl  { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #8b949e; }
  input {
    background: #161b22; border: 1px solid #30363d; border-radius: 6px;
    color: #e6edf3; font-size: 13px; padding: 7px 10px; outline: none;
    width: 100%; box-sizing: border-box; font-family: inherit;
  }
  input:focus { border-color: #58a6ff; }
  .mono { font-family: "Cascadia Code", "Fira Code", monospace; font-size: 12px; }
  .dim  { color: #484f58; }

  button {
    background: #21262d; border: 1px solid #30363d; border-radius: 6px;
    color: #e6edf3; cursor: pointer; font-family: inherit; font-size: 13px;
    padding: 7px 12px; transition: background 0.1s;
  }
  button:hover { background: #30363d; }
  button[disabled] { opacity: 0.4; cursor: default; pointer-events: none; }
  .sm { font-size: 12px; padding: 5px 10px; }
</style>

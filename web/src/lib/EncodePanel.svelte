<script lang="ts">
  import { onMount } from "svelte";
  import { isError, type MeshcoreWasm } from "./wasm";
  import { OpMetas, type OpMeta, type ParamMeta } from "./wasm.gen";
  import { writeUrlState } from "./urlState";

  let { mc }: { mc: MeshcoreWasm } = $props();

  // ── data derived from OpMetas ─────────────────────────────────────────────

  const encodeOps = OpMetas.filter(op => op.category === "encode");

  // Ordered unique tab groups (first occurrence order)
  const tabGroups: string[] = [];
  for (const op of encodeOps) {
    if (!tabGroups.includes(op.tabGroup)) tabGroups.push(op.tabGroup);
  }

  // tabGroup → all ops in that group
  function opsForTab(tg: string): OpMeta[] {
    return encodeOps.filter(op => op.tabGroup === tg);
  }

  // tabGroup → first op (for tab label/sub)
  function tabMeta(tg: string): OpMeta {
    return opsForTab(tg)[0];
  }

  // ── form state ────────────────────────────────────────────────────────────

  let vals = $state<Record<string, unknown>>({});
  let activeTab = $state(tabGroups[0] ?? "");
  // tabGroup → active op.name (for variant toggle)
  let activeVariants = $state<Record<string, string>>({});
  // Derived public keys shown below keypair inputs: key(opName,paramName) → pubkey string
  let derivedPubKeys = $state<Record<string, string>>({});

  let result      = $state("");
  let resultError = $state("");
  let copied      = $state(false);
  let mounted     = $state(false);

  function key(opName: string, pName: string): string {
    return `${opName}:${pName}`;
  }

  function getStr(opName: string, pName: string): string {
    return String(vals[key(opName, pName)] ?? "");
  }
  function getNum(opName: string, pName: string): number {
    const v = vals[key(opName, pName)];
    return typeof v === "number" ? v : 0;
  }
  function getBool(opName: string, pName: string): boolean {
    return Boolean(vals[key(opName, pName)]);
  }
  function setVal(opName: string, pName: string, v: unknown) {
    vals[key(opName, pName)] = v;
  }

  function currentOp(): OpMeta | undefined {
    const ops = opsForTab(activeTab);
    if (!ops.length) return undefined;
    const variantName = activeVariants[activeTab];
    return ops.find(op => op.name === variantName) ?? ops[0];
  }

  function setVariant(tg: string, opName: string) {
    activeVariants[tg] = opName;
  }

  // ── session storage persistence ──────────────────────────────────────────

  const SS_VALS     = "meshcore-packet-tool:encode-vals";
  const SS_TAB      = "meshcore-packet-tool:encode-tab";
  const SS_VARIANTS = "meshcore-packet-tool:encode-variants";

  onMount(() => {
    try {
      const storedVals = sessionStorage.getItem(SS_VALS);
      if (storedVals) vals = JSON.parse(storedVals);
      const storedTab = sessionStorage.getItem(SS_TAB);
      if (storedTab && tabGroups.includes(storedTab)) activeTab = storedTab;
      const storedVariants = sessionStorage.getItem(SS_VARIANTS);
      if (storedVariants) activeVariants = JSON.parse(storedVariants);
    } catch {}
    mounted = true;
  });

  $effect(() => {
    if (!mounted) return;
    try {
      // Read vals to register reactive dependency (Svelte tracks property access)
      const snapshot = JSON.stringify(vals);
      sessionStorage.setItem(SS_VALS, snapshot);
      sessionStorage.setItem(SS_TAB, activeTab);
      sessionStorage.setItem(SS_VARIANTS, JSON.stringify(activeVariants));
    } catch {}
    writeUrlState({ view: "encode", e_type: activeTab }, {});
  });

  // ── generic form layout helpers ────────────────────────────────────────────

  /**
   * Group params into layout rows. Params with the same Group are placed
   * together in one row (rendered side-by-side). AutoFill params are excluded.
   */
  function layoutRows(params: ParamMeta[]): ParamMeta[][] {
    const rows: ParamMeta[][] = [];
    const seenGroups = new Set<string>();
    for (const p of params) {
      if (p.autoFill) continue;
      if (p.group) {
        if (seenGroups.has(p.group)) continue;
        seenGroups.add(p.group);
        rows.push(params.filter(q => q.group === p.group && !q.autoFill));
      } else {
        rows.push([p]);
      }
    }
    return rows;
  }

  /** Returns true if a param should be visible given current form values. */
  function isVisible(opName: string, p: ParamMeta): boolean {
    if (!p.showWhen) return true;
    return getNum(opName, p.showWhen) === p.showValue;
  }

  // ── actions ───────────────────────────────────────────────────────────────

  function handleAction(opName: string, param: ParamMeta) {
    resultError = "";
    const kp = mc.generateKeypair();
    if (isError(kp)) { resultError = kp.error; return; }
    if (param.action === "keypair") {
      setVal(opName, param.name, kp.privateKey);
      derivedPubKeys[key(opName, param.name)] = kp.publicKey;
    } else if (param.action === "keypair-pub") {
      setVal(opName, param.name, kp.publicKey);
    }
  }

  function encode() {
    result = "";
    resultError = "";
    copied = false;

    const op = currentOp();
    if (!op) { resultError = "No active operation."; return; }

    // Collect args in param order (skip autoFill params — they shouldn't exist for encode ops)
    const argList: unknown[] = [];
    for (const param of op.params) {
      if (param.autoFill) continue;
      switch (param.kind) {
        case "int":
          argList.push(param.widget === "checkbox"
            ? (getBool(op.name, param.name) ? 1 : 0)
            : Math.trunc(getNum(op.name, param.name)));
          break;
        case "float":
          argList.push(getNum(op.name, param.name));
          break;
        default: // "string" | "hex"
          argList.push(getStr(op.name, param.name));
      }
    }

    const fn = (mc as Record<string, (...args: unknown[]) => unknown>)[op.name];
    if (typeof fn !== "function") { resultError = `Unknown op: ${op.name}`; return; }
    const r = fn(...argList) as { hex?: string } | { error: string };
    if (isError(r)) {
      resultError = r.error;
    } else {
      result = String((r as { hex?: string }).hex ?? JSON.stringify(r));
    }
  }

  async function copy() {
    if (!result) return;
    await navigator.clipboard.writeText(result);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }
</script>

<div class="panel">
  <!-- ── Packet type tabs ─────────────────────────────────────────────────── -->
  <div class="type-tabs">
    {#each tabGroups as tg}
      {@const meta = tabMeta(tg)}
      <button class:active={activeTab === tg} onclick={() => { activeTab = tg; result = ""; resultError = ""; }}>
        {meta.tabGroupLabel || tg}
        {#if meta.tabGroupSub}<span class="sub">{meta.tabGroupSub}</span>{/if}
      </button>
    {/each}
  </div>

  <!-- ── Form for active tab ──────────────────────────────────────────────── -->
  {#each tabGroups as tg}
    {#if activeTab === tg}
      {@const ops = opsForTab(tg)}
      {@const op = ops.find(o => o.name === (activeVariants[tg] ?? ops[0]?.name)) ?? ops[0]}

      <!-- Variant toggle (only when there are multiple ops in the group) -->
      {#if ops.length > 1 && op}
        <div class="mode-toggle">
          {#each ops as variant}
            <button
              class:active={op.name === variant.name}
              onclick={() => setVariant(tg, variant.name)}
            >{variant.tabLabel || variant.name}</button>
          {/each}
        </div>
      {/if}

      <!-- Generic form fields -->
      {#if op}
        <div class="fields">
          {#each layoutRows(op.params) as row}
            {#if row.some(p => isVisible(op.name, p))}
              <div class:two-col={row.length > 1}>
                {#each row as param}
                  {#if isVisible(op.name, param)}
                    {#if param.widget === "checkbox"}
                      <!-- Toggle button (ParamInt 0/1) — matches the JSON toggle style -->
                      <button
                        class="toggle-btn"
                        class:active={getBool(op.name, param.name)}
                        onclick={() => setVal(op.name, param.name, getBool(op.name, param.name) ? 0 : 1)}
                      >
                        <span class="toggle-dot"></span>
                        <span>{param.label || param.name}</span>
                      </button>

                    {:else if param.choices.length > 0}
                      <!-- Select (ParamInt with Choices) -->
                      <label>
                        <span class="lbl">{param.label || param.name}</span>
                        <select
                          value={getNum(op.name, param.name)}
                          onchange={e => setVal(op.name, param.name, Number(e.currentTarget.value))}
                        >
                          {#each param.choices as c}
                            <option value={c.value}>{c.label}</option>
                          {/each}
                        </select>
                      </label>

                    {:else if param.widget === "textarea"}
                      <!-- Textarea -->
                      <label>
                        <span class="lbl">{param.label || param.name}</span>
                        <textarea
                          value={getStr(op.name, param.name)}
                          oninput={e => setVal(op.name, param.name, e.currentTarget.value)}
                          placeholder={param.placeholder}
                          rows={3}
                          class:mono={param.kind === "hex"}
                        ></textarea>
                      </label>

                    {:else if param.kind === "int" || param.kind === "float"}
                      <!-- Number input -->
                      <label>
                        <span class="lbl">{param.label || param.name}</span>
                        <input
                          type="number"
                          value={getNum(op.name, param.name)}
                          oninput={e => setVal(op.name, param.name, Number(e.currentTarget.value))}
                          placeholder={param.placeholder}
                          step={param.kind === "float" ? "0.000001" : "1"}
                        />
                      </label>

                    {:else}
                      <!-- Text / hex input, with optional action button -->
                      <label>
                        <span class="lbl">{param.label || param.name}</span>
                        {#if param.action}
                          <div class="key-row">
                            <input
                              value={getStr(op.name, param.name)}
                              oninput={e => setVal(op.name, param.name, e.currentTarget.value)}
                              placeholder={param.placeholder}
                              class:mono={param.kind === "hex"}
                            />
                            <button class="sm" onclick={() => handleAction(op.name, param)}>Generate</button>
                          </div>
                          {#if derivedPubKeys[key(op.name, param.name)]}
                            <div class="derived-pub">
                              <span class="lbl-sm">Public key (derived)</span>
                              <input value={derivedPubKeys[key(op.name, param.name)]} readonly class="mono dim" />
                            </div>
                          {/if}
                        {:else}
                          <input
                            value={getStr(op.name, param.name)}
                            oninput={e => setVal(op.name, param.name, e.currentTarget.value)}
                            placeholder={param.placeholder}
                            class:mono={param.kind === "hex"}
                          />
                        {/if}
                      </label>
                    {/if}
                  {/if}
                {/each}
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}
  {/each}

  <button class="primary" onclick={encode}>Encode</button>

  {#if resultError}
    <div class="error">{resultError}</div>
  {/if}

  {#if result}
    <div class="output-hdr">
      Encoded hex
      <button class="copy-btn" onclick={copy}>{copied ? "✓ Copied" : "Copy"}</button>
    </div>
    <div class="hex-out">{result}</div>
    <div class="byte-count">{result.length / 2} bytes</div>
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
  .type-tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .type-tabs button {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #8b949e;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    padding: 8px 14px;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
    min-width: 110px;
  }
  .type-tabs button:hover { background: #21262d; color: #e6edf3; }
  .type-tabs button.active {
    background: #21262d;
    border-color: #1f6feb;
    color: #79c0ff;
  }
  .sub {
    font-size: 10px;
    font-weight: 400;
    color: #6e7681;
  }
  .type-tabs button.active .sub { color: #8b949e; }

  .fields { display: flex; flex-direction: column; gap: 10px; }
  .mode-toggle { display: flex; gap: 0; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; width: fit-content; }
  .mode-toggle button { background: #0d1117; border: none; border-radius: 0; color: #8b949e; font-size: 12px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
  .mode-toggle button:hover { background: #21262d; color: #e6edf3; }
  .mode-toggle button.active { background: #21262d; color: #79c0ff; font-weight: 600; }
  .mode-toggle button:not(:last-child) { border-right: 1px solid #30363d; }

  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  label { display: flex; flex-direction: column; gap: 4px; }
  .lbl {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #8b949e;
  }
  .lbl-sm {
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6e7681;
    margin-top: 4px;
  }
  input, textarea, select {
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #e6edf3;
    font-size: 13px;
    padding: 8px 10px;
    outline: none;
    resize: vertical;
    width: 100%;
    font-family: inherit;
    box-sizing: border-box;
  }
  input:focus, textarea:focus, select:focus { border-color: #58a6ff; }
  .mono { font-family: "Cascadia Code", "Fira Code", monospace; font-size: 12px; }
  .dim { color: #8b949e; }
  .key-row { display: flex; gap: 6px; }
  .key-row input { flex: 1; }
  .derived-pub { display: flex; flex-direction: column; gap: 2px; }

  /* Toggle button — same design as the JSON toggle in DecodePanel */
  .toggle-btn {
    align-items: center;
    align-self: flex-start;
    background: #0d1117;
    border: 1px solid #30363d;
    border-radius: 6px;
    color: #8b949e;
    display: inline-flex;
    font-size: 13px;
    font-weight: 400;
    gap: 8px;
    padding: 7px 12px;
    width: fit-content;
  }
  .toggle-btn:hover { background: #21262d; color: #e6edf3; }
  .toggle-btn.active { background: #1f3a5c; border-color: #1f6feb; color: #79c0ff; }
  .toggle-dot {
    background: #30363d;
    border-radius: 999px;
    box-shadow: inset 0 0 0 1px #6e7681;
    flex-shrink: 0;
    height: 8px;
    width: 8px;
  }
  .toggle-btn.active .toggle-dot {
    background: #3fb950;
    box-shadow: 0 0 0 2px rgba(63, 185, 80, 0.18);
  }

  button { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; cursor: pointer; font-size: 13px; padding: 8px 14px; transition: background 0.1s; font-family: inherit; }
  button:hover { background: #30363d; }
  button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; font-weight: 600; }
  button.primary:hover { background: #388bfd; }
  button.sm { padding: 8px 10px; font-size: 12px; white-space: nowrap; }

  .error { background: #3d1f1f; border: 1px solid #6e2a2a; border-radius: 6px; color: #f97583; font-size: 12px; padding: 8px 10px; }

  .output-hdr { display: flex; align-items: center; justify-content: space-between; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #8b949e; }
  .copy-btn { padding: 3px 8px; font-size: 11px; }
  .hex-out { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #79c0ff; font-family: "Cascadia Code", "Fira Code", monospace; font-size: 12px; padding: 10px; word-break: break-all; line-height: 1.7; }
  .byte-count { font-size: 11px; color: #6e7681; text-align: right; margin-top: -8px; }
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import { createHighlighterCore, type HighlighterCore } from "shiki/core";
  import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
  import jsonLang from "@shikijs/langs/json";
  import githubDark from "@shikijs/themes/github-dark";
  import {
    isError,
    fmtTimestamp,
    type MeshcoreWasm,
    type Envelope,
  } from "./wasm";
  import { OpMetas, type OpMeta, type ParamMeta, type ResultMeta } from "./wasm.gen";
  import { hashState, queryState, readStoredState, writeStoredState, writeUrlState } from "./urlState";

  let { mc }: { mc: MeshcoreWasm } = $props();

  // ── decode ops (step 2 forms) ─────────────────────────────────────────────

  // All decode ops with a packetType (excludes decodeEnvelope which has no packetType)
  const decodeOps = OpMetas.filter(op => op.category === "decode" && op.packetType !== "");

  // packetType → all ops that can decode it (may have variants, e.g. GRP_TXT by name/secret)
  function opsForType(pktType: string): OpMeta[] {
    return decodeOps.filter(op => op.packetType === pktType);
  }

  // A decode op is "auto" if all its params have autoFill (no user input needed)
  function isAutoOp(op: OpMeta): boolean {
    return op.params.every(p => !!p.autoFill);
  }

  // ── Step 1: envelope ─────────────────────────────────────────────────────────
  let hexInput     = $state("");
  let envelope     = $state<Envelope | null>(null);
  let envelopeErr  = $state("");

  // ── Step 2: payload decode ───────────────────────────────────────────────────
  // Generic string-keyed form values for decode forms: `${opName}:${paramName}`
  let dvals = $state<Record<string, unknown>>({});

  // packetType → active variant op.name
  let dVariants = $state<Record<string, string>>({});

  // Derived public keys: key(opName, paramName) → pubkey string
  let derivedPubKeys = $state<Record<string, string>>({});

  // Decode result (raw map from the op)
  let payloadResult = $state<{ op: OpMeta; data: Record<string, unknown> } | null>(null);
  let payloadErr    = $state("");

  let urlReady      = $state(false);
  let showJSON      = $state(false);
  let jsonHTML      = $state("");
  let highlightRun  = 0;
  let highlighter: Promise<HighlighterCore> | undefined;

  function dkey(opName: string, pName: string) { return `${opName}:${pName}`; }
  function getDStr(opName: string, pName: string) { return String(dvals[dkey(opName, pName)] ?? ""); }
  function setDVal(opName: string, pName: string, v: unknown) { dvals[dkey(opName, pName)] = v; }

  function activeDecodeOp(pktType: string): OpMeta | undefined {
    const ops = opsForType(pktType);
    if (!ops.length) return undefined;
    const variantName = dVariants[pktType];
    return ops.find(op => op.name === variantName) ?? ops[0];
  }

  // ── Session storage persistence ───────────────────────────────────────────

  onMount(() => {
    const q = queryState();
    const h = hashState();
    const stored = readStoredState("decode");
    const sq = stored.query;
    const sh = stored.hash;

    hexInput = q.get("d_packet") ?? sq.get("d_packet") ?? hexInput;
    showJSON = (q.get("d_json") ?? sq.get("d_json")) === "1";

    // Restore decode form values from session storage
    try {
      const dv = sessionStorage.getItem("meshcore-packet-tool:decode-vals");
      if (dv) dvals = JSON.parse(dv);
      const dvr = sessionStorage.getItem("meshcore-packet-tool:decode-variants");
      if (dvr) dVariants = JSON.parse(dvr);
    } catch {}

    // Legacy compat: also check old specific keys for GRP_TXT / TXT_MSG
    for (const op of decodeOps) {
      if (op.packetType === "GRP_TXT" && op.tabLabel === "By name") {
        const ch = q.get("d_channel") ?? sq.get("d_channel");
        if (ch) setDVal(op.name, "channelName", ch);
        const secret = h.get("d_secret") ?? sh.get("d_secret");
        if (secret) {
          const secOp = opsForType("GRP_TXT").find(o => o.tabLabel === "By secret");
          if (secOp) setDVal(secOp.name, "secret", secret);
        }
      }
      if (op.packetType === "TXT_MSG") {
        const priv = h.get("d_private") ?? sh.get("d_private");
        if (priv) setDVal(op.name, "privKey", priv);
        const peer = q.get("d_peer_pub") ?? sq.get("d_peer_pub");
        if (peer) setDVal(op.name, "peerPubKey", peer);
      }
    }

    urlReady = true;

    // Auto-parse if hex is pre-filled
    if (hexInput) {
      if (parseEnvelope()) {
        // Auto-decode if the active decode op for this type is an auto-op
        if (envelope) {
          const ops = opsForType(envelope.type);
          const op = ops[0];
          if (op && isAutoOp(op)) runDecode(envelope.type);
          // If not auto, try to run if all user params already have values
          else if (op) {
            const allFilled = op.params.filter(p => !p.autoFill).every(p => getDStr(op.name, p.name).trim() !== "");
            if (allFilled) runDecode(envelope.type);
          }
        }
      }
    }
  });

  $effect(() => {
    if (!urlReady) return;
    // Persist form values
    try {
      sessionStorage.setItem("meshcore-packet-tool:decode-vals", JSON.stringify(dvals));
      sessionStorage.setItem("meshcore-packet-tool:decode-variants", JSON.stringify(dVariants));
    } catch {}

    // URL state — write active decode keys for shareable links
    const grpTxtByNameOp = opsForType("GRP_TXT").find(o => o.tabLabel === "By name");
    const txtMsgOp       = opsForType("TXT_MSG")[0];

    writeStoredState(
      "decode",
      {
        d_packet: hexInput,
        d_json: showJSON ? "1" : "",
        d_key_mode: grpTxtByNameOp ? (dVariants["GRP_TXT"] === grpTxtByNameOp.name ? "name" : "secret") : "name",
        d_channel: grpTxtByNameOp ? getDStr(grpTxtByNameOp.name, "channelName") : "",
        d_peer_pub: txtMsgOp ? getDStr(txtMsgOp.name, "peerPubKey") : "",
      },
      {
        d_secret: opsForType("GRP_TXT").find(o => o.tabLabel === "By secret")
          ? getDStr(opsForType("GRP_TXT").find(o => o.tabLabel === "By secret")!.name, "secret")
          : "",
        d_private: txtMsgOp ? getDStr(txtMsgOp.name, "privKey") : "",
      },
    );
    writeUrlState(
      {
        view: "decode",
        d_packet: hexInput,
        d_json: showJSON ? "1" : null,
      },
      {},
    );
  });

  $effect(() => {
    void updateHighlightedJSON(showJSON, decodedJSON());
  });

  // ── Step 1 functions ────────────────────────────────────────────────────────

  function clearPayload() {
    payloadResult = null;
    payloadErr = "";
  }

  function parseEnvelope(): boolean {
    envelope = null;
    envelopeErr = "";
    clearPayload();
    const h = hexInput.trim().replace(/\s/g, "");
    if (!h) { envelopeErr = "Paste a hex packet first."; return false; }
    const r = mc.decodeEnvelope(h);
    if (isError(r)) { envelopeErr = r.error; return false; }
    envelope = r;
    // Auto-decode immediately for types with no user input needed
    if (envelope) {
      const ops = opsForType(envelope.type);
      if (ops.length > 0 && isAutoOp(ops[0])) {
        runDecode(envelope.type);
      }
    }
    return true;
  }

  // ── Step 2 decode function ──────────────────────────────────────────────────

  function runDecode(pktType: string) {
    if (!envelope) return;
    payloadErr = "";
    payloadResult = null;

    const op = activeDecodeOp(pktType);
    if (!op) { payloadErr = `No decoder for ${pktType}.`; return; }

    // Build args in param order, substituting autoFill values from envelope
    const argList: unknown[] = [];
    for (const param of op.params) {
      if (param.autoFill === "payloadHex") {
        argList.push(envelope.payloadHex);
      } else {
        argList.push(getDStr(op.name, param.name));
      }
    }

    const fn = (mc as Record<string, (...args: unknown[]) => unknown>)[op.name];
    if (typeof fn !== "function") { payloadErr = `Unknown op: ${op.name}`; return; }
    const r = fn(...argList) as Record<string, unknown> | { error: string };
    if (isError(r)) {
      payloadErr = r.error;
    } else {
      payloadResult = { op, data: r as Record<string, unknown> };
    }
  }

  function handleDecodeAction(op: OpMeta, param: ParamMeta) {
    payloadErr = "";
    const kp = mc.generateKeypair();
    if (isError(kp)) { payloadErr = kp.error; return; }
    if (param.action === "keypair") {
      setDVal(op.name, param.name, kp.privateKey);
      derivedPubKeys[dkey(op.name, param.name)] = kp.publicKey;
    } else if (param.action === "keypair-pub") {
      setDVal(op.name, param.name, kp.publicKey);
    }
  }

  // ── JSON view ───────────────────────────────────────────────────────────────

  function decodedJSON(): string {
    return JSON.stringify({ envelope, payload: payloadResult?.data ?? null }, null, 2);
  }

  async function updateHighlightedJSON(enabled: boolean, json: string) {
    const run = ++highlightRun;
    if (!enabled || !envelope) { jsonHTML = ""; return; }
    highlighter ??= createHighlighterCore({
      themes: [githubDark], langs: jsonLang,
      engine: createJavaScriptRegexEngine(),
    });
    const html = (await highlighter).codeToHtml(json, { lang: "json", theme: "github-dark" });
    if (run === highlightRun) jsonHTML = html;
  }

  // ── Result field rendering helpers ──────────────────────────────────────────

  function fmtResultValue(rf: ResultMeta, val: unknown): string {
    if (val == null) return "(none)";
    if (rf.kind === "number" && (rf.name.includes("timestamp") || rf.name === "timestamp")) {
      return `${val} — ${fmtTimestamp(Number(val))}`;
    }
    if (rf.kind === "string[]") {
      return (val as string[]).join(" → ") || "(empty)";
    }
    if (typeof val === "boolean") return val ? "yes" : "no";
    return String(val);
  }

  function isHighlightField(rf: ResultMeta): boolean {
    // Show "message text" in a highlighted box
    return rf.name === "text";
  }

  function isNodeName(rf: ResultMeta): boolean {
    return rf.name === "name" && rf.label === "Node name";
  }
</script>

<div class="panel">

  <!-- ── Step 1 ─────────────────────────────────────────────────────────────── -->
  <section>
    <h3>Step 1 — parse envelope</h3>
    <label>
      <span class="lbl">Hex packet</span>
      <textarea bind:value={hexInput} placeholder="Paste hex-encoded MeshCore packet…" rows={4} class="mono"></textarea>
    </label>
    <button class="primary" onclick={parseEnvelope}>Parse</button>
    {#if envelopeErr}
      <div class="error">{envelopeErr}</div>
    {/if}
  </section>

  <!-- ── Envelope result ─────────────────────────────────────────────────────── -->
  {#if envelope}
    <div class="card">
      <div class="card-hdr">
        <span class="type-badge">{envelope.type}</span>
        <span class="route-badge">{envelope.route}</span>
        {#if envelope.version > 0}<span class="ver-badge">v{envelope.version}</span>{/if}
      </div>
      <table>
        <tbody>
          <tr><td>Route</td><td>{envelope.route}</td></tr>
          <tr><td>Payload type</td><td class="mono">{envelope.type} <span class="dim">(0x{envelope.typeCode.toString(16).padStart(2,"0")})</span></td></tr>
          <tr><td>Version</td><td>{envelope.version}</td></tr>
          <tr><td>Path hash size</td><td>{envelope.pathHashSize} byte{envelope.pathHashSize !== 1 ? "s" : ""} per hop</td></tr>
          <tr><td>Hops</td><td>{envelope.hopCount === 0 ? "0 (fresh)" : envelope.hops.join(" → ")}</td></tr>
          {#if envelope.isTransport && envelope.transportCodes}
            <tr><td>Transport codes</td><td class="mono">0x{envelope.transportCodes[0].toString(16).padStart(4,"0")} 0x{envelope.transportCodes[1].toString(16).padStart(4,"0")}</td></tr>
          {/if}
          <tr><td>Payload ({envelope.payloadHex.length/2}B)</td><td class="mono hex-wrap">{envelope.payloadHex}</td></tr>
        </tbody>
      </table>
    </div>

    <button class:active={showJSON} class="json-toggle" onclick={() => (showJSON = !showJSON)}>
      <span class="json-toggle-dot"></span>
      <span>{showJSON ? "Hide decoded JSON" : "Show decoded JSON"}</span>
    </button>

    {#if showJSON}
      <div class="json-out">
        {#if jsonHTML}
          {@html jsonHTML}
        {:else}
          <pre>{decodedJSON()}</pre>
        {/if}
      </div>
    {/if}

    <!-- ── Step 2 ──────────────────────────────────────────────────────────── -->
    {@const step2Ops = opsForType(envelope.type)}
    {#if step2Ops.length > 0}
      {@const activeOp = activeDecodeOp(envelope.type)!}
      {@const userParams = activeOp.params.filter(p => !p.autoFill)}
      {@const needsInput = userParams.length > 0}

      <section class="step2">
        <h3>Step 2 — decode {envelope.type} payload</h3>

        <!-- Variant toggle for types with multiple decode variants -->
        {#if step2Ops.length > 1}
          <div class="mode-toggle">
            {#each step2Ops as variant}
              <button
                class:active={activeOp.name === variant.name}
                onclick={() => { dVariants[envelope!.type] = variant.name; clearPayload(); }}
              >{variant.tabLabel || variant.label}</button>
            {/each}
          </div>
        {/if}

        <!-- User-input params (autoFill params are invisible — they come from the envelope) -->
        {#each userParams as param}
          <label>
            <span class="lbl">{param.label || param.name}</span>
            {#if param.action}
              <div class="key-row">
                <input
                  value={getDStr(activeOp.name, param.name)}
                  oninput={e => setDVal(activeOp.name, param.name, e.currentTarget.value)}
                  placeholder={param.placeholder}
                  class:mono={param.kind === "hex"}
                />
                <button class="sm" onclick={() => handleDecodeAction(activeOp, param)}>Generate</button>
              </div>
              {#if derivedPubKeys[dkey(activeOp.name, param.name)]}
                <input value={derivedPubKeys[dkey(activeOp.name, param.name)]} readonly class="mono dim" style="margin-top:4px" />
              {/if}
            {:else}
              <input
                value={getDStr(activeOp.name, param.name)}
                oninput={e => setDVal(activeOp.name, param.name, e.currentTarget.value)}
                placeholder={param.placeholder}
                class:mono={param.kind === "hex"}
              />
            {/if}
          </label>
        {/each}

        {#if needsInput}
          <button onclick={() => runDecode(envelope!.type)}>Decrypt</button>
        {/if}

        {#if payloadErr}
          <div class="error">{payloadErr}</div>
        {/if}

        <!-- Result display -->
        {#if payloadResult}
          {@const resultOp = payloadResult.op}
          {@const data = payloadResult.data}
          <div class="payload-card">
            <!-- Highlight: message text or node name -->
            {#each resultOp.result as rf}
              {#if isHighlightField(rf) && data[rf.name] != null}
                <div class="msg-text">"{data[rf.name]}"</div>
              {/if}
              {#if isNodeName(rf) && data[rf.name]}
                <div class="node-name">📡 {data[rf.name]}</div>
              {/if}
            {/each}

            <table>
              <tbody>
                {#each resultOp.result as rf}
                  {#if !isHighlightField(rf) && !isNodeName(rf)}
                    {#if !rf.optional || data[rf.name] != null}
                      <tr>
                        <td>{rf.label || rf.name}</td>
                        <td
                          class:mono={rf.kind === "string" && rf.name !== "text"}
                          class:hex-wrap={rf.name.endsWith("Hex") || rf.name === "publicKey" || rf.name === "senderPubKey"}
                        >{fmtResultValue(rf, data[rf.name])}</td>
                      </tr>
                    {/if}
                  {/if}
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

    {:else}
      <!-- No structured decoder for this packet type -->
      <div class="info-note">
        Raw payload ({envelope.payloadHex.length/2} bytes) — no structured decoder for <strong>{envelope.type}</strong>.
      </div>
    {/if}
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
    gap: 20px;
  }
  section { display: flex; flex-direction: column; gap: 10px; }
  .step2 { border-top: 1px solid #21262d; padding-top: 20px; }
  h3 { margin: 0; font-size: 13px; font-weight: 600; color: #8b949e; text-transform: uppercase; letter-spacing: 0.06em; }
  label { display: flex; flex-direction: column; gap: 4px; }
  .lbl { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #8b949e; }
  input, textarea {
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    color: #e6edf3; font-size: 13px; padding: 8px 10px; outline: none;
    resize: vertical; width: 100%; font-family: inherit; box-sizing: border-box;
  }
  input:focus, textarea:focus { border-color: #58a6ff; }
  .mono { font-family: "Cascadia Code", "Fira Code", monospace; font-size: 12px; }
  .dim { color: #8b949e; }
  .key-row { display: flex; gap: 6px; }
  .key-row input { flex: 1; }

  button { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; cursor: pointer; font-size: 13px; padding: 8px 14px; transition: background 0.1s; font-family: inherit; }
  button:hover { background: #30363d; }
  button.primary { background: #1f6feb; border-color: #1f6feb; color: #fff; font-weight: 600; }
  button.primary:hover { background: #388bfd; }
  button.sm { padding: 8px 10px; font-size: 12px; white-space: nowrap; }

  .mode-toggle { display: flex; gap: 0; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; width: fit-content; }
  .mode-toggle button { background: #0d1117; border: none; border-radius: 0; color: #8b949e; font-size: 12px; padding: 5px 12px; cursor: pointer; font-family: inherit; }
  .mode-toggle button:hover { background: #21262d; color: #e6edf3; }
  .mode-toggle button.active { background: #21262d; color: #79c0ff; font-weight: 600; }
  .mode-toggle button:not(:last-child) { border-right: 1px solid #30363d; }

  .json-toggle {
    align-items: center; align-self: flex-start; background: #0d1117;
    border: 1px solid #30363d; color: #8b949e; display: inline-flex;
    font-size: 12px; gap: 8px; padding: 6px 10px; width: fit-content;
  }
  .json-toggle:hover { background: #21262d; color: #e6edf3; }
  .json-toggle.active { background: #1f3a5c; border-color: #1f6feb; color: #79c0ff; }
  .json-toggle-dot { background: #30363d; border-radius: 999px; box-shadow: inset 0 0 0 1px #6e7681; height: 8px; width: 8px; }
  .json-toggle.active .json-toggle-dot { background: #3fb950; box-shadow: 0 0 0 2px rgba(63, 185, 80, 0.18); }
  .json-out {
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    color: #d2a8ff; font-family: "Cascadia Code", "Fira Code", monospace;
    font-size: 12px; line-height: 1.55; margin: 0; padding: 12px;
  }
  .json-out :global(pre) { background: transparent !important; margin: 0; overflow: visible; white-space: pre-wrap; word-break: break-word; }
  .json-out :global(code) { white-space: pre-wrap; word-break: break-word; }
  .error { background: #3d1f1f; border: 1px solid #6e2a2a; border-radius: 6px; color: #f97583; font-size: 12px; padding: 8px 10px; }
  .info-note { background: #1c2128; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; font-size: 12px; padding: 10px 12px; }

  /* Envelope card */
  .card { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
  .card-hdr { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #21262d; flex-wrap: wrap; }
  .type-badge { background: #1f3a5c; color: #79c0ff; border: 1px solid #1f6feb; border-radius: 4px; font-size: 12px; font-weight: 600; padding: 2px 8px; font-family: monospace; }
  .route-badge { background: #1c2128; color: #8b949e; border: 1px solid #30363d; border-radius: 4px; font-size: 11px; padding: 2px 8px; }
  .ver-badge { background: #1c2128; color: #6e7681; border: 1px solid #30363d; border-radius: 4px; font-size: 11px; padding: 2px 8px; }

  /* Shared table */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 6px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  td:first-child { color: #8b949e; width: 40%; white-space: nowrap; font-size: 12px; }
  td:last-child { color: #e6edf3; }
  .dim { color: #6e7681; }
  .hex-wrap { word-break: break-all; line-height: 1.6; }

  /* Payload result card */
  .payload-card { background: #0d1117; border: 1px solid #238636; border-radius: 6px; overflow: hidden; }
  .msg-text { padding: 10px 12px; color: #7ee787; font-size: 14px; border-bottom: 1px solid #21262d; word-break: break-word; }
  .node-name { padding: 10px 12px; color: #f0f6fc; font-size: 15px; font-weight: 600; border-bottom: 1px solid #21262d; }
</style>

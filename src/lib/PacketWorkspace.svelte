<script lang="ts">
  import { onMount } from "svelte";
  import { createHighlighterCore, type HighlighterCore } from "shiki/core";
  import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
  import jsonLang from "@shikijs/langs/json";
  import githubDark from "@shikijs/themes/github-dark";
  import { isError, fmtTimestamp, type MeshcoreWasm, type Envelope } from "./wasm";
  import { hashState, queryState, writeUrlState, readStoredState, writeStoredState } from "./urlState";
  import { OpMetas, type OpMeta, type ParamMeta, type ResultMeta } from "./wasm";
  import BenchmarkPanel from "./BenchmarkPanel.svelte";

  let { mc }: { mc: MeshcoreWasm } = $props();

  // ── op lookup tables ──────────────────────────────────────────────────────────
  const encodeOps = OpMetas.filter(op => op.category === "encode");
  const decodeOps = OpMetas.filter(op => op.category === "decode" && op.packetType !== "");

  const encodeTabGroups: string[] = [];
  for (const op of encodeOps) {
    if (!encodeTabGroups.includes(op.tabGroup)) encodeTabGroups.push(op.tabGroup);
  }

  function opsForEncodeTab(tg: string): OpMeta[] { return encodeOps.filter(op => op.tabGroup === tg); }
  function opsForDecodeType(pt: string): OpMeta[] { return decodeOps.filter(op => op.packetType === pt); }
  function isAutoOp(op: OpMeta): boolean { return op.params.every(p => !!p.autoFill); }
  function tabMeta(tg: string): OpMeta { return opsForEncodeTab(tg)[0]; }

  // ── shared hex ────────────────────────────────────────────────────────────────
  let hex    = $state("");
  let mode   = $state<"decode" | "encode" | "benchmark">("decode");
  let copied = $state(false);

  // ── timing ────────────────────────────────────────────────────────────────────
  let opMs = $state<number | null>(null);

  // ── encode state ──────────────────────────────────────────────────────────────
  let eTab      = $state(encodeTabGroups[0] ?? "");
  let eVariants = $state<Record<string, string>>({});
  let eVals     = $state<Record<string, unknown>>({});
  let ePubKeys  = $state<Record<string, string>>({});
  let eError    = $state("");

  // ── decode state ─────────────────────────────────────────────────────────────
  // NOTE: these are write-only inside the auto-decode $effect (never read inside that effect)
  let envelope   = $state<Envelope | null>(null);
  let envError   = $state("");
  let dVals      = $state<Record<string, unknown>>({});
  let dVariants  = $state<Record<string, string>>({});
  let dPubKeys   = $state<Record<string, string>>({});
  let payload    = $state<{ op: OpMeta; data: Record<string, unknown> } | null>(null);
  let payloadErr = $state("");
  let showJson   = $state(false);
  let jsonHtml   = $state("");
  let hlRun      = 0;
  let hlInstance: Promise<HighlighterCore> | undefined;

  async function updateJsonHtml(enabled: boolean) {
    const run = ++hlRun;
    if (!enabled || !envelope) { jsonHtml = ""; return; }
    hlInstance ??= createHighlighterCore({ themes: [githubDark], langs: jsonLang, engine: createJavaScriptRegexEngine() });
    const json = JSON.stringify({ envelope, payload: payload?.data ?? null }, null, 2);
    const html = (await hlInstance).codeToHtml(json, { lang: "json", theme: "github-dark" });
    if (run === hlRun) jsonHtml = html;
  }

  $effect(() => { void showJson; void envelope; void payload; updateJsonHtml(showJson); });

  // ── key helpers ───────────────────────────────────────────────────────────────
  function ek(opName: string, pName: string) { return `e:${opName}:${pName}`; }
  function dk(opName: string, pName: string) { return `d:${opName}:${pName}`; }

  function getEStr(n: string, p: string): string  { return String(eVals[ek(n, p)] ?? ""); }
  function getENum(n: string, p: string): number   { return Number(eVals[ek(n, p)] ?? 0); }
  function getEBool(n: string, p: string): boolean { return Boolean(eVals[ek(n, p)]); }
  function setEVal(n: string, p: string, v: unknown) { eVals[ek(n, p)] = v; }

  function getDStr(n: string, p: string): string  { return String(dVals[dk(n, p)] ?? ""); }
  function setDVal(n: string, p: string, v: unknown) { dVals[dk(n, p)] = v; }

  function currentEncodeOp(): OpMeta | undefined {
    const ops = opsForEncodeTab(eTab);
    return ops.find(o => o.name === eVariants[eTab]) ?? ops[0];
  }
  function currentDecodeOp(pt: string): OpMeta | undefined {
    const ops = opsForDecodeType(pt);
    return ops.find(o => o.name === dVariants[pt]) ?? ops[0];
  }

  // ── auto-encode ───────────────────────────────────────────────────────────────
  // Reads:  mode, eVals, eTab, eVariants
  // Writes: hex, eError, opMs
  // No cycle: written vars are not read inside this effect.
  $effect(() => {
    if (mode !== "encode") return; // also skips "benchmark"

    // Explicitly read reactive deps so Svelte tracks them
    void JSON.stringify(eVals);
    void eTab;
    void JSON.stringify(eVariants);

    const op = currentEncodeOp();
    if (!op) return;

    const args: unknown[] = [];
    for (const p of op.params) {
      if (p.autoFill) continue;
      switch (p.kind) {
        case "int":   args.push(p.widget === "checkbox" ? (getEBool(op.name, p.name) ? 1 : 0) : Math.trunc(getENum(op.name, p.name))); break;
        case "float": args.push(getENum(op.name, p.name)); break;
        default:      args.push(getEStr(op.name, p.name));
      }
    }

    const fn = (mc as Record<string, (...a: unknown[]) => unknown>)[op.name];
    if (typeof fn !== "function") return;

    const t0 = performance.now();
    const r = fn(...args) as { hex?: string } | { error: string };
    opMs = +(performance.now() - t0).toFixed(2);

    if (isError(r)) {
      eError = r.error;
    } else {
      eError = "";
      hex = String((r as { hex?: string }).hex ?? "");
    }
  });

  // ── auto-decode ───────────────────────────────────────────────────────────────
  // Reads:  mode, hex
  // Writes: envelope, envError, payload, payloadErr, opMs
  // CRITICAL: never read envelope/payload/payloadErr here — that would cause a cycle.
  $effect(() => {
    if (mode !== "decode") return;

    const h = hex.trim().replace(/\s/g, "");
    if (!h) {
      envelope   = null;
      envError   = "";
      payload    = null;
      payloadErr = "";
      opMs       = null;
      return;
    }

    const t0 = performance.now();
    const r = mc.decodeEnvelope(h);
    opMs = +(performance.now() - t0).toFixed(2);

    if (isError(r)) {
      envelope   = null;
      envError   = r.error;
      payload    = null;
      payloadErr = "";
      return;
    }

    envelope   = r;
    envError   = "";
    // Always reset step-2 result when the hex changes
    payload    = null;
    payloadErr = "";

    // Auto-decode types that need no user input (ADVERT, ACK, CONTROL…)
    const ops = opsForDecodeType(r.type);
    if (ops.length > 0 && isAutoOp(ops[0])) {
      runDecodeOp(ops[0], r.payloadHex);
    }
  });

  // ── mode switching ────────────────────────────────────────────────────────────
  const typeToEncodeTab: Record<string, string> = {
    GRP_TXT: "grptxt", TXT_MSG: "txtmsg", ADVERT: "advert",
    ACK: "ack", GRP_DATA: "grpdata", REQ: "req",
    ANON_REQ: "anonreq", CONTROL: "control",
  };

  function switchToEncode() {
    if (mode === "encode") return;
    if (envelope) {
      const tab = typeToEncodeTab[envelope.type] ?? "raw";
      eTab = encodeTabGroups.includes(tab) ? tab : "raw";

      // Always pre-populate the RAW form with envelope header fields
      const rawOp = encodeOps.find(o => o.tabGroup === "raw");
      if (rawOp) {
        setEVal(rawOp.name, "route",        envelope.routeCode);
        setEVal(rawOp.name, "payloadType",  envelope.typeCode);
        setEVal(rawOp.name, "version",      envelope.version);
        setEVal(rawOp.name, "pathHashSize", envelope.pathHashSize);
        setEVal(rawOp.name, "payload",      envelope.payloadHex);
      }
      // Pre-populate ADVERT form if we decoded it
      if (envelope.type === "ADVERT" && payload) {
        const op = encodeOps.find(o => o.tabGroup === "advert");
        if (op) {
          const d = payload.data;
          if (d.publicKey) setEVal(op.name, "pubKey", String(d.publicKey));
          if (d.name)      setEVal(op.name, "name",   String(d.name));
          if (d.hasGPS) {
            setEVal(op.name, "hasGPS", 1);
            if (d.lat != null) setEVal(op.name, "lat", Number(d.lat));
            if (d.lon != null) setEVal(op.name, "lon", Number(d.lon));
          }
        }
      }
    }
    mode = "encode";
  }

  function switchToDecode() {
    if (mode === "decode") return;
    mode = "decode";
    // auto-decode effect fires automatically via the mode change
  }

  // ── decode step 2 ─────────────────────────────────────────────────────────────
  function runDecodeOp(op: OpMeta, payloadHex: string) {
    payloadErr = "";
    payload    = null;
    const args: unknown[] = op.params.map(p =>
      p.autoFill === "payloadHex" ? payloadHex : getDStr(op.name, p.name)
    );
    const fn = (mc as Record<string, (...a: unknown[]) => unknown>)[op.name];
    if (typeof fn !== "function") { payloadErr = `Unknown op: ${op.name}`; return; }
    const r = fn(...args) as Record<string, unknown> | { error: string };
    if (isError(r)) { payloadErr = r.error; }
    else { payload = { op, data: r as Record<string, unknown> }; }
  }

  function runDecode(pt: string) {
    if (!envelope) return;
    const op = currentDecodeOp(pt);
    if (op) runDecodeOp(op, envelope.payloadHex);
  }

  // ── keypair actions ───────────────────────────────────────────────────────────
  function encodeAction(op: OpMeta, p: ParamMeta) {
    const kp = mc.generateKeypair();
    if (isError(kp)) return;
    if (p.action === "keypair")      { setEVal(op.name, p.name, kp.privateKey); ePubKeys[ek(op.name, p.name)] = kp.publicKey; }
    else if (p.action === "keypair-pub") setEVal(op.name, p.name, kp.publicKey);
  }
  function decodeAction(op: OpMeta, p: ParamMeta) {
    const kp = mc.generateKeypair();
    if (isError(kp)) return;
    if (p.action === "keypair")      { setDVal(op.name, p.name, kp.privateKey); dPubKeys[dk(op.name, p.name)] = kp.publicKey; }
    else if (p.action === "keypair-pub") setDVal(op.name, p.name, kp.publicKey);
  }

  // ── form layout helpers ───────────────────────────────────────────────────────
  function layoutRows(params: ParamMeta[]): ParamMeta[][] {
    const rows: ParamMeta[][] = [];
    const seen = new Set<string>();
    for (const p of params) {
      if (p.autoFill) continue;
      if (p.group) {
        if (seen.has(p.group)) continue;
        seen.add(p.group);
        rows.push(params.filter(q => q.group === p.group && !q.autoFill));
      } else {
        rows.push([p]);
      }
    }
    return rows;
  }

  function eVisible(opName: string, p: ParamMeta): boolean {
    return !p.showWhen || getENum(opName, p.showWhen) === p.showValue;
  }

  // ── copy ──────────────────────────────────────────────────────────────────────
  async function doCopy() {
    if (!hex) return;
    await navigator.clipboard.writeText(hex);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  // ── result display ────────────────────────────────────────────────────────────
  function fmtVal(rf: ResultMeta, v: unknown): string {
    if (v == null) return "(none)";
    if (rf.kind === "number" && rf.name.includes("timestamp")) return fmtTimestamp(Number(v));
    if (rf.kind === "string[]") return (v as string[]).join(" → ") || "(empty)";
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v);
  }

  // ── session storage (debounced) ───────────────────────────────────────────────
  let mounted = $state(false);
  const SS = "meshcore-packet-tool:workspace";
  let saveTimer: ReturnType<typeof setTimeout> | undefined;

  function autosize(el: HTMLTextAreaElement) {
    function resize() { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
    resize();
    $effect(() => { void hex; resize(); });
  }

  // URL param → dVals key mappings for shareable decode state
  const URL_D_CHANNEL  = ["d:decodeGroupText:channelName", "d:decodeGrpData:channelName"];
  const URL_D_PEER_PUB = ["d:decodeDirectText:peerPubKey", "d:decodeReq:peerPubKey", "d:decodeResponse:peerPubKey", "d:decodePath:peerPubKey"];
  const URL_D_SECRET   = ["d:decodeGroupTextSecret:secret", "d:decodeGrpDataSecret:secret"];
  const URL_D_PRIVATE  = ["d:decodeDirectText:privKey", "d:decodeReq:privKey", "d:decodeResponse:privKey", "d:decodePath:privKey", "d:decodeAnonReq:myPrivKey"];

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        sessionStorage.setItem(SS, JSON.stringify({
          hex, mode, eTab,
          eVariants: JSON.parse(JSON.stringify(eVariants)),
          eVals:     JSON.parse(JSON.stringify(eVals)),
          dVals:     JSON.parse(JSON.stringify(dVals)),
          dVariants: JSON.parse(JSON.stringify(dVariants)),
        }));
      } catch {}

      // Shareable URL state — packet hex in query, secrets in hash
      const dChannel  = String(dVals[URL_D_CHANNEL[0]]  ?? "");
      const dPeerPub  = String(dVals[URL_D_PEER_PUB[0]] ?? "");
      const dSecret   = String(dVals[URL_D_SECRET[0]]   ?? "");
      const dPrivate  = String(dVals[URL_D_PRIVATE[0]]  ?? "");
      const q = {
        d_packet:   hex || null,
        d_json:     showJson ? "1" : null,
        d_channel:  dChannel  || null,
        d_peer_pub: dPeerPub  || null,
      };
      const h = {
        d_secret:  dSecret  || null,
        d_private: dPrivate || null,
      };
      writeUrlState(q, h, { clearQueryPrefixes: ["d_"], clearHashPrefixes: ["d_"] });
      writeStoredState("d", q, h);
    }, 500);
  }

  onMount(() => {
    // 1. Load full workspace state from sessionStorage (UI state: mode, tabs, forms)
    try {
      const raw = sessionStorage.getItem(SS);
      if (raw) {
        const s = JSON.parse(raw) as Record<string, unknown>;
        if (typeof s.hex === "string")  hex = s.hex;
        if (s.mode === "encode")        mode = "encode";
        if (typeof s.eTab === "string" && encodeTabGroups.includes(s.eTab)) eTab = s.eTab;
        if (s.eVariants && typeof s.eVariants === "object") eVariants = s.eVariants as Record<string, string>;
        if (s.eVals    && typeof s.eVals === "object")      eVals     = s.eVals as Record<string, unknown>;
        if (s.dVals    && typeof s.dVals === "object")      dVals     = s.dVals as Record<string, unknown>;
        if (s.dVariants && typeof s.dVariants === "object") dVariants = s.dVariants as Record<string, string>;
      }
    } catch {}

    // 2. URL params + stored URL state override sessionStorage (allows sharing links)
    //    Priority: live URL > stored URL state (sessionStorage "d") > workspace sessionStorage above
    const stored = readStoredState("d");
    const uq = queryState();
    const uh = hashState();

    const dPacket  = uq.get("d_packet")  || stored.query.get("d_packet")  || "";
    const dChannel = uq.get("d_channel") || stored.query.get("d_channel") || "";
    const dPeerPub = uq.get("d_peer_pub")|| stored.query.get("d_peer_pub")|| "";
    const dShowJson= uq.get("d_json")    || stored.query.get("d_json")    || "";
    const dSecret  = uh.get("d_secret")  || stored.hash.get("d_secret")   || "";
    const dPrivate = uh.get("d_private") || stored.hash.get("d_private")  || "";

    if (dPacket)  hex = dPacket;
    if (dShowJson) showJson = true;
    if (dChannel)  for (const k of URL_D_CHANNEL)  { dVals[k] = dChannel; }
    if (dPeerPub)  for (const k of URL_D_PEER_PUB) { dVals[k] = dPeerPub; }
    if (dSecret)   for (const k of URL_D_SECRET)   { dVals[k] = dSecret; }
    if (dPrivate)  for (const k of URL_D_PRIVATE)  { dVals[k] = dPrivate; }

    mounted = true;
  });

  $effect(() => {
    if (!mounted) return;
    // Read reactive deps to track changes — writes go only to sessionStorage/URL (not reactive state)
    void hex; void mode; void eTab; void showJson;
    void JSON.stringify(eVariants); void JSON.stringify(eVals);
    void JSON.stringify(dVals);     void JSON.stringify(dVariants);
    scheduleSave();
  });
</script>

<div class="workspace">

  <!-- ── Hex textarea (always at top) ──────────────────────────────────────── -->
  <div class="hex-section">
    <div class="hex-header">
      <span class="hex-label">HEX PACKET</span>
      <div class="hex-meta">
        {#if hex.replace(/\s/g,"").length > 0}
          <span class="byte-count">{hex.replace(/\s/g,"").length / 2} bytes</span>
        {/if}
        {#if opMs !== null}
          <span class="ms-count">{opMs} ms</span>
        {/if}
        <button class="copy-btn" onclick={doCopy} disabled={!hex}>{copied ? "✓ Copied" : "Copy"}</button>
      </div>
    </div>
    <textarea
      class="hex-input mono"
      class:readonly={mode === "encode"}
      value={hex}
      oninput={mode === "decode" ? (e => { hex = e.currentTarget.value; }) : undefined}
      onclick={mode === "encode" ? () => switchToDecode() : undefined}
      placeholder={mode === "decode" ? "Paste a hex-encoded MeshCore packet to decode it…" : "Fill in the form below — encoded packet appears here"}
      rows={3}
      readonly={mode === "encode"}
      spellcheck={false}
      use:autosize
    ></textarea>
    {#if mode === "decode" && envError && hex.trim()}
      <div class="err">{envError}</div>
    {/if}
    <div class="examples">
      Examples:
      <button class="ex-link" onclick={() => hex = "0d40efbeadde"}>ACK</button>
      <button class="ex-link" onclick={() => hex = "1540d9412a330c3bfc80e2114278944c79dad5760f2e8c19e6ad26c9ece314b2307ca71950"}>GRP_TXT</button>
      <button class="ex-link" onclick={() => hex = "11453287568f06bf2d5ad94765d9aaa4aef45a465a5a84142b5abb55eafe11980bc7b891218a83ebb08f0ba84789276a31c13dad4caf71b6b7f99c1fdfccaa7c1db9d1696be4416a274f3417182d77d486d4faa2a7b3bcc2035c9d8a27af4b2ab45b2b6bc75037c31fd316829639230e929a25fc02a082dc00435a2e4e4943205265706561746572"} title="CZ.NIC Repeater, Prague — hardware capture 2026-06-09">ADVERT ✦</button>
    </div>
  </div>

  <!-- ── Mode tabs ─────────────────────────────────────────────────────────── -->
  <div class="mode-bar">
    <button class="mode-tab" class:active={mode === "decode"} onclick={switchToDecode}>↓ Decode</button>
    <button class="mode-tab" class:active={mode === "encode"} onclick={switchToEncode}>↑ Encode</button>
    <button class="mode-tab bench-tab" class:active={mode === "benchmark"} onclick={() => mode = "benchmark"}>Benchmark</button>
  </div>

  <!-- ══════════════════ DECODE ══════════════════ -->
  {#if mode === "decode"}
    <div class="panel">

    {#if envelope}
      <!-- Envelope card -->
      <div class="card">
        <div class="card-hdr">
          <span class="type-badge">{envelope.type}</span>
          <span class="pill">{envelope.route}</span>
          {#if envelope.version > 0}<span class="pill dim">v{envelope.version}</span>{/if}
          {#if envelope.hopCount > 0}<span class="pill">{envelope.hopCount} hop{envelope.hopCount !== 1 ? "s" : ""}</span>{/if}
        </div>
        <table>
          <tbody>
            <tr><td>Payload type</td><td class="mono">{envelope.type} <span class="dim">(0x{envelope.typeCode.toString(16).padStart(2,"0")})</span></td></tr>
            <tr><td>Route</td><td>{envelope.route}</td></tr>
            <tr><td>Version</td><td>{envelope.version}</td></tr>
            <tr><td>Path hash size</td><td>{envelope.pathHashSize} bytes per hop</td></tr>
            <tr><td>Hops</td><td class="mono">{envelope.hopCount === 0 ? "fresh (no hops)" : envelope.hops.join(" → ")}</td></tr>
            <tr><td>Payload ({envelope.payloadHex.length / 2}B)</td><td class="mono hex-wrap">{envelope.payloadHex}</td></tr>
            {#if envelope.isTransport && envelope.transportCodes}
              <tr><td>Transport</td><td class="mono">0x{envelope.transportCodes[0].toString(16).padStart(4,"0")} 0x{envelope.transportCodes[1].toString(16).padStart(4,"0")}</td></tr>
            {/if}
          </tbody>
        </table>
      </div>

      <!-- Step 2 -->
      {#if opsForDecodeType(envelope.type).length > 0}
        {@const step2ops = opsForDecodeType(envelope.type)}
        {@const activeOp = currentDecodeOp(envelope.type)!}
        {@const userParams = activeOp.params.filter(p => !p.autoFill)}

        <div class="step2">
          {#if step2ops.length > 1}
            <div class="seg-ctrl">
              {#each step2ops as v}
                <button
                  class:active={activeOp.name === v.name}
                  onclick={() => { dVariants[envelope!.type] = v.name; payload = null; payloadErr = ""; }}
                >{v.tabLabel || v.label}</button>
              {/each}
            </div>
          {/if}

          {#each userParams as p}
            <label>
              <span class="lbl">{p.label || p.name}</span>
              {#if p.action}
                <div class="key-row">
                  <input class:mono={p.kind === "hex"} value={getDStr(activeOp.name, p.name)}
                    oninput={e => setDVal(activeOp.name, p.name, e.currentTarget.value)}
                    placeholder={p.placeholder} />
                  <button class="sm" onclick={() => decodeAction(activeOp, p)}>Generate</button>
                </div>
                {#if dPubKeys[dk(activeOp.name, p.name)]}
                  <input class="mono dim" value={dPubKeys[dk(activeOp.name, p.name)]} readonly style="margin-top:4px" />
                {/if}
              {:else}
                <input class:mono={p.kind === "hex"} value={getDStr(activeOp.name, p.name)}
                  oninput={e => setDVal(activeOp.name, p.name, e.currentTarget.value)}
                  placeholder={p.placeholder} />
              {/if}
            </label>
          {/each}

          {#if userParams.length > 0}
            <button class="action-btn" onclick={() => runDecode(envelope!.type)}>Decrypt</button>
          {/if}

          {#if payloadErr}
            <div class="err">{payloadErr}</div>
          {/if}
        </div>

      {:else}
        <div class="info-note">No structured decoder for <strong>{envelope.type}</strong> — payload is {envelope.payloadHex.length / 2} bytes.</div>
      {/if}

      <!-- Payload result -->
      {#if payload}
        {@const d = payload.data}
        {@const rfs = payload.op.result}
        <div class="result-card">
          {#each rfs as rf}
            {#if rf.name === "text" && d[rf.name] != null}
              <div class="msg-text">"{d[rf.name]}"</div>
            {/if}
            {#if rf.name === "name" && d[rf.name]}
              <div class="node-name">📡 {d[rf.name]}</div>
            {/if}
          {/each}
          <table>
              <tbody>
                {#each rfs as rf}
                  {#if rf.name !== "text" && rf.name !== "name"}
                    {#if !rf.optional || d[rf.name] != null}
                      <tr>
                        <td>{rf.label || rf.name}</td>
                        <td class:mono={rf.kind === "string"} class:hex-wrap={rf.name.endsWith("Hex") || rf.name === "publicKey" || rf.name === "senderPubKey"}>
                          {fmtVal(rf, d[rf.name])}
                        </td>
                      </tr>
                    {/if}
                  {/if}
                {/each}
              </tbody>
            </table>
        </div>
      {/if}

    {:else if !hex.trim()}
      <div class="empty-state">Paste a hex packet above to inspect it</div>
    {/if}

    {#if envelope}
      <div class="json-section">
        <button class="json-toggle" class:active={showJson} onclick={() => showJson = !showJson}>
          <span class="toggle-dot"></span> Show decoded JSON
        </button>
        {#if showJson}
          <div class="json-out">{@html jsonHtml}</div>
        {/if}
      </div>
      {@const decodeDoc = encodeOps.find(o => o.tabGroupLabel === envelope.type)?.tabGroupDoc || decodeOps.find(o => o.packetType === envelope.type)?.tabGroupDoc || ""}
      {#if decodeDoc}
        <div class="help-note">ℹ {decodeDoc}</div>
      {/if}
    {/if}

    </div><!-- /panel -->

  <!-- ══════════════════ ENCODE ══════════════════ -->
  {:else if mode === "encode"}
    <div class="panel">
    <div class="type-tabs">
      {#each encodeTabGroups as tg}
        {@const meta = tabMeta(tg)}
        <button class:active={eTab === tg} onclick={() => { eTab = tg; eError = ""; }}>
          {meta.tabGroupLabel || tg}
          {#if meta.tabGroupSub}<span class="sub">{meta.tabGroupSub}</span>{/if}
        </button>
      {/each}
    </div>

    {#each encodeTabGroups as tg}
      {#if eTab === tg}
        {@const ops = opsForEncodeTab(tg)}
        {@const op = ops.find(o => o.name === eVariants[tg]) ?? ops[0]}
        {#if op}
          {#if ops.length > 1}
            <div class="seg-ctrl">
              {#each ops as v}
                <button class:active={op.name === v.name} onclick={() => eVariants[tg] = v.name}>{v.tabLabel || v.name}</button>
              {/each}
            </div>
          {/if}

          <div class="fields">
            {#each layoutRows(op.params) as row}
              {#if row.some(p => eVisible(op.name, p))}
                <div class:two-col={row.length > 1}>
                  {#each row as p}
                    {#if eVisible(op.name, p)}
                      {#if p.widget === "checkbox"}
                        <button class="toggle-btn" class:active={getEBool(op.name, p.name)}
                          onclick={() => setEVal(op.name, p.name, getEBool(op.name, p.name) ? 0 : 1)}>
                          <span class="toggle-dot"></span>
                          <span>{p.label || p.name}</span>
                        </button>

                      {:else if p.choices.length > 0}
                        <label>
                          <span class="lbl">{p.label || p.name}</span>
                          <select value={getENum(op.name, p.name)} onchange={e => setEVal(op.name, p.name, Number(e.currentTarget.value))}>
                            {#each p.choices as c}<option value={c.value}>{c.label}</option>{/each}
                          </select>
                        </label>

                      {:else if p.widget === "textarea"}
                        <label>
                          <span class="lbl">{p.label || p.name}</span>
                          <textarea class:mono={p.kind === "hex"} value={getEStr(op.name, p.name)}
                            oninput={e => setEVal(op.name, p.name, e.currentTarget.value)}
                            placeholder={p.placeholder} rows={3}></textarea>
                        </label>

                      {:else if p.kind === "int" || p.kind === "float"}
                        <label>
                          <span class="lbl">{p.label || p.name}</span>
                          <input type="number" value={getENum(op.name, p.name)}
                            oninput={e => setEVal(op.name, p.name, Number(e.currentTarget.value))}
                            placeholder={p.placeholder} step={p.kind === "float" ? "0.000001" : "1"} />
                        </label>

                      {:else}
                        <label>
                          <span class="lbl">{p.label || p.name}</span>
                          {#if p.action}
                            <div class="key-row">
                              <input class:mono={p.kind === "hex"} value={getEStr(op.name, p.name)}
                                oninput={e => setEVal(op.name, p.name, e.currentTarget.value)}
                                placeholder={p.placeholder} />
                              <button class="sm" onclick={() => encodeAction(op, p)}>Generate</button>
                            </div>
                            {#if ePubKeys[ek(op.name, p.name)]}
                              <input class="mono dim" value={ePubKeys[ek(op.name, p.name)]} readonly style="margin-top:4px" />
                            {/if}
                          {:else}
                            <input class:mono={p.kind === "hex"} value={getEStr(op.name, p.name)}
                              oninput={e => setEVal(op.name, p.name, e.currentTarget.value)}
                              placeholder={p.placeholder} />
                          {/if}
                        </label>
                      {/if}
                    {/if}
                  {/each}
                </div>
              {/if}
            {/each}
          </div>

          {#if eError}
            <div class="err">{eError}</div>
          {/if}
          {#if op.tabGroupDoc}
            <div class="help-note">ℹ {op.tabGroupDoc}</div>
          {/if}
        {/if}
      {/if}
    {/each}
    </div><!-- /panel -->

  <!-- ══════════════════ BENCHMARK ══════════════════ -->
  {:else if mode === "benchmark"}
    <BenchmarkPanel {mc} packetHex={hex} />

  {/if}
</div>

<style>
  .workspace { display: flex; flex-direction: column; gap: 16px; }

  /* ── Top tabs (old style) ──────────────────────────────────────────────────── */
  /* ── Mode tabs ───────────────────────────────────────────────────────────── */
  .mode-bar { display: flex; border-bottom: 1px solid #30363d; align-items: stretch; }
  .mode-tab {
    background: none; border: none; border-bottom: 2px solid transparent;
    border-radius: 0;
    color: #8b949e; cursor: pointer; font-size: 14px; font-weight: 500;
    font-family: inherit; padding: 10px 20px; margin-bottom: -1px;
    transition: color 0.15s, border-color 0.15s;
  }
  .mode-tab:hover { color: #e6edf3; }
  .mode-tab.active { color: #f0f6fc; border-bottom-color: #1f6feb; }
  .bench-tab { margin-left: auto; font-size: 13px; color: #6e7681; }
  .bench-tab:hover { color: #8b949e; }

  /* ── Panel card ───────────────────────────────────────────────────────────── */
  .panel {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 20px; display: flex; flex-direction: column; gap: 16px;
  }

  /* ── Hex section header ──────────────────────────────────────────────────── */
  .hex-section { display: flex; flex-direction: column; gap: 6px; }
  .hex-header { display: flex; align-items: center; justify-content: space-between; }
  .hex-label { font-size: 11px; font-weight: 600; letter-spacing: 0.08em; color: #8b949e; }
  .hex-meta { display: flex; align-items: center; gap: 10px; }
  .byte-count { font-size: 11px; color: #6e7681; }
  .ms-count { font-size: 11px; color: #3fb950; font-variant-numeric: tabular-nums; }
  .copy-btn { padding: 3px 10px; font-size: 11px; font-weight: 500; }

  /* ── Hex textarea ─────────────────────────────────────────────────────────── */
  .hex-input {
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    color: #79c0ff; font-size: 13px; line-height: 1.7; outline: none;
    padding: 8px 10px; resize: none; width: 100%; word-break: break-all;
    box-sizing: border-box; font-family: "Cascadia Code", "Fira Code", monospace;
    overflow: hidden;
  }
  .hex-input:focus { border-color: #58a6ff; }
  .hex-out { opacity: 0.8; cursor: pointer; }
  .hex-out:hover { opacity: 1; }

  /* ── Type tabs inside encode panel ───────────────────────────────────────── */
  .type-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .type-tabs button {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    background: #0d1117; border: 1px solid #30363d;
    color: #8b949e; cursor: pointer; min-width: 90px; font-family: inherit; padding: 8px 14px;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .type-tabs button:hover { background: #21262d; color: #e6edf3; }
  .type-tabs button.active { background: #21262d; border-color: #1f6feb; color: #79c0ff; }
  .sub { font-size: 10px; font-weight: 400; color: #6e7681; }
  .type-tabs button.active .sub { color: #8b949e; }

  /* ── Segmented control ────────────────────────────────────────────────────── */
  .seg-ctrl { display: flex; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; width: fit-content; }
  .seg-ctrl button {
    background: #0d1117; border: none; border-radius: 0; color: #8b949e;
    cursor: pointer; font-size: 12px; font-family: inherit; padding: 5px 14px;
    transition: background 0.1s, color 0.1s;
  }
  .seg-ctrl button:hover { background: #21262d; color: #e6edf3; }
  .seg-ctrl button.active { background: #21262d; color: #79c0ff; font-weight: 600; }
  .seg-ctrl button:not(:last-child) { border-right: 1px solid #30363d; }

  /* ── Form ─────────────────────────────────────────────────────────────────── */
  .fields { display: flex; flex-direction: column; gap: 10px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  label { display: flex; flex-direction: column; gap: 4px; }
  .lbl { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; color: #8b949e; }

  input, textarea, select {
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    color: #e6edf3; font-size: 13px; padding: 8px 10px; outline: none;
    resize: vertical; width: 100%; font-family: inherit; box-sizing: border-box;
  }
  input:focus, textarea:focus, select:focus { border-color: #58a6ff; }
  .mono { font-family: "Cascadia Code", "Fira Code", monospace; font-size: 12px; }
  .dim { color: #8b949e; }
  .key-row { display: flex; gap: 6px; }
  .key-row input { flex: 1; }

  /* Toggle button */
  .toggle-btn {
    align-items: center; align-self: flex-start; background: #0d1117;
    border: 1px solid #30363d; border-radius: 6px; color: #8b949e;
    cursor: pointer; display: inline-flex; font-family: inherit;
    font-size: 13px; font-weight: 400; gap: 8px; padding: 7px 12px;
    transition: background 0.1s, color 0.1s, border-color 0.1s;
  }
  .toggle-btn:hover { background: #21262d; color: #e6edf3; }
  .toggle-btn.active { background: #1f3a5c; border-color: #1f6feb; color: #79c0ff; }
  .toggle-dot {
    background: #30363d; border-radius: 999px;
    box-shadow: inset 0 0 0 1px #6e7681; flex-shrink: 0; height: 8px; width: 8px;
  }
  .toggle-btn.active .toggle-dot { background: #3fb950; box-shadow: 0 0 0 2px rgba(63,185,80,0.18); }

  /* ── Buttons ──────────────────────────────────────────────────────────────── */
  button { background: #21262d; border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; cursor: pointer; font-size: 13px; padding: 8px 14px; transition: background 0.1s; font-family: inherit; }
  button:hover { background: #30363d; }
  button[disabled] { opacity: 0.4; cursor: default; pointer-events: none; }
  .sm { padding: 8px 10px; font-size: 12px; white-space: nowrap; }
  .primary { background: #1f6feb; border-color: #1f6feb; color: #fff; font-weight: 600; }
  .primary:hover { background: #388bfd; }
  .action-btn { background: #1f6feb; border-color: #1f6feb; color: #fff; font-weight: 600; align-self: flex-start; }
  .action-btn:hover { background: #388bfd; }
  .result-btns { display: flex; gap: 8px; }
  .result-btns button { flex: 1; }

  /* ── Decode cards ─────────────────────────────────────────────────────────── */
  .card { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; }
  .card-hdr { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #21262d; flex-wrap: wrap; align-items: center; }
  .type-badge { background: #1f3a5c; color: #79c0ff; border: 1px solid #1f6feb; border-radius: 4px; font-size: 12px; font-weight: 600; padding: 2px 8px; font-family: monospace; }
  .pill { background: #1c2128; color: #8b949e; border: 1px solid #30363d; border-radius: 4px; font-size: 11px; padding: 2px 8px; }
  .pill.dim { color: #6e7681; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 6px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  td:first-child { color: #8b949e; font-size: 12px; white-space: nowrap; width: 24%; }
  td:last-child { color: #e6edf3; }
  .hex-wrap { word-break: break-all; line-height: 1.6; }

  .step2 { display: flex; flex-direction: column; gap: 10px; }

  .result-card { background: #0d1117; border: 1px solid #238636; border-radius: 6px; overflow: hidden; }
  .msg-text { padding: 10px 12px; color: #7ee787; font-size: 14px; border-bottom: 1px solid #21262d; word-break: break-word; }
  .node-name { padding: 10px 12px; color: #f0f6fc; font-size: 15px; font-weight: 600; border-bottom: 1px solid #21262d; }

  /* ── Misc ─────────────────────────────────────────────────────────────────── */
  .err { background: #3d1f1f; border: 1px solid #6e2a2a; border-radius: 6px; color: #f97583; font-size: 12px; padding: 8px 10px; }
  .info-note { background: #1c2128; border: 1px solid #30363d; border-radius: 6px; color: #8b949e; font-size: 12px; padding: 10px 12px; }
  .help-note {
    border-top: 1px solid #21262d;
    color: #6e7681; font-size: 11px; line-height: 1.6;
    margin-top: 4px; padding-top: 10px;
  }
  .empty-state { color: #6e7681; font-size: 13px; padding: 16px 0; text-align: center; }

  /* ── Example links ────────────────────────────────────────────────────────── */
  .examples { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .examples { font-size: 11px; color: #6e7681; }
  .ex-link { background: none; border: none; color: #58a6ff; cursor: pointer; font-size: 11px; font-family: inherit; padding: 0; text-decoration: underline; }
  .ex-link:hover { background: none; color: #79c0ff; }

  /* ── JSON toggle & output ─────────────────────────────────────────────────── */
  .json-section { display: flex; flex-direction: column; gap: 10px; }
  .json-toggle {
    align-items: center; align-self: flex-start; background: #0d1117; border: 1px solid #30363d;
    border-radius: 6px; color: #8b949e; cursor: pointer; display: inline-flex;
    font-family: inherit; font-size: 12px; gap: 8px; padding: 5px 10px;
  }
  .json-toggle:hover { background: #21262d; color: #e6edf3; }
  .json-toggle.active { background: #1f3a5c; border-color: #1f6feb; color: #79c0ff; }
  .json-toggle .toggle-dot {
    background: #30363d; border-radius: 999px;
    box-shadow: inset 0 0 0 1px #6e7681; flex-shrink: 0; height: 8px; width: 8px;
  }
  .json-toggle.active .toggle-dot { background: #3fb950; box-shadow: 0 0 0 2px rgba(63,185,80,0.18); }
  .json-out {
    background: #0d1117; border: 1px solid #30363d; border-radius: 6px;
    font-size: 12px; line-height: 1.55; overflow: visible;
  }
  .json-out :global(pre) { background: transparent !important; margin: 0; padding: 12px; overflow: visible; white-space: pre-wrap; word-break: break-word; }
  .json-out :global(code) { white-space: pre-wrap; word-break: break-word; }
</style>

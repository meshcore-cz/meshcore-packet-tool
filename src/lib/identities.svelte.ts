export interface Identity {
  id: string;
  privateKey: string; // 64 hex chars — Ed25519 seed/private key (32 bytes)
  publicKey: string;  // 64 hex chars — Ed25519 public key (32 bytes)
}

const LS_KEY = "meshcore-packet-tool:identities";

class IdentityStore {
  list      = $state<Identity[]>([]);
  fillSeq   = $state(0);
  fillTarget = $state<Identity | null>(null);

  constructor() {
    if (typeof localStorage !== "undefined") {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          // Migrate old formats: { privateKey } or { seed } → { privateKey }
          this.list = (JSON.parse(raw) as Record<string, string>[]).map(i => ({
            id:         i.id         ?? crypto.randomUUID(),
            privateKey: i.privateKey ?? i.seed ?? "",
            publicKey:  i.publicKey  ?? "",
          })).filter(i => i.privateKey && i.publicKey);
        }
      } catch {}
    }
  }

  private persist() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(this.list)); } catch {}
  }

  fill(identity: Identity) {
    this.fillTarget = identity;
    this.fillSeq++;
  }

  add(identity: Identity) {
    this.list = [...this.list, identity];
    this.persist();
  }

  remove(id: string) {
    this.list = this.list.filter(i => i.id !== id);
    this.persist();
  }
}

export const identities = new IdentityStore();

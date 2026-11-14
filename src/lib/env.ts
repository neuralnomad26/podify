// Stripe Projects writes provider credentials into your env. Exact variable
// names can differ per provider, so each setting accepts a few common aliases.

function pick(names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

function required(names: string[]): string {
  const v = pick(names);
  if (!v) throw new Error(`Missing env var: set one of ${names.join(", ")}`);
  return v;
}

export const ENV_SPEC = {
  // SUPABASE_PROJECT_URL is the name Stripe Projects writes.
  supabaseUrl: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_PROJECT_URL"],
  supabaseAnonKey: [
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ],
  supabaseServiceKey: [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_KEY",
  ],
  // Stripe Projects prefixes with the resource name: firecrawl-api -> FIRECRAWL_API_*.
  firecrawlKey: ["FIRECRAWL_API_KEY", "FIRECRAWL_API_API_KEY", "FIRECRAWL_PLAN_API_KEY"],
  openrouterKey: ["OPENROUTER_API_KEY"],
  elevenlabsKey: ["ELEVENLABS_API_KEY", "XI_API_KEY"],
  // MPP (Machine Payments Protocol): agents pay per episode in stablecoins on Tempo.
  mppSecret: ["MPP_SECRET_KEY"],
  // Wallet that receives payments. Shares the one set up for the Warranty project.
  mppRecipient: ["PODIFY_PAY_ADDRESS", "MPP_RECIPIENT", "WARRANTY_ADDRESS"],
  // Postgres for MPP replay protection (shared by every serverless instance).
  dbPoolerUrl: ["SUPABASE_POOLER_URL"],
  dbPassword: ["SUPABASE_DB_PASS"],
} as const;

export const env = {
  supabaseUrl: () => required([...ENV_SPEC.supabaseUrl]),
  supabaseAnonKey: () => required([...ENV_SPEC.supabaseAnonKey]),
  supabaseServiceKey: () => required([...ENV_SPEC.supabaseServiceKey]),
  firecrawlKey: () => required([...ENV_SPEC.firecrawlKey]),
  openrouterKey: () => required([...ENV_SPEC.openrouterKey]),
  elevenlabsKey: () => required([...ENV_SPEC.elevenlabsKey]),
  openrouterModel: () => pick(["OPENROUTER_MODEL"]) ?? "openai/gpt-4o-mini",
  // OPENROUTER_MODEL may be a comma-separated list: the first is preferred and the
  // rest are fallbacks OpenRouter tries when a model is rate-limited or down
  // (free ":free" models often are). OpenRouter accepts at most 3.
  openrouterModels: () =>
    (pick(["OPENROUTER_MODEL"]) ?? "openai/gpt-4o-mini")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      .slice(0, 3),
  // "George" — a default premade ElevenLabs voice available on the free tier.
  mppSecret: () => required([...ENV_SPEC.mppSecret]),
  mppRecipient: () => required([...ENV_SPEC.mppRecipient]) as `0x${string}`,
  /** Tempo testnet (test funds) unless MPP_TESTNET=false. */
  mppTestnet: () => (pick(["MPP_TESTNET"]) ?? "true") !== "false",
  /** Realm in every 402 challenge: the production hostname. Unset locally, where mppx uses the request host. */
  mppRealm: () => pick(["MPP_REALM"]),
  /** Price of one agent-bought episode, in dollars of stablecoin. */
  episodePrice: () => pick(["PODIFY_EPISODE_PRICE"]) ?? "0.25",
  /** Demo agent wallet used by scripts/agent-demo.mjs. */
  demoAgentKey: () => pick(["DEMO_AGENT_PRIVATE_KEY"]) as `0x${string}` | undefined,
  dbPoolerUrl: () => required([...ENV_SPEC.dbPoolerUrl]),
  dbPassword: () => required([...ENV_SPEC.dbPassword]),
  publicOrigin: () => pick(["PUBLIC_ORIGIN"]),
  elevenlabsVoice: () => pick(["ELEVENLABS_VOICE_ID"]) ?? "JBFqnCBsd6RMkjVDRZzb",
};

export function envStatus() {
  return Object.fromEntries(
    Object.entries(ENV_SPEC).map(([k, names]) => [k, Boolean(pick([...names]))]),
  ) as Record<keyof typeof ENV_SPEC, boolean>;
}

// An AI agent buys one Podify episode over MPP, end to end.
// Usage: npm run agent:demo -- [paper-url] [base-url]
// Pays from DEMO_AGENT_PRIVATE_KEY (a funded Tempo testnet wallet). One run = one paid episode.
import { Mppx, tempo } from "mppx/client";
import { privateKeyToAccount } from "viem/accounts";

process.loadEnvFile?.(".env");
try { process.loadEnvFile?.(".env.local"); } catch {}

const paper = process.argv[2] ?? "https://arxiv.org/abs/1706.03762";
const base = process.argv[3] ?? "http://localhost:3000";
const key = process.env.DEMO_AGENT_PRIVATE_KEY;
if (!key) throw new Error("Set DEMO_AGENT_PRIVATE_KEY (a funded Tempo testnet wallet) in .env.local");

const agent = Mppx.create({ methods: [tempo({ account: privateKeyToAccount(key) })], polyfill: false });
const init = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url: paper, role: "ML engineer", goal: "decide whether to read the full paper" }),
};
const endpoint = `${base}/api/v1/episodes`;

const first = await agent.rawFetch(endpoint, init);
console.log(`1. unpaid request -> HTTP ${first.status}${first.status === 402 ? " (payment challenge)" : ""}`);
if (first.status !== 402) {
  console.log(await first.text());
  process.exit(1);
}

const t0 = Date.now();
const paid = await agent.fetch(endpoint, init);
const out = await paid.json().catch(() => ({}));
console.log(`2. paid request -> HTTP ${paid.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s, receipt: ${paid.headers.get("Payment-Receipt") ? "yes" : "no"}`);
if (!paid.ok) {
  console.log(out);
  process.exit(1);
}
console.log(`3. "${out.title}"\n   audio: ${out.audio_url}\n   page:  ${out.page_url}`);

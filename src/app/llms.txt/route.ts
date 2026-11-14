import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const o = env.publicOrigin() ?? new URL(request.url).origin;
  const text = `# Podify

> Turns a research paper (arXiv, OpenReview, PDF) or web article into a short podcast episode: a ~2 minute script written for the listener, recorded as an MP3, with takeaways and one action. Agents can buy episodes with MPP, no account needed.

Network: ${env.mppTestnet() ? "Tempo testnet (test funds only)" : "Tempo mainnet"}. Payment method: MPP, tempo charge. Price: $${env.episodePrice()} per episode.

## Buy an episode

POST ${o}/api/v1/episodes  (paid, MPP)

Body (JSON):
{
  "url": "https://arxiv.org/abs/1706.03762",  // required: the paper or article
  "role": "ML engineer",                      // optional: who will listen
  "goal": "decide whether to read it"         // optional: what they want from it
}

Flow:
1. Send the request with no payment. You get HTTP 402 with a \`WWW-Authenticate: Payment\` challenge.
2. Pay the challenge and resend the same body. Generation takes 20-50 seconds; keep the connection open.
3. HTTP 200: { id, title, audio_url, page_url, takeaways, action, script, source_url }, plus a \`Payment-Receipt\` header.
   HTTP 502 \`episode_failed\`: the page could not be turned into an episode after payment (paywall, scanned PDF). Keep the receipt; these are refunded on request.

Capacity is checked before you are charged: HTTP 429 \`sold_out\` means no payment was taken.

With the mppx CLI: \`mppx ${o}/api/v1/episodes -X POST -H 'Content-Type: application/json' -d '{"url":"https://arxiv.org/abs/1706.03762"}'\`

## Discovery

- OpenAPI with payment info: ${o}/openapi.json
- Web app (humans, free tier): ${o}
`;
  return new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

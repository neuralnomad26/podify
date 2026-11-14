import { generate } from "mppx/discovery";
import { env } from "@/lib/env";
import { episodeCharge, mpp } from "@/lib/mpp";

export const dynamic = "force-dynamic";

/** MPP discovery document: tells agents which routes are paid and what they cost. */
export async function GET(request: Request) {
  const origin = env.publicOrigin() ?? new URL(request.url).origin;
  const example = { url: "https://arxiv.org/abs/1706.03762", role: "ML engineer", goal: "decide whether to read the full paper" };
  const doc = generate(mpp(), {
    info: { title: "Podify", version: "1.0.0" },
    serviceInfo: {
      categories: ["media", "audio", "research", "ai"],
      docs: { homepage: origin, llms: `${origin}/llms.txt`, apiReference: `${origin}/openapi.json` },
    },
    routes: [
      {
        method: "POST",
        path: "/api/v1/episodes",
        summary: `Turn a research paper (arXiv, OpenReview, PDF) or article URL into a ~2 minute podcast episode. $${env.episodePrice()} per episode, paid over MPP. Takes 20-50 seconds.`,
        handler: episodeCharge(),
        requestBody: {
          required: true,
          content: {
            "application/json": {
              example,
              schema: {
                type: "object",
                required: ["url"],
                example,
                properties: {
                  url: { type: "string", description: "Paper or article link (http/https).", example: example.url },
                  role: { type: "string", description: "Optional: who the listener is. Shapes the script." },
                  goal: { type: "string", description: "Optional: what the listener wants from it." },
                },
              },
            },
          },
        },
      },
    ],
  });
  return Response.json(doc, { headers: { "Cache-Control": "public, max-age=60" } });
}

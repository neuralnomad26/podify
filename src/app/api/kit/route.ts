import { kitFor } from "@/lib/companion";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Returns the study kit for an episode, building it on first request. */
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  try {
    const kit = await kitFor(String(id));
    if (!kit) return Response.json({ error: "Episode not found." }, { status: 404 });
    return Response.json({ kit });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not build the study kit." }, { status: 502 });
  }
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

export const BUCKET = "episodes";

export type Episode = {
  id: string;
  /** null for records pressed by a guest (no account). */
  user_id: string | null;
  url: string;
  title: string;
  script: string;
  audio_url: string;
  created_at: string;
  takeaways: string[] | null;
  action: string | null;
  audio_bytes: number | null;
  featured?: boolean;
};

export type Profile = {
  user_id: string;
  role: string;
  goal: string;
  feed_token: string;
};

let admin: SupabaseClient | null = null;

/** Server-only client using the service key. Never import from client code. */
export function supabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}

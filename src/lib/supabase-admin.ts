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
  /** Server-side only: the paper text the companion works from. */
  source_text?: string | null;
  kit?: Kit | null;
};

export type Kit = {
  tldr: string;
  breakdown: { problem: string; approach: string; results: string; limitations: string; why_it_matters: string };
  numbers: { value: string; meaning: string }[];
  glossary: { term: string; plain: string }[];
  quiz: { q: string; options: string[]; answer: number; why: string }[];
  read_it_if: string;
  skip_it_if: string;
};

export type Quote = { text: string; verified: boolean };
export type Answer = { id?: string; question: string; answer: string; quotes: Quote[]; created_at?: string };

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

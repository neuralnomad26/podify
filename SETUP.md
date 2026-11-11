# Podify: setup and deploy

The app code is done. These steps connect the real services with Stripe Projects and deploy it.
Run them on your Mac in `~/workshop/podify`.

## 0. One-time: Stripe CLI and the Projects plugin

```bash
brew install stripe/stripe-cli/stripe   # or: npm install -g @stripe/cli
stripe login
# install the `projects` plugin (or ask your agent: "install the Stripe Projects plugin")
stripe projects --help
```

## Option A: let your coding agent do it (recommended)

Open your agent (Claude Code, Cursor, …) in `~/workshop/podify` and paste:

```
This folder contains a finished Next.js app called Podify. Do NOT rewrite the app code.
Use the Stripe Projects CLI to provision its services and deploy it:

1. Run `stripe projects catalog` and confirm the exact provider/service names.
2. `stripe projects init podify` in this folder, then `stripe projects add <provider>/<service>` for each (free tier only):
   - Supabase (auth + Postgres + storage)
   - Firecrawl
   - OpenRouter
   - ElevenLabs
   - Vercel (hosting)
   If one isn't in the catalog, tell me and suggest the closest free alternative.
3. Run `stripe projects env --pull` so the keys land locally, and make sure they are also set on Vercel. The app accepts
   any of the aliases listed in src/lib/env.ts. If Stripe Projects uses different names, add an
   alias there instead of renaming the provider's vars.
     SUPABASE_URL, SUPABASE_ANON_KEY (or publishable key), SUPABASE_SERVICE_ROLE_KEY (or secret key),
     FIRECRAWL_API_KEY, OPENROUTER_API_KEY, ELEVENLABS_API_KEY
4. Run supabase/setup.sql against the Supabase database (psql with the DB URL, or tell me
   to paste it into the Supabase SQL editor).
5. In Supabase Auth settings, turn OFF "Confirm email" so sign-ups work instantly for the demo
   (tell me if you can't do this from the CLI).
6. `npm run dev`, open http://localhost:3000/api/health and fix anything not "ok".
7. Deploy to Vercel, open <live-url>/api/health, and give me the live URL.
8. Run `stripe projects share` (required for the workshop leaderboard) and `stripe projects spend`, and show me the output.
```

## Option B: by hand

```bash
cd ~/workshop/podify
stripe projects catalog                 # check exact names
stripe projects init podify
stripe projects add supabase/<service>  # use the names from the catalog
stripe projects add firecrawl/<service>
stripe projects add openrouter/<service>
stripe projects add elevenlabs/<service>
stripe projects add vercel/<service>
stripe projects env --pull             # sync keys into the project
stripe projects share                  # required for the leaderboard
```

Then:
1. Paste `supabase/setup.sql` into the Supabase dashboard → SQL Editor → Run.
2. Supabase → Authentication → Sign In / Providers → Email → turn off **Confirm email**.
3. `npm run dev` → open http://localhost:3000/api/health (everything should be `true` / `"ok"`).
4. Deploy to Vercel, then check `/api/health` on the live URL.

## Optional settings

| Var | Default |
|---|---|
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` (swap in any OpenRouter model ID; free ones end in `:free`) |
| `ELEVENLABS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` (George, a premade voice) |

## Demo script (60 seconds)

1. Sign up live.
2. Paste a short news article URL (test one beforehand that scrapes cleanly).
3. Talk over the progress steps: "Firecrawl is reading it… OpenRouter writes the script… ElevenLabs records it."
4. Play 10 seconds of audio.
5. Click **Share**, open the link in an incognito window: it plays without logging in.
6. Close with: "Six providers, wired in minutes by one `stripe projects` workflow."

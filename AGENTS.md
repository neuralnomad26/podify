<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- stripe-projects-cli managed:agents-md:start -->
## Stripe Projects CLI

This repository is initialized for the Stripe project "podify".

## Tools used

- [Stripe CLI](https://docs.stripe.com/stripe-cli) with the `projects` plugin to manage third-party services, credentials, and deployments for this project. Use the stripe-projects-cli to manage deploying and access to third party services.
<!-- stripe-projects-cli managed:agents-md:end -->

## Podify: what this repo is

A Next.js app that turns a research paper (arXiv, OpenReview, PDF) or article URL into a short podcast episode: Firecrawl scrapes the page, OpenRouter writes the script, ElevenLabs records it, Supabase stores users, episodes and audio, Vercel hosts it. Setup and deploy steps are in `SETUP.md`.

- `src/lib/env.ts`: the only place env vars are read. Every setting accepts several aliases.
- `src/lib/pipeline.ts`: scrape, script, audio.
- `src/lib/supabase-admin.ts`: server-only Supabase client (service key).
- `src/app/api/health/route.ts`: reports which keys are set and which services answer. Check it after any env change.
- `supabase/setup.sql`: schema. Run it once against the Supabase database.

## Guardrails

These are enforced by `.claude/settings.json` and `.claude/hooks/guard-bash.mjs` for Claude Code. Other agents must follow them by hand.

**Secrets**
- Never print, paste, log or commit the contents of `.env`, `.env.*` (except `.env.example`) or `.projects/vault/`. Refer to variables by name only. To see what is set: `stripe projects env`, or `sed -E 's/=.*/=<set>/' .env`.
- `.env` is generated. Do not edit it; change services with `stripe projects` and re-run `stripe projects env --pull`. Keys that Stripe Projects does not supply go in `.env.local`.
- If a provider's variable name differs from what the app expects, add an alias in `src/lib/env.ts`. Do not rename the provider's variable.
- Never give a secret a `NEXT_PUBLIC_` name. Only the Supabase URL and the publishable (anon) key may reach the browser. The service role / secret key, the database URL and every provider API key stay server-side.
- Do not pass tokens as command-line flags (`vercel --token ...`). Export `VERCEL_TOKEN` and let the CLI read it.

**Money**
- Free tier only: `supabase/free`, `firecrawl/free`, `openrouter/free`, `elevenlabs/tts`, `vercel/hobby`. Never use `--confirm-paid-service`, `stripe projects upgrade` or `stripe projects billing add`. If a task needs a paid plan, stop and tell the user.
- Copy `<provider>/<service>` slugs from `stripe projects catalog --json`. Do not guess them.
- The app calls paid-per-use APIs. Keep test articles short, do not loop the pipeline, and do not add retries without a cap.

**Ask the user first**
- `stripe projects remove`, `rotate`, `unlink`, `downgrade`, `env delete`, and `share` (publishes the project to the workshop leaderboard).
- `git push`, force pushes, `git commit --no-verify`, and deleting anything on Vercel or Supabase.
- Dropping or rewriting tables. Schema changes go in `supabase/setup.sql` as statements that are safe to run twice.

**Code**
- Read the relevant guide in `node_modules/next/dist/docs/` before changing Next.js code (see the top of this file).
- Before calling work done: `npm run lint`, `npm run build`, then `npm run dev` and confirm `/api/health` reports everything ok.

# MU Avatar Automation — founder-message audio

Personalised **"welcome to Masters' Union" founder messages** for admitted students, voiced with ElevenLabs and later turned into AI-avatar videos. Each message is full of Indian names, colleges, companies and acronyms that an English-first voice gets wrong. This repo makes those messages come out right, at scale, with as little listening as possible.

Two tools live here:

| Path | What | Status |
|---|---|---|
| **`/review`** | **Script Review** — reviewers open a set, listen sentence by sentence, fix mispronunciations in one click, approve and download a WAV per student | **Current tool** |
| `/` (and `/scrub`, `/stitch-test`) | The original single-script pronunciation audit tool | Legacy — left as is |

Live: https://mu-avatar-automation.vercel.app/review

> Working with Claude Code? Read [`CLAUDE.md`](CLAUDE.md) — it's the agent handoff. Start Claude in this folder and say *"New set: `c8-scripts/<file>.csv`"*.

---

## How it works

```
CSV of scripts ──► prepare offline (Claude Code + review-tool/cli) ──► Supabase (text only)
                                                                          │
              reviewer opens /review ──► audio generated per sentence (ElevenLabs v2, in parallel)
                                                                          │
              listen (sentence highlighted) ──► Fix / Edit / Delete a sentence ──► Approve & download WAV
                                                                          │
              every fix is logged (sentence_changes) ──► analysed before the next set ──► better prep
```

- **Text preparation happens offline, once per set.** Indian names and Hindi/Sanskrit institution names are rewritten in Devanagari, decimals are read digit by digit (`8.87` → `8 point 8 7`), `%` gets a space, approved spellings from the pronunciation library are applied, and the text is split into sentences. Every name/acronym also gets 3–5 prepared **spelling options** for one-click fixes.
- **Audio is generated on demand** when a reviewer opens a script — every sentence at once, each with its neighbours' text as context so the joins are seamless — and cached in that browser. **No audio is stored server-side.**
- **Fixing a sentence regenerates only that sentence**; neighbours keep their exact audio.
- **Approve** joins the sentences (0.5 s pause between sentences, 0.6 s between paragraphs) into a WAV named `<SetPrefix>_<ApplicationNo>_<Student-Name>.wav`. Reviewers share files themselves (Drive etc.).
- **Every reviewer action is logged** so recurring fixes become preparation rules and library entries.

### Stack

Next.js 16 (App Router) · TypeScript · Tailwind · Supabase (Postgres, text only) · ElevenLabs `eleven_multilingual_v2` · Claude (`claude-opus-5-5`, spelling fallback only) · Vercel.

---

## Setup

```bash
git clone <repo> && cd mu-avatar-automation
npm install
cp .env.example .env.local      # fill in the values — see comments in the file
npm run dev                      # http://localhost:3000/review
```

You need access to:
- **ElevenLabs** — API key and the **voice ID** used for all sets (keep it the same, or every set sounds different).
- **Supabase** project `mu-script` — `SUPABASE_URL` and the **secret** key (Project Settings → API Keys).
- **Claude API key** (`CLAUDEAPI_KEY`) — only for the "Ask Claude" fallback in the Fix panel.
- **Vercel** project `mu-avatar-automation` — for deploys (`npm i -g vercel`, `vercel login`, `vercel link`).

Database tables are defined in [`review-tool/schema.sql`](review-tool/schema.sql) (run it in the Supabase SQL editor for a fresh project).

---

## Adding a new set

1. Put the CSV in `c8-scripts/` — columns: `Application Number`, `Name`, `Founder Message`.
2. Open Claude Code in this folder and say: **"New set: `c8-scripts/<file>.csv`"**. It follows [`CLAUDE.md`](CLAUDE.md): reviews the change log, writes `review-tool/sets/<slug>.json` (rewrites + spelling options), previews, checks, and uploads.
3. Reload https://mu-avatar-automation.vercel.app/review — the set appears as a new tab. **No redeploy needed.**

Doing it by hand:

```bash
node review-tool/cli/changes.mjs                                   # what reviewers fixed last time
node review-tool/cli/library.mjs list                              # approved spellings
# write review-tool/sets/<slug>.json (copy an existing one)
node review-tool/cli/prepare-set.mjs review-tool/sets/<slug>.json            # preview → <slug>.prepared.json
node review-tool/cli/prepare-set.mjs review-tool/sets/<slug>.json --upload   # create the set
```

---

## Reviewing (for reviewers)

- Open `/review`, enter the passcode, enter your name (asked once per browser).
- Pick a set tab → a script. Audio prepares in a few seconds and plays; the current sentence is highlighted.
- **Space** play/pause · **↑ ↓** previous/next sentence · **F** fix · **E** edit · click a sentence to play from there.
- **Fix** — click a spelling chip for any name in the sentence (or "Ask Claude" for other words) → *Generate new take* → *Keep new*. Tick *Save to library* so future sets get it right.
- **Edit** — rewrite the sentence; name spellings and number readings are re-applied automatically.
- **Delete** — removes a sentence (Undo for 10 s).
- **Approve & download** — downloads the WAV and marks the script approved. Approved scripts don't regenerate audio when opened; use *Reopen* or *Download again*.

---

## Deploying

```bash
npm run build                 # must pass
vercel deploy --prod --yes
```

Production env vars (Vercel → Settings → Environment Variables): `ELEVEN_LABS_API_KEY`, `ELEVEN_LABS_VOICE_ID`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `REVIEW_PASSCODE`, `CLAUDEAPI_KEY` (+ the old tool's Gemini/OpenAI/MiniMax keys). [`.vercelignore`](.vercelignore) keeps experiments, CSVs and secrets out of the upload.

---

## Repo map

| Path | What |
|---|---|
| `src/app/review/` | Review tool UI: `ReviewApp.tsx` (screen), `FixPanel.tsx` (fix/edit), `audio.ts` (generation, cache, joining, pauses), `actions.ts` (server actions), `api/tts/route.ts` (ElevenLabs proxy) |
| `src/lib/review/` | Server helpers (Supabase, passcode) and shared types |
| `review-tool/cli/` | Offline tooling: `prepare-set.mjs`, `library.mjs`, `changes.mjs` |
| `review-tool/sets/` | One spec per set (`<slug>.json`) + exactly what was uploaded (`<slug>.prepared.json`) |
| `review-tool/schema.sql` | Supabase schema (sets, scripts, pronunciation_library, sentence_changes) |
| `c8-scripts/` | Source CSVs — **student data, git-ignored** (the repo is public). Get them from the team; not in a fresh clone |
| `v4-test/`, `candidate-grid/`, `join-test/` | Experiments that shaped the design (see below) |
| `src/app/page.tsx`, `src/actions/` | Legacy audit tool |

## Why it's built this way (experiments)

| Experiment | Finding |
|---|---|
| `v4-test/` | ElevenLabs **v4 changes the voice** → stay on `eleven_multilingual_v2` |
| `candidate-grid/` | On v2, **Devanagari spelling was right 9/9** for Indian names/institutions; phonetic respellings (hyphens, caps, vowel tricks) only 5/21 |
| `join-test/` | Generating **sentence by sentence, in parallel, with neighbour text as context** sounds as natural as one take (blind test), and a sentence regenerated later blends in — this is what makes per-sentence fixing possible |

## Troubleshooting

- **"Preparing audio" fails / 429s** — ElevenLabs plan allows 15 concurrent requests; each browser uses ≤ 5. Retry.
- **Supabase errors after a quiet week** — the free plan pauses projects after 7 days idle; restore it from the Supabase dashboard.
- **Vercel login page instead of the passcode** — turn off Deployment Protection for production.
- **Session expired** — the passcode changed; enter the new one.

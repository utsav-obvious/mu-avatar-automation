# Agent handoff — MU founder-message audio

You are maintaining the **Script Review** tool (`/review`): personalised Masters' Union welcome messages, voiced by ElevenLabs, reviewed by 2–3 people who fix mispronounced Indian names and download a WAV per student. The human overview is in [README.md](README.md). This file is what you need to **run the process** — most often: *"New set: `c8-scripts/<file>.csv`"*.

## Hard rules

1. **Never test automatically.** Don't start the dev server, drive a browser against the app, or call ElevenLabs/Claude to "check" things — they cost credits. Finish every change with **manual test steps** for the user. (Static checks are fine: `npx tsc --noEmit -p .`, `npx eslint src/app/review src/lib/review`, `npm run build`, and running the `review-tool/cli` scripts, which only read/write Supabase.)
2. **Ask before anything outward-facing:** deploying, uploading a set that replaces another, changing Vercel env vars, running SQL in Supabase. Uploading a *new* set is the expected outcome of "New set: …" and doesn't need extra confirmation.
3. **Don't touch the legacy tool** (`src/app/page.tsx`, `src/actions/*`, `/scrub`, `/stitch-test`) unless asked.
4. **Never print or commit secrets.** Values live in `.env.local` (git-ignored). Read them in scripts; don't echo them.
5. **Record schema changes** in `review-tool/schema.sql` (as a dated migration block) whenever you run SQL in Supabase.
6. **Keep the voice and model:** `eleven_multilingual_v2` with `ELEVEN_LABS_VOICE_ID`. v4 was tested and changes the voice — don't switch.

## New set — the procedure

Input: a CSV in `c8-scripts/` with columns `Application Number`, `Name`, `Founder Message` (or `Corrected Founder Message`).

1. **Learn from the last reviews first.**
   ```bash
   node review-tool/cli/changes.mjs          # grouped patterns of what reviewers changed, failed takes, deletions
   node review-tool/cli/library.mjs list     # approved spellings (applied automatically by prepare-set)
   ```
   Turn repeated patterns into rules: a recurring text pattern → a rule in `src/lib/review/spoken-rules.mjs` (shared by set prep and the app's Edit mode — Edit mode only picks it up after a redeploy); a recurring name/acronym spelling → it's already in the library, or add options to the spec. Note new rules in **Learned rules** below. Look at kept fixes *and* the failed takes — many takes per fix means reviewers are struggling with something systematic.

2. **Read every script in the CSV** (`python3` + `csv.DictReader`, encoding `utf-8-sig`). List every person name (student first name after "Hey", interviewer after "spoke with"), institution, company, place and acronym.

3. **Write the spec** `review-tool/sets/<slug>.json` (copy `c8-r1-set-2.json`; slug like `c8-r1-set-3`; comments below are explanation only — the real file is plain JSON):
   ```jsonc
   {
     "name": "C8 R1 – Set 3",            // tab name; must be unique
     "filePrefix": "C8-R1-Set3",         // download file prefix
     "csv": "c8-scripts/AI AVATAR__C8 R1 - SET 3.csv",
     "nouns": {
       "Raushan": { "kind": "person", "spoken": "रौशन", "options": ["Rau-shun", "Row-shun"] },
       "KIIT":    { "kind": "acronym", "options": ["K I I T", "Kit"] }
     }
   }
   ```
   - `spoken` = what's sent by default (omit → keep as written). The **library overrides** `spoken`.
   - `options` = Fix-panel chips (default + original spelling are added automatically). Give 1–3 per noun.
   - Keys are matched **exactly and case-sensitively** as whole words — copy them from the text (`B.Com` ≠ `B.com`, `Masters’ Union` uses a curly apostrophe). Longer keys win over shorter ones.
   - Include names already in the library only if you want to add options.

4. **Preview** (no upload) and fix anything odd:
   ```bash
   node review-tool/cli/prepare-set.mjs review-tool/sets/<slug>.json
   ```
   Check: no `⚠️ Nouns not found` warning (fix the key's spelling), every script's `changed:` list contains its student name, and spot-check `<slug>.preview.json` (previews never overwrite `<slug>.prepared.json`, which records what was actually uploaded) — especially sentences with numbers, `%`, abbreviations (`St.`, `Dr.`, initials) and Devanagari. Look for bad sentence splits (very short sentences, sentences starting lowercase).

5. **Upload:**
   ```bash
   node review-tool/cli/prepare-set.mjs review-tool/sets/<slug>.json --upload
   ```
   - `--replace` re-uploads a set **only if no script has been opened yet** (it refuses otherwise).
   - `--update-nouns` refreshes only the Fix-panel options of an existing set — safe at any time (sentences, fixes, statuses untouched).

6. **Report to the user:** script count, which names went to Devanagari, which stayed English, rules applied (with any new learned rule), anything you were unsure about (ambiguous name pronunciations — e.g. Shristi vs Srishti), and the URL. **No redeploy is needed** for a new set — `/review` reads Supabase on load.

## Pronunciation rules (current)

Evidence: `candidate-grid/` (v2: Devanagari 9/9, respellings 5/21) and reviewer changes.

| Case | Rule | Example |
|---|---|---|
| Indian person name | Devanagari | `Vidhi` → `विधि`, `Sudhanshu` → `सुधांशु` |
| Indian institution / Hindi-Sanskrit words | Short Indian part → Devanagari, English for "College/University/School". Long multi-word or place-based names → keep English, give Devanagari **and** hyphenated respelling options | `Hansraj College` → `हंसराज College`; `Hiranandani Foundation School Thane` kept, with both options |
| English brands, international names, well-known places | Keep as written; give respelling options (reviewers fixed Himalaya → `Him-aa-la-ya`, Symbiosis → `Sim-bio-sis`) | `Marsh McLennan`, `Delhi` |
| ALL-CAPS brand names | Keep as written; normal case as an option (a reviewer reverted `Alten` → `ALTEN`) | `ALTEN`, option `Alten` |
| **All numbers** | **English words (automatic)** — in Devanagari-containing sentences the voice reads digits in Hindi | `94.4%` → `ninety-four point four percent`, `10th` → `tenth`, `Class 12th` → `Class twelve`, `Rs. 1000` / `₹50 lakh` → `one thousand rupees` / `fifty lakh rupees`, `3.6x` → `three point six times`, `20+` → `twenty plus` |
| **Em dash / ellipsis** | **Comma (automatic)**; trailing ellipsis → full stop. They caused 1-second pauses and odd closing tone | `family — see you` → `family, see you`, `soon…` → `soon.` |
| **Lead-in before a Devanagari name** | **Devanagari (automatic)** — reviewers did this by hand 18× in Set 3 | `Hey विधि` → `हे विधि`, `When you spoke with गौरव` → `वेन यू स्पोक विद गौरव` |
| Unusual acronyms | Spaced letters | `KIIT` → `K I I T`, `PSG` → `P S G` |
| Common acronyms | Keep, with letter options | `CGPA`, `CFA`, `B.Com` |
| "St." / abbreviations | Expand | `St. Xavier's` → `Saint Xavier's` |
| "Masters’ Union" | `Masters Union` (library) | |
| "Jain" | Keep English (reviewer preference) | `Shri Jain Public School` |

When unsure, keep the original as `spoken` and put alternatives in `options` — reviewers will pick, and the pick is saved to the library.

### Learned rules (append after each set)
- Set 1 → `KIIT`, `NMIMS` spaced letters; "Jain" in English; space before `%`.
- Set 2 → sentence splitter must ignore abbreviations (`St.`); fixed in `prepare-set.mjs`.
- Set 2 reviews → person names in Devanagari: no complaints. Places/institutions mixed: Lilavatibai Podar and Rohini moved *from* Devanagari to respellings, Ahmedabad *to* Devanagari (all now in the library). **12 of 17 kept fixes were just another take of the same text** — 6 of them the closing "Welcome to the Masters' Union family…" sentence.
- Set 3 → splitter also ignores `Rs.` and chained initials (`O.P.`); `Rs. N` → `N rupees`; ALL-CAPS brands to normal case.
- Set 3 reviews (ABHAY: 191 takes for 47 kept fixes) → **root cause: Devanagari in a sentence pulls nearby English words and digits into Hindi.** Reviewers wrote lead-ins in Devanagari (`वेन यू स्पोक विद`, `हे`) and numbers as English words. Both are now automatic rules in `src/lib/review/spoken-rules.mjs` (replacing the digit-by-digit and space-before-`%` rules). Rishika and Nikunj approved in English; Tanmay, Saaransh, Thane confirmed Devanagari; Saad → `साअद`; ALTEN kept in caps. Reviewers also saved number fixes to the library — `isNumberEntry()` ignores those.
- Set 4 → CSV message column was `Corrected Founder Message` (prepare-set accepts either); splitter joins a part that starts lowercase (`family... we can't wait`).
- Set 4 reviews (Shashwat) → the new number words and Devanagari lead-ins drew **no** edits. 23 of 33 fixes were re-takes; the closing "Welcome to the Masters' Union family — …" line again (5 of 6 had an em dash; a reviewer deleted one by hand; a Set 2 client comment: "video pauses for a second before the welcome line") → **em dashes / ellipses → commas** (new rule). Library: Jai Hind College back to English; Thakor → `Thaa-kor`; Maruti Suzuki → `Maa-ru-ti Su-zu-ki`. Reviewers sometimes glue words (`LawUniversity`) to stop a pause — not generalised.
- Set 5 → added `₹N lakh/crore`, `Nx` → "times", `Class Nth` → "Class N"; key longer names that contain a first name (`Manav Rachna International School` vs `Manav`).

## How the app works (where to change things)

| Concern | Where |
|---|---|
| Sentence audio generation, browser cache, silence trimming, pauses | `src/app/review/audio.ts` — `PAUSE_SENTENCE = 0.5`, `PAUSE_PARAGRAPH = 0.6`, `MIN_SILENCE = 0.3`, `MAX_CONCURRENT = 5` |
| ElevenLabs call (model, voice settings, neighbour context) | `src/app/review/api/tts/route.ts` |
| Fix / Edit panel, prepared chips, "Ask Claude", Edit-mode `toSpoken` | `src/app/review/FixPanel.tsx` |
| Screen, approve/download/reopen, delete+undo, change logging, reviewer name | `src/app/review/ReviewApp.tsx` (`PREFETCH_NEXT_SCRIPT` is off on purpose) |
| Server actions (save sentences, library, status, suggestions, logs) | `src/app/review/actions.ts` — "Ask Claude" uses `claude-opus-5-5`, low effort, `CLAUDEAPI_KEY` |
| Passcode + Supabase client | `src/lib/review/server.ts` |
| Text rules — names, numbers → words, Devanagari lead-ins (**one file, used by set prep and Edit mode**) | `src/lib/review/spoken-rules.mjs` |
| Sentence splitting, library merge, upload | `review-tool/cli/prepare-set.mjs` |

Design invariants — keep them:
- **Text only in Supabase**; audio is generated per sentence on demand and cached in the browser (IndexedDB). Cache keys include the exact text, neighbour context and seed.
- When a sentence changes, its neighbours get `prev_context` / `next_context` frozen to what their audio was generated with, so they're reused unchanged. Preserve this in any new editing feature.
- Any change to an **approved** script moves it back to `in_review`.
- Approved scripts don't generate audio on open.
- Every reviewer action is appended to `sentence_changes` (never updated).

## Deploying app changes

```bash
npx tsc --noEmit -p . && npx eslint src/app/review src/lib/review
npm run build
vercel deploy --prod --yes          # ask the user first
vercel inspect <deployment-url>     # confirm "Ready" and aliased to mu-avatar-automation.vercel.app
```
The deploy uploads the working tree (minus `.vercelignore`), so any uncommitted change to the legacy tool goes live too — mention it.
The first `vercel deploy` often returns `"status": "error"` with no build error — just run it again; the retry has succeeded every time.

## Data & environment

- Supabase project **mu-script**; tables `sets`, `scripts`, `pronunciation_library`, `sentence_changes` (see `review-tool/schema.sql`). RLS on, no policies — only the server's secret key can access them. Free plan: pauses after 7 days idle.
- `.env.local` keys: see `.env.example`.
- `c8-scripts/*.csv` and `review-tool/sets/*.prepared.json` contain student data — keep them out of deployments and public places.

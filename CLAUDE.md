# Agent handoff — MU founder-message audio

You are maintaining the **Script Review** tool (`/review`): personalised Masters' Union welcome messages, voiced by ElevenLabs, reviewed by 2–3 people who fix mispronounced Indian names and download a WAV per student. The human overview is in [README.md](README.md). This file is what you need to **run the process** — most often: *"New set: `c8-scripts/<file>.csv`"*, sometimes *"Client feedback: `c8-scripts/Comments-added/<file>.csv`"*.

## Hard rules

1. **Never test automatically.** Don't start the dev server, drive a browser against the app, or call ElevenLabs/Claude to "check" things — they cost credits. Finish every change with **manual test steps** for the user. (Static checks are fine: `npx tsc --noEmit -p .`, `npx eslint src/app/review src/lib/review`, `npm run build`, and running the `review-tool/cli` scripts, which only read/write Supabase.)
2. **Ask before anything outward-facing:** deploying, uploading a set that replaces another, changing Vercel env vars, running SQL in Supabase, purging stored audio. Uploading a *new* set is the expected outcome of "New set: …" and importing feedback the expected outcome of "Client feedback: …" — neither needs extra confirmation.
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

## Client feedback on a delivered set — the procedure

Input: the set's CSV with a `comment` column (client QC on the videos) and "No regen" written in another column for comments the user decided not to fix. Respect "No regen" — never suggest fixes for those.

1. **Read every comment and the script it's about** (`python3` + `csv.DictReader`, `utf-8-sig`). Compare the sheet's `Founder Message` with what was voiced — clients sometimes edit the wording *after* delivery (Set 2: `Delhi Public School` → `DPS`); the import preview prints these as `✎ client's sheet now says`.
2. **Write the spec** `review-tool/feedback/<slug>.json` (copy `c8-r1-set-2.json`; the folder is git-ignored — it names students' application numbers): per application number, the 1-based sentence(s) to redo with an optional new `original` wording and a `note` for the reviewer. Spoken text is computed with today's rules (keep the name spellings the sentence already uses); put round-specific spellings in `spellings`.
3. **Preview, then import:**
   ```bash
   node review-tool/cli/import-feedback.mjs review-tool/feedback/<slug>.json            # shows now → send for each sentence
   node review-tool/cli/import-feedback.mjs review-tool/feedback/<slug>.json --upload   # attaches it in /review; statuses untouched
   ```
4. **Report:** per comment — what's wrong, root cause, the suggested text, and that the **video needs that sentence redone** (lip-sync / re-render is outside this repo). Reviewers then open the script: an approved script loads its stored clips (or they drop in the delivered WAV), *Use suggestion* → generate → keep → **Download patched (vN)**. Only the flagged sentences are regenerated; the script stays approved and gets a *Patched* tag.
5. Add what you learned to **Learned rules** below.

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
| **Name addressed at the end of a sentence** | **English spelling (automatic)** — reviewers deleted or anglicised the Devanagari there 3× (Sets 6–7) | `…family, जय!` → `…family, Jai!`; greetings and "spoke with" keep Devanagari |
| Emoji, spaced en dash | Emoji removed; ` – ` → comma (automatic) | `✨ Welcome…` → `Welcome…` |
| **Lead-in before a Devanagari name** | **Devanagari (automatic)** — reviewers did this by hand 18× in Set 3 | `Hey विधि` → `हे विधि`, `When you spoke with गौरव` → `वेन यू स्पोक विद गौरव` |
| Unusual acronyms | Spaced letters | `KIIT` → `K I I T`, `PSG` → `P S G` |
| Common acronyms | Keep, with letter options | `CGPA`, `CFA`, `B.Com` |
| Indian city names | Devanagari (Set 8 reviewer converted Ahmedabad, Indore, Chandigarh, Bhubaneswar) | `Kolkata` → `कोलकाता`, `University of Mumbai` → `University of मुंबई` |
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
- Set 6 → no new rule needed (Set 5 not reviewed yet when Set 6 was prepared, so the dash/ellipsis rule is still unconfirmed by reviewers). Client-written acronyms kept as letters (`B2B` → `B to B`, `R&D` → `R and D`, `KU Leuven` → `K U Leuven`, `O9` → `O nine`).
- Set 5/6 reviews → the dash/ellipsis rule works: Set 6 needed **21 takes for 20 scripts** (vs 191 takes on Set 3); closing-line re-rolls 6 → 2 per set. Lead-ins `हे` / `वेन यू स्पोक विद` were kept unchanged in Sets 4 and 6. Set 5 (ABHAY, 540 takes / 118 fixes) shows ~20 variants of the lead-in (`वेन यू spoke with`, `वेनयूस्पोकविद`, …) — re-rolling text until a take sounded right, not a consistent preference → rule kept. **Takes per script varies far more by reviewer than by rule** — compare `changes.mjs` per reviewer before changing a rule. Two reviewers dropped a Devanagari name at the end of a closing line (`…community, चिरंथ!`) — watch, not yet a rule.
- Set 7 → CSV exported with a blank header row (`,,`); `common.mjs` now assumes the standard 3 columns. Unusual first names (`Vivean`) kept in English with a Devanagari option.
- Set 7 reviews (Shashwat, 68 takes / 30 fixes, 23 of them re-takes) → third case of a Devanagari name addressed at the end of a closing line being removed/anglicised (`family, जय!` → `Jay`) → **new rule: addressed names stay English** (`toSpoken`, single-word names after a comma before `!`/`.`/`—`). Library: Jai → English, Thapar Institute → English, Chinmaya Vidyalaya → Devanagari.
- Sets 8–9 → CSV header `,,,correct` (blank first three + a QC column) — `common.mjs` now names any blank first three header cells; `⸻` divider lines and `✨` emoji appear in sheets (dropped / removed). Spaced en dashes ` – ` used like em dashes → comma. Client typos read as intended in the spec (`IIIIT` → I I I T, `B.Come`, `DPSl`, `O.P Jindal`). Library entries approved by one reviewer apply everywhere (e.g. `Aditya` approved in English by ABHAY) — that's intended; remove with `library.mjs remove` only if the user disagrees.
- Set 8 reviews ("Scoring…" heard as "coring") → **not ElevenLabs: `trim()` in `audio.ts` cut the "S".** The "s" of "Sc-" is a 60–100 ms hiss at −36…−47 dB (below `SPEECH_DB`), parted from the vowel by the "k" closure (< −55 dB), so the soft-onset walk stopped at the gap — 28 of 32 stored "Scoring" clips lost all of it (even reviewers' `स्कोरिंग` workaround). Same at sentence ends: final "-s" lost/shortened in ~⅓ of sentences ending in s/ce (`experiences.` → "experience"). Fix (`TRIM_VERSION = 2`): hiss (≥ 30 ms above −50 dB, zero-crossing rate > 0.2) within 0.3 s of the speech counts as speech; pauses unchanged (audible gaps 320–490 → 370–500 ms). **Delivered files keep the old trim**: sentences carry `trim_version` (stamped at approval / on a patched sentence); unstamped stored clips rebuild with the old trim, so patches still keep every other sample (verified byte-identical on 6 scripts). Before blaming the voice, check the trim offline on stored clips (`review-audio` bucket) — free.
- Set 8 reviews (Kv, 196 actions) → Indian cities to Devanagari (4×) → **new default for Set 10+**. Kv reverted the Devanagari lead-in `वेन यू स्पोक विद` → "When you spoke with" ~13× across 32 scripts, while ABHAY (Set 3) added it by hand and Shashwat kept it (Sets 4, 6, 7) — **reviewers disagree; rule kept, user to decide.** Kv also fixed Gurneesh's pronoun (she/they → he) in 2 scripts — the CSV itself was inconsistent → `prepare-set.mjs` preview now **warns when an interviewer's pronoun differs across the set**. Library now has `campus` → `कैम्पस` (one reviewer, applies to every "campus"), Gurneesh → गुरनीश, Mayank / Malthi / Kanika English.
- Set 10 → applied the city rule; interviewer pronouns consistent; no new text rule.
- Set 2 client QC on the videos (11 scripts, 7 comments, 2 "No regen") → 3 comments were digits next to Devanagari (`94.6 %` heard as "parent", `97.4 %`, `96.5 %`) — the number-words rule already prevents this. 1 was the em-dash pause. Saad still unclear as `साद` → `साअद`. 3 were the client's own later edits (`DPS`, `BBA`, `IP University`): **acronyms the client writes are read as letters, never expanded**, and confirm the CSV is final before preparing a set. Reviewers had fixed these by hand with respellings (`saaad`, `Anand Nii ke tun`) and glued words (`MatriculationHigher`) — prefer the suggested rule-based text. Reopening those approved scripts regenerated **every** sentence while reviewers only re-checked the fixed one → the full-listen rule; Harsh, Surya, Anshika (re-approved) and Utkarsh, Manaavi, Paavni (in review) were flagged for a full listen.

## How the app works (where to change things)

| Concern | Where |
|---|---|
| Sentence audio generation, browser cache, silence trimming, pauses | `src/app/review/audio.ts` — `PAUSE_SENTENCE = 0.5`, `PAUSE_PARAGRAPH = 0.6`, `MIN_SILENCE = 0.3`, `MAX_CONCURRENT = 5`; hiss-aware trim `TRIM_VERSION = 2` (a change to `trim()` must bump it and keep the old one for unstamped stored clips) |
| ElevenLabs call (model, voice settings, neighbour context) | `src/app/review/api/tts/route.ts` |
| Fix / Edit panel, prepared chips, "Ask Claude", Edit-mode `toSpoken` | `src/app/review/FixPanel.tsx` |
| Screen, approve/download/reopen, delete+undo, change logging, reviewer name | `src/app/review/ReviewApp.tsx` — Approve & download prepares the next unapproved script (the one "Next script" opens); `PREFETCH_NEXT_SCRIPT` (prepare on every open) stays off on purpose |
| Server actions (save sentences, library, status, suggestions, logs) | `src/app/review/actions.ts` — "Ask Claude" uses `claude-opus-5-5`, low effort, `CLAUDEAPI_KEY` |
| Passcode + Supabase client | `src/lib/review/server.ts` |
| Text rules — names, numbers → words, Devanagari lead-ins (**one file, used by set prep and Edit mode**) | `src/lib/review/spoken-rules.mjs` |
| Sentence splitting, library merge, upload | `review-tool/cli/prepare-set.mjs` |
| Patching delivered audio — split an uploaded WAV at its digital-silence pauses, splice one sentence, keep-original-length fit (WSOLA ≤ 6%) | `src/app/review/audio.ts` (`audioFromDelivered`, `spliceSentence`, `fitToOriginal`); UI in `ReviewApp.tsx` |
| Stored approved clips (private bucket `review-audio`) | `src/app/review/api/clips/route.ts` (GET/PUT through the server), `setStoredClips` / `savePatch` in `actions.ts` |
| Client feedback import · stored-audio usage/purge · full-listen flags | `review-tool/cli/import-feedback.mjs` · `review-tool/cli/audio.mjs` · `review-tool/cli/full-listen.mjs` |
| Full-listen tracking, no-skip lock (`HEARD_SHARE = 0.9`) | `ReviewApp.tsx` (`trackListening`, `lockedFrom`) |

Design invariants — keep them:
- **Text in the database; audio only as approved clips.** Audio is generated per sentence on demand and cached in the browser (IndexedDB). On approval the exact clips go to the private bucket `review-audio` (`<script_id>/<clip key>.pcm`, key = the cache key: exact text, neighbour context, seed) so a later fix regenerates only the changed sentence. Purge a set's clips when its videos are done.
- When a sentence changes, its neighbours get `prev_context` / `next_context` frozen to what their audio was generated with, so they're reused unchanged. Preserve this in any new editing feature.
- A fix to an **approved** script is a **patch**: only that sentence is regenerated and spliced into the delivered audio (stored clips or the uploaded WAV — every other sample stays identical), nothing is saved until *Download patched (vN)*, then the script stays `approved` with a `patches` record. *Reopen* still moves it back to `in_review`.
- Approved scripts never generate audio on open — they load stored clips, or the reviewer uploads the delivered WAV.
- **Full-listen rule:** reopening an approved script *without* stored clips regenerates every sentence, so any of them may now differ from what was delivered (reviewers in Set 2 assumed only the fixed sentence changes). Such scripts carry `scripts.full_listen`: a red box, no jumping or seeking past the furthest point actually played, and Approve (or *Confirm full listen* on an approved script) unlocks only when every sentence has been heard (≥ 90 % played; a replaced sentence must be heard again). Set automatically on reopen; for older cases use `review-tool/cli/full-listen.mjs`. Patch mode doesn't need it — untouched sentences are byte-identical.
- Every reviewer action is appended to `sentence_changes` (never updated).

## Deploying app changes

**Several sessions work on this repo at once** (the main folder plus `.claude/worktrees/*`), and each can push and deploy. `vercel deploy` uploads *your* working tree, so deploying from a copy that is missing someone else's pushed commits silently removes their fixes from production. On 17 Oct 2026 that happened: a deploy from a stale `v5` dropped "Approve & download prepares the next script" and the one-second start beat until they were merged back.

**Before every deploy, sync with GitHub — and never deploy from a branch that is behind `origin/v5`:**

```bash
git fetch origin
git status -sb                      # must NOT say "behind"; if it does:
git merge origin/v5                 # (commit your own work first) — resolve, re-check, then continue
git log --oneline origin/v5..HEAD   # your commits that are not on GitHub yet
git log --oneline HEAD..origin/v5   # must print nothing
```

Then:

```bash
npx tsc --noEmit -p . && npx eslint src/app/review src/lib/review
npm run build
vercel deploy --prod --yes          # ask the user first
vercel inspect <deployment-url>     # confirm "Ready" and aliased to mu-avatar-automation.vercel.app
git push origin v5                  # push what you deployed, so the next session starts from it
```

- Commit before deploying, and push right after — what is live should always be on `origin/v5`.
- Working in a worktree (`claude/*` branch)? Merge `origin/v5` in first, deploy, then push to `v5` (`git push origin HEAD:v5`) so the main folder and other sessions pick it up.
- The deploy uploads the working tree (minus `.vercelignore`), so any uncommitted change — including to the legacy tool — goes live too. Mention it.
The first `vercel deploy` often returns `"status": "error"` with no build error — just run it again; the retry has succeeded every time.

## Data & environment

- Supabase project **mu-script**; tables `sets`, `scripts`, `pronunciation_library`, `sentence_changes` (see `review-tool/schema.sql`) and the private Storage bucket `review-audio`. RLS on, no policies — only the server's secret key can access them. Free plan: pauses after 7 days idle; **1 GB storage** (≈ 6 MB of clips per approved script) — check with `node review-tool/cli/audio.mjs usage`, and once a set's videos are signed off, purge it (ask first): `node review-tool/cli/audio.mjs purge "<set name>" --yes`.
- `.env.local` keys: see `.env.example`.
- `c8-scripts/*.csv` and `review-tool/sets/*.prepared.json` contain student data — **the GitHub repo is public, so they are git-ignored** (also `.vercelignore`d). A fresh clone won't have them: get the CSVs from the user, and treat Supabase as the source of truth for what was uploaded. Never commit or push them.

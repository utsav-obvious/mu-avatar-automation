# Audio Audit: Pronunciation Auditing Tool Specification

## Overview
Audio Audit is an internal tool designed to ensure correct pronunciation of proper nouns in AI-generated audio. It automates the extraction of proper nouns, generates phonetic variations using proven techniques, and allows users to audit both isolated words and their performance within sentence context.

## Technical Stack
- **Framework:** Next.js (App Router, Tailwind CSS)
- **AI/LLM:** Google Gemini (for noun extraction and phonetic variation generation)
- **TTS Engine:** ElevenLabs (using a specific Voice ID)
- **Database:** Local JSON or SQLite (for storing approved pronunciations and project history)

## Key Features

### 1. Script Processing
- **Manual Input:** A text area for users to paste a single script.
- **Extraction:** Gemini extracts proper nouns (Names, Places, Organizations, Acronyms) from the text.
- **Variation Generation:** Gemini suggests 3 phonetic variations per noun, applying ElevenLabs-specific optimizations (Phonetic Respelling, Syllable Timing, etc.).

### 2. Auditing Interface
- **Variation List:** Each noun displays its original spelling and 3 suggested variations.
- **Play Buttons (Isolation):** Listen to the variation as a standalone word.
- **Play Button (Context):** Listen to the variation **inside the original sentence segment** (crucial for catching prosody-induced errors).
- **Manual Editing:** Users can manually type a custom phonetic respelling and click "Listen" (Isolation or Context).
- **Context Debug Toolbar:** Quick-toggle buttons to apply "Micro-pauses" (`...`), "Em-dash" (` — `), or "Capitalization" for stress anchoring in the context preview.
- **Selection:** Users select the variation that sounds most natural in context.

### 3. Finalization & Export
- **Script Reconstruction:** The tool replaces original nouns with selected variations, including any chosen context-fixes (e.g., adding ellipses around the name).
- **Final Audio Generation:** ElevenLabs generates the full audio file for the finalized script.
- **Local Storage:** Files are saved to a directory with a custom user-defined filename.

### 4. Pronunciation Database (Future Version)
- **Global Store:** Automatically store approved phonetic respellings.
- **Auto-Suggest:** Suggest previously approved pronunciations for the same proper nouns.
- **.pls Export:** Generate an ElevenLabs Pronunciation Library Settings file.

### 5. Automated Validation (Future Version)
- **TTS → STT Consistency Test:** 
  - Automatically generate audio for the word (A) and the sentence (B).
  - Use Speech-to-Text (STT) to transcribe both.
  - **Verdict:** If (B) transcribes the name differently than (A), flag it as a "Prosody Error" for manual review.
- **Timestamp Isolation:** Use ElevenLabs timestamps to isolate the specific "name segment" in the sentence audio for targeted STT verification.

---

## Technical Details

### ElevenLabs Pronunciation Techniques
1. **Phonetic Respelling:** `Ramesh` → `Ruh-mesh`
2. **Schwa Removal:** `Vikram` → `Vik-ram`
3. **Aspiration Control:** `Bhagat` → `Bhaa-gut`
4. **Short Vowel Forcing:** `Anil` → `Uh-nil`
5. **Syllable Timing (Hyphens):** `Hyderabad` → `Hai-de-ra-baad`
6. **Nasal Approximation:** `Anand` → `Uh-nund`
7. **Region-Aware Variants:** (e.g., North vs. South style)
8. **Pause Control (Ellipses):** `Ruh-mesh... from Hai-de-ra-baad`
9. **Capitalization for Emphasis:** `BHA-gut`

### Context-Based Optimization (The "Prosody Fix")
Since ElevenLabs optimizes at the sentence level, the tool provides tools to handle context-collision:
- **Micro-Pauses (Ellipses/Dashes):** Isolates names to prevent phonetic blending.
  - *Example:* `We spoke to... Ruh-mesh ...from Ban-ga-lor.`
- **Duplicate/Shadowing:** Reinforce pronunciation by repeating the cue.
  - *Example:* `Ruh-mesh — yes, Ruh-mesh — will join.`
- **Collision Reduction:** Insert breaks before/after high-risk endings (`s/z`, `r`, `t/d`).
  - *Example:* `meets... Ruh-mesh` instead of `meetsRamesh`.
- **Stress Anchoring:** Using capitalization (e.g., `Ruh-MESH`) to prevent the sentence rhythm from flattening the name.

### Workflows
1. **Input:** User pastes script.
2. **extraction:** Gemini returns JSON of nouns + variations.
3. **Review:** User audits isolated audio.
4. **Context Check:** User clicks "Context Play" to hear the name inside the sentence.
5. **Debug (if needed):** User applies "Add Pauses" or "Anchor Stress" if the name sounds wrong in context.
6. **Finalize:** Tool generates full script + audio.

## Evaluation & Success Criteria
- **Extract accuracy:** >95% of relevant nouns caught.
- **Context Integrity:** Tool allows fixing "word-collision" errors that isolation-testing misses.
- **Efficiency:** Audit and fix of a 2-minute script in under 5 minutes.
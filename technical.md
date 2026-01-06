# Technical Specification: Audio Audit

This document outlines the technology stack, architectural decisions, and UI/UX libraries for the Audio Audit tool.

## Core Tech Stack
- **Framework:** [Next.js 15+](https://nextjs.org/) (App Router)
- **Language:** TypeScript
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Component Library:** [shadcn/ui](https://ui.shadcn.com/) (Radix UI + Tailwind)
- **Icons:** [Lucide React](https://lucide.dev/)
- **Animations:** [Framer Motion](https://www.framer.com/motion/) (for smooth transitions between auditing states)

## AI & Audio Services
- **LLM (Extraction & Phonetics):** [Google Gemini 3 Flash](https://aistudio.google.com/)
  - Why: Most intelligent model family built on state-of-the-art reasoning, mastering agentic workflows and complex multimodal tasks.
  - Features: Native "thinking" architecture and `thinking_level` control for deep reasoning.
- **TTS (Speech Synthesis):** [ElevenLabs API](https://elevenlabs.io/api)
  - Features: Multi-lingual support, high-fidelity Indian accents, and timestamp support for context-auditing.

## Data Management
- **Local State:** React Hooks (`useState`, `useReducer`) for current session auditing.
- **Persistence:** 
  - **Project Assets:** Local filesystem (`fs` module) within server actions to save `.mp3` and `.txt` files.
  - **Pronunciation DB (Future):** SQLite via `better-sqlite3` or a simple `db.json` for lightweight local persistence.

## UI Components & Design System
To ensure a premium, internal-tool aesthetic:
- **Library:** shadcn/ui for consistent, accessible primitives (Buttons, Cards, Dialogs).
- **Layout:** Responsive, sidebar-less focused workspace.
- **Typography:** Inter or Outfit (Google Fonts) for high readability.
- **Theming:** Dark mode by default with glassmorphic accents for proper noun cards.
- **Components:**
  - Card-based interface for proper nouns.
  - Inline audio players with waveform visualizations (using `wavesurfer.js` if needed).
  - Progress tracking for script analysis.

## API Integration Architecture
### Server Actions Flow
1. **`analyzeScript(text: string)`**: Sends text to Gemini → Receives JSON of nouns.
2. **`generatePreview(text: string, voiceId: string)`**: Hits ElevenLabs → Returns Signed URL or Base64 audio.
3. **`saveAssets(script: string, audioBuffer: Buffer, name: string)`**: Writes files to the local project `/output` folder.

## Security & Reliability
- **API Keys:** Stored in `.env.local`, never exposed to the client.
- **Error Handling:** Boundary-level catch for Gemini/ElevenLabs failures with user-friendly retry prompts.
- **Rate Limiting:** UI-level debouncing for "Play" buttons to prevent accidental ElevenLabs credit drain.

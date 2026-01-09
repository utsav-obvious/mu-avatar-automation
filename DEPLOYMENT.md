# Deployment Guide (Vercel)

This guide provides instructions for deploying the **Mu-Avatar Automation** project to Vercel.

## 1. Prerequisites
- Vercel CLI installed (`npm i -g vercel`)
- Logged in to Vercel via CLI (`vercel login`)

## 2. Environment Variables
You MUST configure the following Environment Variables in the Vercel Dashboard or via CLI before deploying:

| Variable | Description |
| :--- | :--- |
| `GOOGLE_GEMINI_API_KEY` | API Key for Gemini Flash (Extraction) |
| `ELEVEN_LABS_API_KEY` | API Key for ElevenLabs (Audio Generation) |
| `ELEVEN_LABS_VOICE_ID` | (Optional) The voice ID to use for generation |

## 3. Important Notes on Storage
> [!WARNING]
> **Ephemeral Filesystem**: The current implementation saves audit sessions to `data/audits/*.json`. 
> - On Vercel, this filesystem is **temporary**.
> - Files saved during a session will be lost when the function instances spin down or when you redeploy.
> - For production use, consider migrating `storage-actions.ts` to a database (e.g., Supabase, Vercel Postgres).

## 4. Deployment Command
To deploy to production, run:
```bash
vercel deploy --prod
```

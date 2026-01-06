"use server";

import { ElevenLabsClient } from "elevenlabs";

const apiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceId = process.env.ELEVEN_LABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // Default voice if not set

const elevenlabs = new ElevenLabsClient({
    apiKey: apiKey,
});

export async function generateVariationAudio(text: string): Promise<string> {
    if (!apiKey) {
        throw new Error("ElevenLabs API Key is missing. Please check your .env.local file.");
    }

    try {
        // Generate audio using ElevenLabs
        const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
            text: text,
            model_id: "eleven_multilingual_v2", // Good for Indian accents
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
            },
        });

        // Convert stream to Buffer
        const chunks: Buffer[] = [];
        for await (const chunk of audioStream) {
            chunks.push(Buffer.from(chunk));
        }
        const audioBuffer = Buffer.concat(chunks);

        // Convert Buffer to Base64
        const base64Audio = audioBuffer.toString("base64");
        return `data:audio/mpeg;base64,${base64Audio}`;
    } catch (error) {
        console.error("Error generating ElevenLabs audio:", error);
        throw new Error("Failed to generate audio preview.");
    }
}

/**
 * Generates audio for a variation within its original script context.
 * Useful for checking prosody.
 */
export async function generateContextAudio(script: string, original: string, variation: string): Promise<string> {
    if (!apiKey) {
        throw new Error("ElevenLabs API Key is missing.");
    }

    // Replace the original word with the phonetic variation in the script
    const contextText = script.replace(original, variation);

    try {
        const audioStream = await elevenlabs.textToSpeech.convert(voiceId, {
            text: contextText,
            model_id: "eleven_multilingual_v2",
        });

        const chunks: Buffer[] = [];
        for await (const chunk of audioStream) {
            chunks.push(Buffer.from(chunk));
        }
        const audioBuffer = Buffer.concat(chunks);
        const base64Audio = audioBuffer.toString("base64");
        return `data:audio/mpeg;base64,${base64Audio}`;
    } catch (error) {
        console.error("Error generating context audio:", error);
        throw new Error("Failed to generate context audio.");
    }
}

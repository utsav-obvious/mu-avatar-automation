"use server";

import { ElevenLabsClient } from "elevenlabs";

const apiKey = process.env.ELEVEN_LABS_API_KEY;
const voiceId = process.env.ELEVEN_LABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // Default voice if not set

const elevenlabs = new ElevenLabsClient({
    apiKey: apiKey,
});

export interface WordAlignment {
    word: string;
    start: number;
    end: number;
}

export interface AudioResponse {
    audioData: string;
    alignments?: WordAlignment[];
}

export async function generateVariationAudio(text: string): Promise<AudioResponse> {
    if (!apiKey) {
        throw new Error("ElevenLabs API Key is missing. Please check your .env.local file.");
    }

    try {
        // Generate audio using ElevenLabs with Timestamps
        const response = await elevenlabs.textToSpeech.convertWithTimestamps(voiceId, {
            text: text,
            model_id: "eleven_multilingual_v2",
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
            },
        });

        const audioBase64 = response.audio_base64;
        const audioData = `data:audio/mpeg;base64,${audioBase64}`;

        let wordAlignments: WordAlignment[] = [];
        if (response.alignment) {
            const { characters, character_start_times_seconds, character_end_times_seconds } = response.alignment;

            let currentWord = "";
            let wordStart = 0;

            for (let i = 0; i < characters.length; i++) {
                const char = characters[i];
                const start = character_start_times_seconds[i];
                const end = character_end_times_seconds[i];

                if (currentWord === "") {
                    wordStart = start;
                }

                if (char === " " || char === "\n" || char === "\t") {
                    if (currentWord.length > 0) {
                        wordAlignments.push({ word: currentWord, start: wordStart, end: character_end_times_seconds[i - 1] });
                        currentWord = "";
                    }
                } else {
                    currentWord += char;
                }
            }

            // Push final word if exists
            if (currentWord.length > 0) {
                wordAlignments.push({
                    word: currentWord,
                    start: wordStart,
                    end: character_end_times_seconds[characters.length - 1]
                });
            }
        }

        return { audioData, alignments: wordAlignments };
    } catch (error) {
        console.error("Error generating ElevenLabs audio with timestamps:", error);
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

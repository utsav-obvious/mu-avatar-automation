"use server";

import { ElevenLabsClient } from "elevenlabs";

const elevenLabsApiKey = process.env.ELEVEN_LABS_API_KEY;
const elevenLabsVoiceId = process.env.ELEVEN_LABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

const minimaxApiKey = process.env.MINIMAX_API_KEY;
const minimaxGroupId = process.env.MINIMAX_GROUP_ID;
const minimaxVoiceId = process.env.MINIMAX_VOICE_ID || "male-en-001"; // Fallback voice
const minimaxModel = process.env.MINIMAX_MODEL || "speech-2.5-hd-preview";

const elevenlabs = new ElevenLabsClient({
    apiKey: elevenLabsApiKey,
});

export type TTSProvider = "elevenlabs" | "minimax";

export interface WordAlignment {
    word: string;
    start: number;
    end: number;
}

export interface AudioResponse {
    audioData: string;
    alignments?: WordAlignment[];
}

export async function generateVariationAudio(text: string, provider: TTSProvider = "elevenlabs"): Promise<AudioResponse> {
    if (provider === "minimax") {
        return generateMinimaxAudio(text);
    }

    if (!elevenLabsApiKey) {
        throw new Error("ElevenLabs API Key is missing. Please check your .env.local file.");
    }

    try {
        // Generate audio using ElevenLabs with Timestamps
        const response = await elevenlabs.textToSpeech.convertWithTimestamps(elevenLabsVoiceId, {
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

async function generateMinimaxAudio(text: string): Promise<AudioResponse> {
    if (!minimaxApiKey || !minimaxGroupId) {
        throw new Error("MiniMax API Key or Group ID is missing.");
    }

    try {
        const response = await fetch(`https://api.minimax.io/v1/t2a_v2?GroupId=${minimaxGroupId}`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${minimaxApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: minimaxModel,
                text: text,
                stream: false,
                voice_setting: {
                    voice_id: minimaxVoiceId,
                    speed: 0.96,
                    vol: 1.0,
                    pitch: 0,
                },
                audio_setting: {
                    sample_rate: 32000,
                    bitrate: 128000,
                    format: "mp3",
                    channel: 1,
                },
            }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("MiniMax API Error:", errorData);
            throw new Error(`MiniMax API failed with status ${response.status}`);
        }

        const responseData = await response.json();

        if (responseData.base_resp?.status_code !== 0) {
            throw new Error(`MiniMax API error: ${responseData.base_resp?.status_msg}`);
        }

        let hexData = responseData.data;
        if (typeof hexData === 'object' && hexData !== null) {
            hexData = hexData.audio || hexData.audio_data;
        }

        if (!hexData || typeof hexData !== 'string') {
            console.error("Unexpected MiniMax response structure:", responseData);
            throw new Error("No valid audio data string received from MiniMax.");
        }

        // Converting hex to base64
        const audioBuffer = Buffer.from(hexData, "hex");
        const base64Audio = audioBuffer.toString("base64");
        const audioData = `data:audio/mpeg;base64,${base64Audio}`;

        return { audioData };
    } catch (error) {
        console.error("Error generating MiniMax audio:", error);
        throw new Error("Failed to generate MiniMax audio.");
    }
}

/**
 * Generates audio for a variation within its original script context.
 * Useful for checking prosody.
 */
export async function generateContextAudio(script: string, original: string, variation: string, provider: TTSProvider = "elevenlabs"): Promise<string> {
    // Replace the original word with the phonetic variation in the script
    const contextText = script.replace(original, variation);

    if (provider === "minimax") {
        const response = await generateMinimaxAudio(contextText);
        return response.audioData;
    }

    if (!elevenLabsApiKey) {
        throw new Error("ElevenLabs API Key is missing.");
    }

    try {
        const audioStream = await elevenlabs.textToSpeech.convert(elevenLabsVoiceId, {
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

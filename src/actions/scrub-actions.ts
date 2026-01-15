"use server";

import { ElevenLabsClient } from "elevenlabs";
import { WordAlignment } from "./audio-actions";

const apiKey = process.env.ELEVEN_LABS_FORCE;

const elevenlabs = new ElevenLabsClient({
    apiKey: apiKey,
});

export async function alignAudioToText(formData: FormData): Promise<WordAlignment[]> {
    if (!apiKey) {
        throw new Error("ElevenLabs API Key is missing.");
    }

    const file = formData.get("file") as File;
    const text = formData.get("text") as string;

    if (!file || !text) {
        throw new Error("File and text are required for alignment.");
    }

    try {
        // Use File object directly (ElevenLabs SDK handles Blobs/Files)
        const alignmentResponse = await elevenlabs.forcedAlignment.create({
            file: file,
            text: text,
        });

        if (!alignmentResponse.words) {
            return [];
        }

        // Map ElevenLabs words to our WordAlignment interface
        return alignmentResponse.words.map(w => ({
            word: w.text,
            start: w.start,
            end: w.end
        }));
    } catch (error) {
        console.error("Error in forced alignment:", error);
        throw new Error("Failed to align audio and text.");
    }
}

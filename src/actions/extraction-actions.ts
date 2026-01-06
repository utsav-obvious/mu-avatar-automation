"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

if (!apiKey) {
    console.warn("GOOGLE_GEMINI_API_KEY is not set in environment variables.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");
const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
});

export interface ExtractedNoun {
    original: string;
    context: string;
    variations: string[];
}

export async function extractProperNouns(script: string): Promise<ExtractedNoun[]> {
    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please check your .env.local file.");
    }

    const prompt = `
    Extract all proper nouns (Names, Places, Organizations, Acronyms) from the text.
    For each noun, provide its context and generate 3 phonetic variations optimized for ElevenLabs TTS using these techniques:
    1. Phonetic Respelling (e.g., Ramesh -> Ruh-mesh)
    2. Schwa Removal (e.g., Vikram -> Vik-ram)
    3. Aspiration Control (e.g., Bhagat -> Bhaa-gut)
    4. Short Vowel Forcing (e.g., Amit -> Uh-mit)
    5. Syllable Timing with Hyphens (e.g., Hyderabad -> Hai-de-ra-baad)
    6. Nasal Approximation (e.g., Anand -> Uh-nund)
    7. Regional Variants
    8. Pause Control (ellipses)
    9. Capitalization for emphasis.

    Return a strictly valid JSON array:
    [
      {
        "original": "Proper Noun",
        "context": "Sentence context...",
        "variations": ["Variation 1", "Variation 2", "Variation 3"]
      }
    ]

    Text:
    "${script}"
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        // Attempt to parse JSON. Gemini Flash is usually good but sometimes adds markdown blocks.
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            throw new Error("Failed to find JSON array in Gemini response.");
        }

        const data = JSON.parse(jsonMatch[0]);

        // Ensure variations exist
        return data.map((item: any) => ({
            ...item,
            variations: item.variations || [item.original, item.original, item.original]
        }));
    } catch (error) {
        console.error("Error extracting proper nouns:", error);
        throw new Error("Failed to extract proper nouns from the script.");
    }
}

export async function regenerateNounVariations(noun: string, context: string, existingVariations: string[] = []): Promise<string[]> {
    if (!apiKey) {
        throw new Error("Gemini API Key is missing.");
    }

    const prompt = `
    Generate 3 new and DIFFERENT phonetic variations for the proper noun "${noun}" found in this context: "${context}".
    
    IMPORTANT: Do not suggest any of these existing variations: ${existingVariations.join(", ")}.
    
    Current techniques: Phonetic Respelling, Syllable Timing, capitalizations, schwa removal, etc.
    
    Return ONLY a JSON array of 3 unique strings.
  `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().trim();

        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return [noun, noun, noun];

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error("Error regenerating variations:", error);
        return [noun, noun, noun];
    }
}

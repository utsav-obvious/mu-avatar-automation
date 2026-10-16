"use server";

import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
const openAiKey = process.env.OPEN_AI || process.env.OPENAI_API_KEY;

if (!apiKey) {
    console.warn("GOOGLE_GEMINI_API_KEY is not set in environment variables.");
}
if (!openAiKey) {
    console.warn("OPEN_AI or OPENAI_API_KEY is not set in environment variables.");
}

const genAI = new GoogleGenerativeAI(apiKey || "");
const model = genAI.getGenerativeModel({
    model: "gemini-3.1-pro-preview",
});

const openai = new OpenAI({
    apiKey: openAiKey || "",
});

export interface ExtractedNoun {
    original: string;
    context: string;
    variations: string[];
}

export type LLMProvider = "gemini" | "openai";

export async function extractProperNouns(script: string, provider: LLMProvider = "gemini"): Promise<ExtractedNoun[]> {
    if (provider === "gemini" && !apiKey) {
        throw new Error("Gemini API Key is missing. Please check your .env.local file.");
    }
    if (provider === "openai" && !openAiKey) {
        throw new Error("OpenAI API Key is missing. Please check your .env.local file.");
    }

    const prompt = `
    Extract all proper nouns (Names, Places, Organizations, Acronyms) from the text.
    For each noun, provide its context and generate 4 variations optimized for ElevenLabs TTS.
    
    IMPORTANT: 
    1. The "original" field MUST be the exact literal spelling as found in the text.
    2. The 4th variant (variations[3]) MUST be the Hindi translation of the noun in Devanagari script.
    3. SPECIAL CASE: If a proper noun (Name) is preceded by "Hey" (e.g., "Hey Pratham"), extract the whole phrase "Hey Pratham" as the "original" noun. This helps in maintaining natural prosody for greetings.
    
    Techniques for variations 1-3 (Phonetic):
    1. Phonetic Respelling (e.g., Ramesh -> Ruh-mesh)
    2. Schwa Removal (e.g., Vikram -> Vik-ram)
    3. Aspiration Control (e.g., Bhagat -> Bhaa-gut)
    4. Short Vowel Forcing (e.g., Amit -> Uh-mit)
    5. Syllable Timing with Hyphens (e.g., Hyderabad -> Hai-de-ra-baad)
    6. Nasal Approximation (e.g., Anand -> Uh-nund)
    7. Regional Variants
    8. Pause Control (ellipses)
    9. Capitalization for emphasis.

    Return a strictly valid JSON object with a single key "nouns" containing an array of objects:
    {
      "nouns": [
        {
          "original": "Proper Noun",
          "context": "Sentence context...",
          "variations": ["Phonetic 1", "Phonetic 2", "Phonetic 3", "Hindi Translation"]
        }
      ]
    }

    Text:
    "${script}"
  `;

    try {
        let text = "";

        if (provider === "openai") {
            const completion = await openai.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: "gpt-4o",
                response_format: { type: "json_object" },
            });
            text = completion.choices[0].message.content || "";
            const data = JSON.parse(text);
            return (data.nouns || []).map((item: any) => ({
                ...item,
                variations: item.variations || [item.original, item.original, item.original, item.original]
            }));
        } else {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            text = response.text().trim();

            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                // Fallback to array match if Gemini ignores the prompt changes
                const arrayMatch = text.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    const data = JSON.parse(arrayMatch[0]);
                    return data.map((item: any) => ({
                        ...item,
                        variations: item.variations || [item.original, item.original, item.original, item.original]
                    }));
                }
                throw new Error("Failed to find JSON in Gemini response.");
            }

            const data = JSON.parse(jsonMatch[0]);
            return (data.nouns || []).map((item: any) => ({
                ...item,
                variations: item.variations || [item.original, item.original, item.original, item.original]
            }));
        }
    } catch (error) {
        console.error("Error extracting proper nouns:", error);
        throw new Error("Failed to extract proper nouns from the script.");
    }
}

export async function regenerateNounVariations(noun: string, context: string, existingVariations: string[] = [], provider: LLMProvider = "gemini"): Promise<string[]> {
    if (provider === "gemini" && !apiKey) {
        throw new Error("Gemini API Key is missing.");
    }
    if (provider === "openai" && !openAiKey) {
        throw new Error("OpenAI API Key is missing.");
    }

    const prompt = `
    Generate 3 new and DIFFERENT phonetic variations for the proper noun "${noun}" found in this context: "${context}".
    
    IMPORTANT: 
    1. Do not suggest any of these existing variations: ${existingVariations.join(", ")}.
    2. Focus on phonetic respellings, syllable timing, and emphasis techniques.
    
    Return ONLY a valid JSON object with a single key "variations" containing an array of 3 unique strings:
    { "variations": ["var1", "var2", "var3"] }
    `;

    try {
        let text = "";

        if (provider === "openai") {
            const completion = await openai.chat.completions.create({
                messages: [{ role: "user", content: prompt }],
                model: "gpt-4o",
                response_format: { type: "json_object" },
            });
            text = completion.choices[0].message.content || "";
        } else {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            text = response.text().trim();
        }

        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            // Fallback for array
            const arrayMatch = text.match(/\[[\s\S]*\]/);
            if (arrayMatch) return JSON.parse(arrayMatch[0]);
            return [noun, noun, noun];
        }

        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.variations || [noun, noun, noun];
    } catch (error) {
        console.error("Error regenerating variations:", error);
        return [noun, noun, noun];
    }
}

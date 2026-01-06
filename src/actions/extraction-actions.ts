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
}

export async function extractProperNouns(script: string): Promise<ExtractedNoun[]> {
    if (!apiKey) {
        throw new Error("Gemini API Key is missing. Please check your .env.local file.");
    }

    const prompt = `
    Extract all proper nouns (Names of people, Places, Organizations, Universities, Acronyms like IIT, NIT, etc.) from the following text.
    For each extracted proper noun, provide the original word and the immediate sentence/context it appears in.
    
    Return the result as a strictly valid JSON array of objects with the following schema:
    [
      {
        "original": "Proper Noun",
        "context": "The sentence where the Proper Noun appears."
      }
    ]

    IMPORTANT: Return ONLY the JSON array. Do not include markdown formatting or extra text.

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

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error("Error extracting proper nouns:", error);
        throw new Error("Failed to extract proper nouns from the script.");
    }
}

"use server";

import fs from "fs/promises";
import path from "path";
import { ExtractedNoun } from "./extraction-actions";

const DATA_DIR = path.join(process.cwd(), "data", "audits");

export interface AuditSession {
    id: string;
    name: string;
    timestamp: string;
    originalScript: string;
    extractedNouns: any[]; // Using any to avoid complex circular dependencies for now
    finalScript?: string;
}

/**
 * Ensures the data directory exists
 */
async function ensureDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error("Error creating data directory:", error);
    }
}

/**
 * Saves an audit session to a JSON file
 */
export async function saveAuditSession(session: AuditSession): Promise<string> {
    await ensureDir();
    const filePath = path.join(DATA_DIR, `${session.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
    return session.id;
}

/**
 * Lists all previous audit sessions
 */
export async function listAuditSessions(): Promise<Omit<AuditSession, "originalScript" | "extractedNouns" | "finalScript">[]> {
    await ensureDir();
    try {
        const files = await fs.readdir(DATA_DIR);
        const sessions = await Promise.all(
            files
                .filter(f => f.endsWith(".json"))
                .map(async f => {
                    const content = await fs.readFile(path.join(DATA_DIR, f), "utf-8");
                    const data = JSON.parse(content) as AuditSession;
                    return {
                        id: data.id,
                        name: data.name,
                        timestamp: data.timestamp,
                    };
                })
        );
        // Sort by timestamp descending
        return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
        console.error("Error listing sessions:", error);
        return [];
    }
}

/**
 * Loads a specific audit session by ID
 */
export async function getAuditSession(id: string): Promise<AuditSession | null> {
    await ensureDir();
    try {
        const filePath = path.join(DATA_DIR, `${id}.json`);
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.parse(content) as AuditSession;
    } catch (error) {
        console.error(`Error loading session ${id}:`, error);
        return null;
    }
}

/**
 * Deletes an audit session
 */
export async function deleteAuditSession(id: string): Promise<boolean> {
    await ensureDir();
    try {
        const filePath = path.join(DATA_DIR, `${id}.json`);
        await fs.unlink(filePath);
        return true;
    } catch (error) {
        console.error(`Error deleting session ${id}:`, error);
        return false;
    }
}

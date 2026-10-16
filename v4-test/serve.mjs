// Local review page for the v4 pronunciation test.
//   node v4-test/serve.mjs   →   http://localhost:4310

import http from "http";
import fs from "fs";
import path from "path";
import { ROOT, OUTPUT_DIR, RESULTS_FILE, VARIANTS, loadScripts } from "./lib.mjs";

const PORT = Number(process.env.PORT) || 4310;

const readResults = () => (fs.existsSync(RESULTS_FILE) ? JSON.parse(fs.readFileSync(RESULTS_FILE, "utf-8")) : {});

function buildData() {
    const scripts = loadScripts().map(s => ({
        ...s,
        variants: Object.fromEntries(VARIANTS.map(v => {
            const metaFile = path.join(OUTPUT_DIR, s.id, `${v}.json`);
            const hasAudio = fs.existsSync(path.join(OUTPUT_DIR, s.id, `${v}.mp3`));
            const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf-8")) : null;
            return [v, { hasAudio, meta, mtime: hasAudio ? fs.statSync(path.join(OUTPUT_DIR, s.id, `${v}.mp3`)).mtimeMs : 0 }];
        })),
    }));
    return { scripts, results: readResults() };
}

const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

function buildCsv() {
    const { scripts, results } = buildData();
    const header = ["application_number", "name", "noun", "rewritten_form", "kind", "strategy",
        "raw_verdict", "rewritten_verdict", "raw_note", "rewritten_note", "raw_usable_as_is", "rewritten_usable_as_is"];
    const lines = [header.join(",")];
    for (const s of scripts) {
        const r = results[s.id] || {};
        for (const n of s.nouns) {
            lines.push([s.id, s.name, n.original, n.rewritten, n.kind, n.strategy,
                r.raw?.nouns?.[n.original], r.rewritten?.nouns?.[n.original],
                r.raw?.notes?.[n.original], r.rewritten?.notes?.[n.original],
                r.raw?.usable, r.rewritten?.usable].map(csvCell).join(","));
        }
    }
    return lines.join("\n");
}

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    try {
        if (req.method === "GET" && url.pathname === "/") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            return res.end(fs.readFileSync(path.join(ROOT, "review.html")));
        }
        if (req.method === "GET" && url.pathname === "/data") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify(buildData()));
        }
        const audio = url.pathname.match(/^\/audio\/([\w-]+)\/(raw|rewritten)\.mp3$/);
        if (req.method === "GET" && audio) {
            const file = path.join(OUTPUT_DIR, audio[1], `${audio[2]}.mp3`);
            if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
            res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
            return fs.createReadStream(file).pipe(res);
        }
        if (req.method === "POST" && url.pathname === "/results") {
            let body = "";
            for await (const chunk of req) body += chunk;
            fs.writeFileSync(RESULTS_FILE, JSON.stringify(JSON.parse(body), null, 2));
            res.writeHead(204);
            return res.end();
        }
        if (req.method === "GET" && url.pathname === "/results.csv") {
            res.writeHead(200, {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": 'attachment; filename="v4-pronunciation-results.csv"',
            });
            return res.end("﻿" + buildCsv());
        }
        res.writeHead(404);
        res.end("Not found");
    } catch (err) {
        console.error(err);
        res.writeHead(500);
        res.end(String(err));
    }
});

server.listen(PORT, () => console.log(`Review page: http://localhost:${PORT}`));

// Candidate grid review page.
//   node candidate-grid/serve.mjs   →   http://localhost:4311

import http from "http";
import fs from "fs";
import path from "path";
import { ROOT, OUTPUT_DIR, RESULTS_FILE, loadNouns } from "./lib.mjs";

const PORT = Number(process.env.PORT) || 4311;

const readResults = () => (fs.existsSync(RESULTS_FILE) ? JSON.parse(fs.readFileSync(RESULTS_FILE, "utf-8")) : {});

function buildData() {
    const { model, nouns } = loadNouns();
    return {
        model,
        results: readResults(),
        nouns: nouns.map(({ dir, ...n }) => ({
            ...n,
            candidates: n.candidates.map(c => {
                const meta = path.join(dir, `${c.id}.json`);
                const clip = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, "utf-8")) : null;
                return {
                    ...c,
                    audio: clip ? `/audio/${path.relative(OUTPUT_DIR, dir)}/${c.id}.mp3` : null,
                    span: clip?.span ?? null,
                };
            }),
        })),
    };
}

const csvCell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

function buildCsv() {
    const { nouns, results } = buildData();
    const lines = [["application_number", "student", "noun", "kind", "target", "candidate", "technique",
        "verdict", "is_best", "noun_note", "name_start_s", "name_end_s"].join(",")];
    for (const n of nouns) {
        const r = results[n.key] || {};
        for (const c of n.candidates) {
            lines.push([n.scriptId, n.studentName, n.original, n.kind, n.target, c.text, c.technique,
                r.marks?.[c.text], r.best === c.text ? "yes" : "", r.note,
                c.span?.start?.toFixed(3), c.span?.end?.toFixed(3)].map(csvCell).join(","));
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
        if (req.method === "GET" && url.pathname.startsWith("/audio/")) {
            const file = path.resolve(OUTPUT_DIR, decodeURIComponent(url.pathname.slice("/audio/".length)));
            if (!file.startsWith(OUTPUT_DIR + path.sep) || !file.endsWith(".mp3") || !fs.existsSync(file)) {
                res.writeHead(404);
                return res.end();
            }
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
                "Content-Disposition": 'attachment; filename="candidate-grid-results.csv"',
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

server.listen(PORT, () => console.log(`Candidate grid: http://localhost:${PORT}`));

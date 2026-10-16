"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { stitchAudioFiles, spliceAudio } from "@/lib/ffmpeg";
import { toast } from "sonner";
import { Music, Plus, Trash2, Loader2, Play, Download, Upload, FileAudio, Link as LinkIcon, Code, Scissors } from "lucide-react";

type AudioSourceType = "url" | "file" | "base64";

interface AudioSource {
    id: string;
    type: AudioSourceType;
    value: string | File;
}

export default function AudioStitcherTest() {
    const [sources, setSources] = useState<AudioSource[]>([
        { id: "1", type: "url", value: "" },
        { id: "2", type: "url", value: "" },
    ]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});

    // Splice State
    const [originalForSplice, setOriginalForSplice] = useState<File | null>(null);
    const [patchForSplice, setPatchForSplice] = useState<File | null>(null);
    const [spliceStart, setSpliceStart] = useState<string>("0");
    const [spliceEnd, setSpliceEnd] = useState<string>("0");
    const [spliceResultUrl, setSpliceResultUrl] = useState<string | null>(null);
    const [isSplicing, setIsSplicing] = useState(false);

    const addSource = (type: AudioSourceType = "url") => {
        setSources([...sources, { id: Math.random().toString(36).substr(2, 9), type, value: "" }]);
    };

    const removeSource = (id: string) => {
        setSources(sources.filter((s) => s.id !== id));
    };

    const updateSourceValue = (id: string, value: string | File) => {
        setSources(sources.map((s) => (s.id === id ? { ...s, value } : s)));
    };

    const switchType = (id: string, type: AudioSourceType) => {
        setSources(sources.map((s) => (s.id === id ? { ...s, type, value: "" } : s)));
    };

    const handleStitch = async () => {
        const validSources = sources.filter(s => {
            if (s.type === "file") return s.value instanceof File;
            return typeof s.value === "string" && s.value.trim() !== "";
        }).map(s => s.value);

        if (validSources.length < 2) {
            toast.error("Please provide at least 2 audio sources.");
            return;
        }

        setIsProcessing(true);
        try {
            const result = await stitchAudioFiles(validSources);
            setResultUrl(result);
            toast.success("Audio stitched successfully!");
        } catch (error) {
            console.error(error);
            toast.error("Failed to stitch audio files. Check console for details.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleSplice = async () => {
        if (!originalForSplice || !patchForSplice) {
            toast.error("Please provide both original and patch audio files.");
            return;
        }

        setIsSplicing(true);
        try {
            const start = parseFloat(spliceStart);
            const end = parseFloat(spliceEnd);

            if (isNaN(start) || isNaN(end)) {
                toast.error("Invalid start or end time.");
                return;
            }

            const result = await spliceAudio(originalForSplice, patchForSplice, start, end);
            setSpliceResultUrl(result);
            toast.success("Audio spliced successfully!");
        } catch (error) {
            console.error(error);
            toast.error("Failed to splice audio. Check console.");
        } finally {
            setIsSplicing(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 text-slate-50 p-8 pb-20">
            <div className="max-w-2xl mx-auto space-y-8">
                <header>
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <Music className="text-indigo-400" />
                        Audio Stitcher Test
                    </h1>
                    <p className="text-slate-400 italic">Supports URLs, Local Files, and Base64 (Generated) Data</p>
                </header>

                <div className="space-y-4">
                    {sources.map((source, index) => (
                        <Card key={source.id} className="bg-slate-900 border-slate-800 overflow-hidden">
                            <div className="flex bg-slate-950/50 border-b border-slate-800 p-1">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`flex-1 rounded-md text-[10px] uppercase font-bold tracking-wider h-8 ${source.type === "url" ? "bg-indigo-500/10 text-indigo-400" : "text-slate-500"}`}
                                    onClick={() => switchType(source.id, "url")}
                                >
                                    <LinkIcon className="w-3 h-3 mr-2" />
                                    URL
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`flex-1 rounded-md text-[10px] uppercase font-bold tracking-wider h-8 ${source.type === "file" ? "bg-indigo-500/10 text-indigo-400" : "text-slate-500"}`}
                                    onClick={() => switchType(source.id, "file")}
                                >
                                    <Upload className="w-3 h-3 mr-2" />
                                    File
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={`flex-1 rounded-md text-[10px] uppercase font-bold tracking-wider h-8 ${source.type === "base64" ? "bg-indigo-500/10 text-indigo-400" : "text-slate-500"}`}
                                    onClick={() => switchType(source.id, "base64")}
                                >
                                    <Code className="w-3 h-3 mr-2" />
                                    Base64
                                </Button>
                            </div>
                            <CardContent className="p-4 flex gap-3 items-center">
                                <div className="flex-1">
                                    {source.type === "url" && (
                                        <input
                                            type="text"
                                            placeholder="https://example.com/audio.mp3"
                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500"
                                            value={source.value as string}
                                            onChange={(e) => updateSourceValue(source.id, e.target.value)}
                                        />
                                    )}
                                    {source.type === "file" && (
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="border-slate-800 text-slate-400"
                                                onClick={() => fileInputRefs.current[source.id]?.click()}
                                            >
                                                <FileAudio className="w-4 h-4 mr-2" />
                                                {source.value instanceof File ? source.value.name : "Select File"}
                                            </Button>
                                            <input
                                                type="file"
                                                accept="audio/*"
                                                className="hidden"
                                                ref={(el) => { fileInputRefs.current[source.id] = el; }}
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) updateSourceValue(source.id, file);
                                                }}
                                            />
                                        </div>
                                    )}
                                    {source.type === "base64" && (
                                        <textarea
                                            placeholder="data:audio/mpeg;base64,..."
                                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono h-20 resize-none focus:ring-1 focus:ring-indigo-500"
                                            value={source.value as string}
                                            onChange={(e) => updateSourceValue(source.id, e.target.value)}
                                        />
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="text-slate-600 hover:text-red-400 self-start"
                                    onClick={() => removeSource(source.id)}
                                    disabled={sources.length <= 2}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </Button>
                            </CardContent>
                        </Card>
                    ))}

                    <Button
                        variant="outline"
                        className="w-full border-dashed border-slate-800 text-slate-500 hover:text-indigo-400 hover:border-indigo-500/50 h-12"
                        onClick={() => addSource("url")}
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Another Source
                    </Button>

                    <Button
                        className="w-full bg-indigo-600 hover:bg-indigo-700 h-14 text-lg font-bold shadow-xl shadow-indigo-500/20"
                        onClick={handleStitch}
                        disabled={isProcessing}
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                                Processing in Browser...
                            </>
                        ) : (
                            "Concat Audio Files"
                        )}
                    </Button>
                </div>

                {resultUrl && (
                    <Card className="bg-indigo-500/5 border-indigo-500/30 animate-in fade-in zoom-in-95 rounded-2xl overflow-hidden">
                        <CardHeader className="bg-indigo-500/10 py-3">
                            <CardTitle className="text-indigo-400 text-sm font-bold uppercase tracking-widest flex items-center gap-2">
                                <Play className="w-4 h-4 fill-current" />
                                Stitched Audio
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <audio src={resultUrl} controls className="w-full" />
                            <div className="flex justify-between items-center bg-slate-950 p-4 rounded-xl border border-slate-800">
                                <div className="text-xs text-slate-500 font-mono truncate mr-4">
                                    {resultUrl}
                                </div>
                                <Button asChild className="bg-indigo-600 hover:bg-indigo-700 shrink-0">
                                    <a href={resultUrl} download="stitched_result.mp3">
                                        <Download className="w-4 h-4 mr-2" />
                                        Download
                                    </a>
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>

            <div className="max-w-2xl mx-auto space-y-8 mt-20 border-t border-slate-800 pt-10">
                <header>
                    <h1 className="text-3xl font-bold flex items-center gap-3">
                        <Scissors className="text-pink-400" />
                        Audio Splice Test
                    </h1>
                    <p className="text-slate-400 italic">Test the 'spliceAudio' function logic directly.</p>
                </header>

                <Card className="bg-slate-900 border-slate-800">
                    <CardContent className="p-6 space-y-6">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500">Original Audio</label>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        className="w-full border-slate-800 text-slate-400"
                                        onClick={() => document.getElementById("splice-original")?.click()}
                                    >
                                        <FileAudio className="w-4 h-4 mr-2" />
                                        {originalForSplice ? originalForSplice.name : "Select Original"}
                                    </Button>
                                    <input
                                        id="splice-original"
                                        type="file"
                                        accept="audio/*"
                                        className="hidden"
                                        onChange={(e) => setOriginalForSplice(e.target.files?.[0] || null)}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500">Patch Audio</label>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        className="w-full border-slate-800 text-slate-400"
                                        onClick={() => document.getElementById("splice-patch")?.click()}
                                    >
                                        <FileAudio className="w-4 h-4 mr-2" />
                                        {patchForSplice ? patchForSplice.name : "Select Patch"}
                                    </Button>
                                    <input
                                        id="splice-patch"
                                        type="file"
                                        accept="audio/*"
                                        className="hidden"
                                        onChange={(e) => setPatchForSplice(e.target.files?.[0] || null)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500">Start Time (s)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2"
                                    value={spliceStart}
                                    onChange={(e) => setSpliceStart(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold uppercase text-slate-500">End Time (s)</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2"
                                    value={spliceEnd}
                                    onChange={(e) => setSpliceEnd(e.target.value)}
                                />
                            </div>
                        </div>

                        <Button
                            className="w-full bg-pink-600 hover:bg-pink-700 h-12 text-lg font-bold"
                            onClick={handleSplice}
                            disabled={isSplicing}
                        >
                            {isSplicing ? <Loader2 className="animate-spin" /> : "Splice Audio"}
                        </Button>
                    </CardContent>
                </Card>

                {spliceResultUrl && (
                    <Card className="bg-pink-500/5 border-pink-500/30">
                        <CardHeader className="bg-pink-500/10 py-3">
                            <CardTitle className="text-pink-400 text-sm font-bold uppercase">Result</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                            <audio src={spliceResultUrl} controls className="w-full" />
                            <div className="mt-4 text-center">
                                <a href={spliceResultUrl} download="spliced.mp3" className="text-pink-400 hover:underline text-sm">Download Spliced Audio</a>
                            </div>
                        </CardContent>
                    </Card>
                )}
            </div>
        </div>
    );
}

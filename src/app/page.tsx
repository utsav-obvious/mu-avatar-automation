"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractProperNouns, ExtractedNoun, regenerateNounVariations } from "@/actions/extraction-actions";
import { generateVariationAudio, WordAlignment, AudioResponse, TTSProvider } from "@/actions/audio-actions";
import { toast } from "sonner";
import { Loader2, Music, Search, CheckCircle2, RotateCcw, Play, Pause, Check, Download, Copy, FileText, FastForward, Rewind, History, Save, Trash2, Sparkles, Volume2, Hash, Percent, Edit2, ChevronDown } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import Link from "next/link";
import { useRef, useEffect } from "react";
import { saveAuditSession, listAuditSessions, getAuditSession, deleteAuditSession, AuditSession } from "@/actions/storage-actions";
import { spliceAudio } from "@/lib/ffmpeg";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface AuditState extends ExtractedNoun {
  selectedVariation?: string;
  customVariation?: string;
}

export default function AudioAuditDashboard() {
  const [script, setScript] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedNouns, setExtractedNouns] = useState<AuditState[]>([]);
  const [isRegenerating, setIsRegenerating] = useState<Record<number, boolean>>({});
  const [playingAudio, setPlayingAudio] = useState<{ index: number; vIndex: number | "manual" | "context" | "original" | "scratchpad" } | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [finalScript, setFinalScript] = useState<string | null>(null);
  const [isPlayingFinal, setIsPlayingFinal] = useState(false);
  const [isFinalLoading, setIsFinalLoading] = useState(false);
  const [audioCache, setAudioCache] = useState<Record<string, AudioResponse>>({});
  const [audioLoading, setAudioLoading] = useState<{ index: number; vIndex: number | "manual" | "context" | "original" | "scratchpad" } | null>(null);
  const [ttsProvider, setTtsProvider] = useState<TTSProvider>("elevenlabs");

  // Scratchpad State
  const [scratchpadText, setScratchpadText] = useState("");

  // Alignment State
  const [wordAlignments, setWordAlignments] = useState<WordAlignment[]>([]);
  const [currentWordIndex, setCurrentWordIndex] = useState<number | null>(null);

  // Storage State
  const [sessions, setSessions] = useState<{ id: string, name: string, timestamp: string }[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Advanced Audio Player State
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPatching, setIsPatching] = useState<number | null>(null);
  const [tempVariation, setTempVariation] = useState<string>("");
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);
  const [tempPhraseVariation, setTempPhraseVariation] = useState<string>("");
  const finalAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (finalAudioRef.current) {
      finalAudioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Load history list when sheet opens
  useEffect(() => {
    if (isHistoryOpen) {
      listAuditSessions().then(setSessions);
    }
  }, [isHistoryOpen]);

  const handleSaveSession = async () => {
    if (extractedNouns.length === 0) return;

    const id = currentSessionId || `audit-${Date.now()}`;
    const name = extractedNouns.slice(0, 3).map(n => n.original).join(", ") + (extractedNouns.length > 3 ? "..." : "");

    const session: AuditSession = {
      id,
      name: name || "Untitled Audit",
      timestamp: new Date().toISOString(),
      originalScript: script,
      extractedNouns,
      finalScript: finalScript || undefined
    };

    try {
      await saveAuditSession(session);
      setCurrentSessionId(id);
      toast.success("Audit session saved to local JSON.");
    } catch (_error) {
      toast.error("Failed to save session.");
    }
  };

  const handleLoadSession = async (id: string) => {
    try {
      const session = await getAuditSession(id);
      if (session) {
        setScript(session.originalScript);
        setExtractedNouns(session.extractedNouns);
        setFinalScript(session.finalScript || null);
        setCurrentSessionId(session.id);
        setIsHistoryOpen(false);
        toast.success(`Loaded session: ${session.name}`);
      }
    } catch (error) {
      toast.error("Failed to load session.");
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteAuditSession(id);
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) setCurrentSessionId(null);
      toast.success("Session deleted.");
    } catch (error) {
      toast.error("Failed to delete session.");
    }
  };

  const generateAuditedScript = () => {
    let audited = script;
    // Sort by length descending to avoid partial replacements
    const sortedNouns = [...extractedNouns].sort((a, b) => b.original.length - a.original.length);

    sortedNouns.forEach(noun => {
      // Use selected variation if available, otherwise original
      const replacement = noun.selectedVariation || noun.original;

      // Escape special characters
      const escapedNoun = noun.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // If it's English/Alphanumeric, use word boundaries. 
      // If it has non-Latin characters (like Hindi), skip \b as it doesn't work correctly.
      const isAlphanumeric = /^[a-z0-9\s]+$/i.test(noun.original);
      const regex = new RegExp(isAlphanumeric ? `\\b${escapedNoun}\\b` : escapedNoun, "giu");

      audited = audited.replace(regex, replacement);
    });

    // Space before commas and periods can be applied manually via "Space Punctuation" button

    // Automate paragraph splitting (every 2 sentences)
    const sentences = audited.split(/(?<=[.!?])\s+/);
    if (sentences.length > 0) {
      const paragraphs = [];
      for (let i = 0; i < sentences.length; i += 2) {
        paragraphs.push(sentences.slice(i, i + 2).join(" "));
      }
      audited = paragraphs.join("\n\n");
    }

    setFinalScript(audited);
    toast.success("Final script prepared with automatic paragraphs!");
  };

  const stopAudio = () => {
    if (audioElement) {
      audioElement.pause();
      setAudioElement(null);
    }
    if (finalAudioRef.current) {
      finalAudioRef.current.pause();
      setIsPlayingFinal(false);
    }
    setPlayingAudio(null);
  };

  const normalizeForMatch = (text: string) => {
    return text.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
  };

  const handlePlayFinalAudio = async () => {
    if (!finalScript) return;

    if (isPlayingFinal && finalAudioRef.current) {
      finalAudioRef.current.pause();
      setIsPlayingFinal(false);
      return;
    }

    try {
      let cached = audioCache[finalScript];

      // If we don't have the audio for this specific script, or the current Audio object has a different src
      if (!cached || (finalAudioRef.current && finalAudioRef.current.src !== cached.audioData)) {
        if (finalAudioRef.current) {
          finalAudioRef.current.pause();
          finalAudioRef.current = null;
        }

        setIsFinalLoading(true);
        setIsPlayingFinal(true);

        if (!cached) {
          cached = await generateVariationAudio(finalScript, ttsProvider);
          setAudioCache(prev => ({ ...prev, [finalScript!]: cached }));
        }

        setWordAlignments(cached.alignments || []);
        setIsFinalLoading(false);

        const audio = new Audio(cached.audioData);
        audio.playbackRate = playbackRate;

        audio.ontimeupdate = () => {
          setCurrentTime(audio.currentTime);
          // Find the current word index based on time
          if (cached!.alignments) {
            const index = cached!.alignments.findIndex(a => audio.currentTime >= a.start && audio.currentTime <= a.end);
            setCurrentWordIndex(index !== -1 ? index : null);
          }
        };
        audio.onloadedmetadata = () => setDuration(audio.duration);
        audio.onended = () => {
          setIsPlayingFinal(false);
          setCurrentTime(0);
          setCurrentWordIndex(null);
        };

        finalAudioRef.current = audio;
        audio.play();
      } else if (finalAudioRef.current) {
        // Resume existing audio if it matches the current script
        finalAudioRef.current.play();
        setIsPlayingFinal(true);
      }
    } catch (_error) {
      toast.error("Failed to generate final audio. Script might be too long.");
      setIsPlayingFinal(false);
      setIsFinalLoading(false);
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const handleDownloadAudio = () => {
    if (finalAudioRef.current && finalAudioRef.current.src) {
      const link = document.createElement("a");
      link.href = finalAudioRef.current.src;
      link.download = `audited-script-${currentSessionId || Date.now()}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success("Downloading audio...");
    } else {
      toast.error("Please generate the audio first.");
    }
  };

  const handleDownloadVariant = (text: string, filename: string) => {
    const cached = audioCache[text];
    if (cached) {
      const link = document.createElement("a");
      link.href = cached.audioData;
      link.download = `${filename}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Downloading ${filename}...`);
    }
  };

  const copyToClipboard = () => {
    if (finalScript) {
      navigator.clipboard.writeText(finalScript);
      toast.success("Copied to clipboard!");
    }
  };

  const skip10 = (forward: boolean) => {
    if (finalAudioRef.current) {
      const newTime = finalAudioRef.current.currentTime + (forward ? 10 : -10);
      finalAudioRef.current.currentTime = Math.max(0, Math.min(newTime, duration));
      setCurrentTime(finalAudioRef.current.currentTime);
    }
  };

  const getAudioDuration = (src: string): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio(src);
      const timer = setTimeout(() => resolve(0), 5000);
      audio.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve(audio.duration);
      };
      audio.onerror = () => {
        clearTimeout(timer);
        resolve(0);
      };
    });
  };

  const handleTryVariation = async (text: string) => {
    if (!text.trim()) return;
    try {
      let cached = audioCache[text];
      if (!cached) {
        cached = await generateVariationAudio(text, ttsProvider);
        setAudioCache(prev => ({ ...prev, [text]: cached }));
      }
      const audio = new Audio(cached.audioData);
      audio.play();
    } catch (error) {
      console.error(error);
      toast.error("Failed to generate preview audio.");
    }
  };

  const handlePatchWord = async (idx: number, customPatchText?: string) => {
    const alignment = wordAlignments[idx];
    if (!alignment || !finalAudioRef.current?.src) return;

    let patchText = "";

    if (customPatchText) {
      patchText = customPatchText;
    } else {
      const normTarget = normalizeForMatch(alignment.word);
      const noun = extractedNouns.find(n =>
        normalizeForMatch(n.original) === normTarget ||
        (n.selectedVariation && normalizeForMatch(n.selectedVariation) === normTarget) ||
        (n.customVariation && normalizeForMatch(n.customVariation) === normTarget)
      );

      if (!noun) {
        toast.error("No auditor data found for this word.");
        return;
      }
      patchText = noun.selectedVariation || noun.customVariation || noun.original;
    }

    const patchAudioRes = audioCache[patchText];

    if (!patchAudioRes) {
      toast.info(`Generating audio for "${patchText}"...`);
      try {
        const res = await generateVariationAudio(patchText, ttsProvider);
        setAudioCache(prev => ({ ...prev, [patchText]: res }));
        // Continue with the newly generated audio
        await executePatch(idx, patchText, res.audioData);
      } catch (error) {
        toast.error(`Failed to generate audio for "${patchText}".`);
      }
      return;
    }

    await executePatch(idx, patchText, patchAudioRes.audioData);
  };

  const executePatch = async (idx: number, patchText: string, patchData: string) => {
    const alignment = wordAlignments[idx];
    if (!alignment) return;

    setIsPatching(idx);
    try {
      console.log(`Starting patch for "${alignment.word}" at idx ${idx} with text "${patchText}"`);
      const originalAudioSrc = finalAudioRef.current!.src;

      const patchDuration = await getAudioDuration(patchData);
      const originalDuration = alignment.end - alignment.start;
      const diff = patchDuration - originalDuration;

      console.log(`Durations - Patch: ${patchDuration.toFixed(3)}s, Original: ${originalDuration.toFixed(3)}s, Diff: ${diff.toFixed(3)}s`);

      const patchedUrl = await spliceAudio(
        originalAudioSrc,
        patchData,
        alignment.start,
        alignment.end
      );

      const wasPlaying = isPlayingFinal;
      finalAudioRef.current!.src = patchedUrl;
      finalAudioRef.current!.load(); // Force browser to refresh buffer

      // CRITICAL: Update the cache so subsequent plays/downloads use the patched version
      if (finalScript) {
        setAudioCache(prev => ({
          ...prev,
          [finalScript]: {
            audioData: patchedUrl,
            provider: ttsProvider
          }
        }));
      }

      if (wasPlaying) {
        finalAudioRef.current!.play();
      }

      const updatedAlignments = wordAlignments.map((a, i) => {
        if (i < idx) return a;
        if (i === idx) return { ...a, end: a.start + patchDuration };
        return { ...a, start: a.start + diff, end: a.end + diff };
      });

      setWordAlignments(updatedAlignments);
      setDuration(prev => prev + diff);
      toast.success(`Successfully patched with "${patchText}"!`);
    } catch (error) {
      console.error("Patching failed:", error);
      toast.error("Failed to patch audio.");
    } finally {
      setIsPatching(null);
    }
  };

  const handlePatchPhrase = async () => {
    if (selectionStart === null || selectionEnd === null || !finalAudioRef.current?.src) return;

    const startIdx = Math.min(selectionStart, selectionEnd);
    const endIdx = Math.max(selectionStart, selectionEnd);

    const phraseWords = wordAlignments.slice(startIdx, endIdx + 1);
    const phraseText = tempPhraseVariation.trim() || phraseWords.map(a => a.word).join(" ");

    setIsPatching(-1); // Use -1 to indicate phrase patching
    toast.info(`Regenerating phrase: "${phraseText}"...`);

    try {
      let audioData: string;
      let patchDuration: number;

      // Check cache first for reuse (important for the pronoun dropdown feature)
      if (audioCache[phraseText]) {
        audioData = audioCache[phraseText].audioData;
        patchDuration = await getAudioDuration(audioData);
        toast.info("Using pre-auditioned audio variation...");
      } else {
        const res = await generateVariationAudio(phraseText, ttsProvider);
        audioData = res.audioData;
        patchDuration = await getAudioDuration(audioData);
      }

      const startTime = phraseWords[0].start;
      const endTime = phraseWords[phraseWords.length - 1].end;
      const originalDuration = endTime - startTime;
      const diff = patchDuration - originalDuration;

      const patchedUrl = await spliceAudio(
        finalAudioRef.current.src,
        audioData,
        startTime,
        endTime
      );

      const wasPlaying = isPlayingFinal;
      finalAudioRef.current.src = patchedUrl;
      finalAudioRef.current.load();

      if (finalScript) {
        setAudioCache(prev => ({
          ...prev,
          [finalScript]: {
            audioData: patchedUrl,
            provider: ttsProvider
          }
        }));
      }

      if (wasPlaying) finalAudioRef.current.play();

      // Merge alignments
      const newPhraseAlignment: WordAlignment = {
        word: phraseText,
        start: startTime,
        end: startTime + patchDuration
      };

      const updatedAlignments = [
        ...wordAlignments.slice(0, startIdx),
        newPhraseAlignment,
        ...wordAlignments.slice(endIdx + 1).map(a => ({
          ...a,
          start: a.start + diff,
          end: a.end + diff
        }))
      ];

      setWordAlignments(updatedAlignments);
      setDuration(prev => prev + diff);
      setSelectionStart(null);
      setSelectionEnd(null);
      setTempPhraseVariation("");
      toast.success("Phrase patched successfully!");
    } catch (error) {
      console.error(error);
      toast.error("Failed to patch phrase.");
    } finally {
      setIsPatching(null);
    }
  };

  const handleAnalyze = async () => {
    if (!script.trim()) {
      toast.error("Please enter a script first.");
      return;
    }

    setIsAnalyzing(true);
    try {
      const nouns = await extractProperNouns(script);
      setExtractedNouns(nouns);
      toast.success(`Successfully extracted ${nouns.length} proper nouns.`);
    } catch (error) {
      console.error(error);
      toast.error("Failed to analyze script.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleRegenerate = async (index: number) => {
    const noun = extractedNouns[index];
    setIsRegenerating(prev => ({ ...prev, [index]: true }));

    try {
      const newVariations = await regenerateNounVariations(noun.original, noun.context, noun.variations);
      const updatedNouns = [...extractedNouns];
      updatedNouns[index] = { ...noun, variations: [...noun.variations, ...newVariations] };
      setExtractedNouns(updatedNouns);
      toast.success("Added 3 new variations.");
    } catch (error) {
      toast.error("Failed to generate more variations.");
    } finally {
      setIsRegenerating(prev => ({ ...prev, [index]: false }));
    }
  };


  const handlePlay = async (text: string, index: number, vIndex: number | "manual" | "context" | "original" | "scratchpad") => {
    if (playingAudio?.index === index && playingAudio?.vIndex === vIndex) {
      stopAudio();
      return;
    }

    stopAudio();
    setPlayingAudio({ index, vIndex });

    try {
      let cached = audioCache[text];

      if (!cached) {
        setAudioLoading({ index, vIndex });
        cached = await generateVariationAudio(text, ttsProvider);
        setAudioCache(prev => ({ ...prev, [text]: cached }));
      }

      setAudioLoading(null);

      const audio = new Audio(cached.audioData);
      setAudioElement(audio);
      audio.play();
      audio.onended = () => {
        setPlayingAudio(null);
        setAudioElement(null);
      };
    } catch (_error) {
      toast.error("Failed to play audio.");
      setPlayingAudio(null);
      setAudioLoading(null);
    }
  };

  const handleSelect = (index: number, variation?: string) => {
    const updatedNouns = [...extractedNouns];
    const currentSelection = updatedNouns[index].selectedVariation;

    // Toggle: if clicking the same one, de-select it (which reverts to default)
    // If variation is undefined, it means we are explicitly selecting "Default"
    if (variation === undefined || currentSelection === variation) {
      updatedNouns[index] = { ...updatedNouns[index], selectedVariation: undefined };
      toast.info(`Reverted ${updatedNouns[index].original} to default`);
    } else {
      updatedNouns[index] = { ...updatedNouns[index], selectedVariation: variation };
      toast.success(`Selected "${variation}" for ${updatedNouns[index].original}`);
    }

    setExtractedNouns(updatedNouns);
    setFinalScript(null); // Force re-generate to see changes
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-8 font-sans">
      <header className="max-w-5xl mx-auto mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Music className="w-8 h-8 text-indigo-400" />
            Obvious Studios
          </h1>
          <p className="text-slate-400">Pronunciation Auditing Tool for {ttsProvider === "elevenlabs" ? "ElevenLabs" : "MiniMax"}</p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/scrub">
            <Button variant="outline" className="border-indigo-500/30 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-2 rounded-xl h-10">
              <Volume2 className="w-4 h-4" />
              Scrub Utility
            </Button>
          </Link>

          <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-800">
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 px-3 rounded-lg text-xs font-bold transition-all ${ttsProvider === "elevenlabs" ? "bg-indigo-500/20 text-indigo-400" : "text-slate-500 hover:text-slate-300"}`}
              onClick={() => {
                setTtsProvider("elevenlabs");
                setAudioCache({}); // Clear cache when switching providers to avoid using wrong audio
              }}
            >
              ElevenLabs
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 px-3 rounded-lg text-xs font-bold transition-all ${ttsProvider === "minimax" ? "bg-indigo-500/20 text-indigo-400" : "text-slate-500 hover:text-slate-300"}`}
              onClick={() => {
                setTtsProvider("minimax");
                setAudioCache({}); // Clear cache when switching providers
              }}
            >
              MiniMax
            </Button>
          </div>
          <Sheet open={isHistoryOpen} onOpenChange={setIsHistoryOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" className="border-slate-800 text-slate-400 hover:text-white gap-2 rounded-xl h-10">
                <History className="w-4 h-4" />
                History
              </Button>
            </SheetTrigger>
            <SheetContent className="bg-slate-950 border-slate-800 text-slate-100 w-[400px] sm:w-[540px]">
              <SheetHeader className="mb-8">
                <SheetTitle className="text-2xl text-white flex items-center gap-2">
                  <History className="w-6 h-6 text-indigo-400" />
                  Audit History
                </SheetTitle>
                <SheetDescription className="text-slate-500">
                  Reload previously audited scripts and variations.
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 overflow-y-auto max-h-[80vh] pr-2 custom-scrollbar">
                {sessions.length === 0 ? (
                  <div className="text-center py-20 text-slate-700">
                    <Search className="w-12 h-12 mx-auto mb-4 opacity-10" />
                    <p>No saved audits yet.</p>
                  </div>
                ) : (
                  sessions.map(s => (
                    <div
                      key={s.id}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer group ${currentSessionId === s.id ? "bg-indigo-500/10 border-indigo-500/50" : "bg-slate-900/50 border-slate-800 hover:border-slate-700"}`}
                      onClick={() => handleLoadSession(s.id)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <h3 className="font-bold text-slate-200 line-clamp-1 group-hover:text-indigo-400 transition-colors">{s.name}</h3>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-600 hover:text-red-400"
                          onClick={(e) => handleDeleteSession(e, s.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between text-[10px] text-slate-500 uppercase tracking-widest font-bold">
                        <span>{new Date(s.timestamp).toLocaleDateString()}</span>
                        {currentSessionId === s.id && <span className="text-indigo-400">Current</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </SheetContent>
          </Sheet>

          <Button
            variant="outline"
            disabled={extractedNouns.length === 0}
            className="border-slate-800 text-slate-400 hover:text-white gap-2 rounded-xl h-10"
            onClick={handleSaveSession}
          >
            <Save className="w-4 h-4" />
            Save Session
          </Button>

          <Button
            variant="outline"
            className="border-slate-800 text-red-500/70 hover:text-red-400 hover:bg-red-500/10 gap-2 rounded-xl h-10"
            onClick={() => {
              if (confirm("Reset current audit? Unsaved changes will be lost.")) {
                setScript("");
                setExtractedNouns([]);
                setFinalScript(null);
                setCurrentSessionId(null);
                stopAudio();
              }
            }}
          >
            <RotateCcw className="w-4 h-4" />
            Reset
          </Button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto space-y-8 pb-32">
        {/* Script Input Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold border border-indigo-500/20">1</div>
              <h2 className="text-xl font-semibold">Script Input</h2>
            </div>
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !script.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white transition-all px-6 py-6 h-auto text-lg rounded-xl shadow-lg shadow-indigo-500/20"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Analyzing Script...
                </>
              ) : (
                <>
                  <Search className="mr-2 h-5 w-5" />
                  Extract Proper Nouns
                </>
              )}
            </Button>
          </div>
          <Textarea
            placeholder="Paste your script here... (e.g., Ramesh from Bangalore will join the call at IIT Madras.)"
            className="min-h-[200px] bg-slate-900 border-slate-800 text-lg resize-none focus-visible:ring-indigo-500 transition-all rounded-xl p-6 shadow-inner"
            value={script}
            onChange={(e) => setScript(e.target.value)}
          />
        </section>

        {/* Extracted Nouns Section */}
        {extractedNouns.length > 0 ? (
          <section className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold border border-indigo-500/20">2</div>
              <h2 className="text-xl font-semibold">Audit Proper Nouns ({extractedNouns.length})</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {extractedNouns.map((noun, index) => (
                <Card key={index} className="bg-slate-900 border-slate-800 hover:border-indigo-500/50 transition-all shadow-xl group rounded-2xl overflow-hidden">
                  <CardHeader className="pb-2 bg-slate-900/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div
                          className={`flex items-center gap-3 px-3 py-1.5 rounded-xl border transition-all cursor-pointer ${!noun.selectedVariation
                            ? "bg-indigo-500/20 border-indigo-500/50"
                            : "bg-slate-950/50 border-slate-800 hover:border-slate-700"
                            }`}
                          onClick={() => handleSelect(index, undefined)}
                        >
                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${!noun.selectedVariation
                            ? "bg-indigo-500 border-indigo-500 text-white"
                            : "border-slate-700 text-transparent"
                            }`}>
                            <Check className="w-3 h-3" />
                          </div>
                          <CardTitle className="text-2xl font-bold tracking-tight text-white transition-colors flex items-center gap-2">
                            {noun.original}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-slate-500 hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(noun.original);
                                toast.success("Copied original text!");
                              }}
                            >
                              <Copy className="w-3 h-3" />
                            </Button>
                          </CardTitle>
                        </div>

                        {!noun.selectedVariation && (
                          <span className="text-[10px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest font-bold">
                            Default
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-indigo-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            handlePlay(noun.original, index, "original");
                          }}
                          disabled={audioLoading?.index === index && audioLoading?.vIndex === "original"}
                        >
                          {audioLoading?.index === index && audioLoading?.vIndex === "original" ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : playingAudio?.index === index && playingAudio?.vIndex === "original" ? (
                            <Pause className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current" />
                          )}
                        </Button>
                        {audioCache[noun.original] && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-indigo-400"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadVariant(noun.original, noun.original);
                            }}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        )}
                        <CheckCircle2 className={`w-6 h-6 transition-colors ${!noun.selectedVariation ? "text-indigo-500" : "text-slate-700"}`} />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-6">
                    <p className="text-sm text-slate-400 leading-relaxed italic border-l-2 border-indigo-500/30 pl-4 py-1">
                      &quot;{noun.context}&quot;
                    </p>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                          <Music className="w-3 h-3" />
                          Phonetic Variations (AI)
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[10px] text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                          onClick={() => handleRegenerate(index)}
                          disabled={isRegenerating[index]}
                        >
                          {isRegenerating[index] ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                          Next 3
                        </Button>
                      </div>
                      <div className="flex flex-col gap-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                        {noun.variations.map((variant, vIndex) => (
                          <div
                            key={vIndex}
                            className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer group/item ${noun.selectedVariation === variant
                              ? "bg-indigo-500/20 border-indigo-500/50"
                              : "bg-slate-950/50 border-slate-800 hover:border-slate-700"
                              }`}
                            onClick={() => handleSelect(index, variant)}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${noun.selectedVariation === variant
                                ? "bg-indigo-500 border-indigo-500 text-white"
                                : "border-slate-700 text-transparent group-hover/item:border-slate-500"
                                }`}>
                                <Check className="w-3 h-3" />
                              </div>
                              <span className={`text-sm font-medium flex items-center gap-2 ${noun.selectedVariation === variant ? "text-white" : "text-slate-300"}`}>
                                {variant}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-slate-500 hover:text-indigo-400 opacity-0 group-hover/item:opacity-100 transition-opacity"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(variant);
                                    toast.success("Copied variation!");
                                  }}
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-slate-500 hover:text-indigo-400"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePlay(variant, index, vIndex);
                                }}
                                disabled={audioLoading?.index === index && audioLoading?.vIndex === vIndex}
                              >
                                {audioLoading?.index === index && audioLoading?.vIndex === vIndex ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : playingAudio?.index === index && playingAudio?.vIndex === vIndex ? (
                                  <Pause className="w-4 h-4 fill-current" />
                                ) : (
                                  <Play className="w-4 h-4 fill-current" />
                                )}
                              </Button>
                              {audioCache[variant] && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-slate-500 hover:text-indigo-400"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDownloadVariant(variant, variant.replace(/\s+/g, "_"));
                                  }}
                                >
                                  <Download className="w-4 h-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* Play in Context Button */}
                      {noun.selectedVariation && (
                        <div className="space-y-4 pt-4 border-t border-slate-800/50">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-2">
                              <Search className="w-3 h-3" />
                              Context Debug Toolbar
                            </label>
                            <span className="text-[10px] text-slate-500 italic">Fine-tune prosody</span>
                          </div>

                          <div className="grid grid-cols-3 gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              className={`h-8 text-[10px] border-slate-800 gap-1.5 transition-all ${noun.selectedVariation.includes("...") ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300" : "text-slate-500 hover:text-slate-300"}`}
                              onClick={() => {
                                const variant = noun.selectedVariation!;
                                const updated = variant.includes("...") ? variant.replace(/\.\.\./g, "") : `... ${variant} ...`;
                                handleSelect(index, updated);
                              }}
                            >
                              Pause (...)
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className={`h-8 text-[10px] border-slate-800 gap-1.5 transition-all ${noun.selectedVariation.includes(" — ") ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300" : "text-slate-500 hover:text-slate-300"}`}
                              onClick={() => {
                                const variant = noun.selectedVariation!;
                                const updated = variant.includes(" — ") ? variant.replace(/ — /g, "") : ` — ${variant} — `;
                                handleSelect(index, updated);
                              }}
                            >
                              Stress ( — )
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className={`h-8 text-[10px] border-slate-800 gap-1.5 transition-all ${noun.selectedVariation === noun.selectedVariation?.toUpperCase() ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-300" : "text-slate-500 hover:text-slate-300"}`}
                              onClick={() => {
                                const variant = noun.selectedVariation!;
                                const updated = variant === variant.toUpperCase() ? variant.toLowerCase() : variant.toUpperCase();
                                handleSelect(index, updated);
                              }}
                            >
                              Force CAPS
                            </Button>
                          </div>

                          <Button
                            variant="outline"
                            size="sm"
                            className={`w-full h-10 border-indigo-500/20 gap-2 bg-slate-900 shadow-lg shadow-indigo-500/5 group transition-all ${playingAudio?.index === index && playingAudio?.vIndex === "context" ? "text-white border-indigo-500 bg-indigo-500/10" : "text-indigo-300 hover:text-white hover:bg-indigo-500/10"}`}
                            onClick={() => {
                              if (playingAudio?.index === index && playingAudio?.vIndex === "context") {
                                stopAudio();
                                return;
                              }
                              // Use the sentence context instead of the whole script to save tokens
                              const escapedNoun = noun.original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                              const isAlphanumeric = /^[a-z0-9\s]+$/i.test(noun.original);
                              const regex = new RegExp(isAlphanumeric ? `\\b${escapedNoun}\\b` : escapedNoun, "giu");
                              const contextText = noun.context.replace(regex, noun.selectedVariation!);
                              handlePlay(contextText, index, "context");
                            }}
                            disabled={audioLoading?.index === index && audioLoading?.vIndex === "context"}
                          >
                            {audioLoading?.index === index && audioLoading?.vIndex === "context" ? (
                              <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            ) : playingAudio?.index === index && playingAudio?.vIndex === "context" ? (
                              <Pause className="w-4 h-4 fill-current animate-pulse mr-2" />
                            ) : (
                              <Music className="w-4 h-4 group-hover:scale-110 transition-transform mr-2" />
                            )}
                            {audioLoading?.index === index && audioLoading?.vIndex === "context" ? "Loading..." : playingAudio?.index === index && playingAudio?.vIndex === "context" ? "Playing Context..." : "Listen in Context"}
                          </Button>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                        <Search className="w-3 h-3" />
                        Manual Override
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Type custom respelling..."
                          className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                          value={noun.customVariation || ""}
                          onChange={(e) => {
                            const updatedNouns = [...extractedNouns];
                            updatedNouns[index] = { ...updatedNouns[index], customVariation: e.target.value };
                            setExtractedNouns(updatedNouns);
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          className="border-slate-800 hover:bg-slate-800 h-9"
                          onClick={() => noun.customVariation && handleSelect(index, noun.customVariation)}
                          disabled={!noun.customVariation}
                        >
                          Select
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-slate-500 hover:text-indigo-400 border border-slate-800"
                          onClick={() => noun.customVariation && handlePlay(noun.customVariation, index, "manual")}
                          disabled={!noun.customVariation || (audioLoading?.index === index && audioLoading?.vIndex === "manual")}
                        >
                          {audioLoading?.index === index && audioLoading?.vIndex === "manual" ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : playingAudio?.index === index && playingAudio?.vIndex === "manual" ? (
                            <Pause className="w-4 h-4 fill-current" />
                          ) : (
                            <Play className="w-4 h-4 fill-current" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-800/50 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-slate-600">
                      <span>Milestone 3: Generation Active</span>
                      <CheckCircle2 className="w-4 h-4 text-slate-800" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Export Section */}
            <section className="pt-12 space-y-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-400 font-bold border border-indigo-500/20">3</div>
                <h2 className="text-xl font-semibold">Review & Export</h2>
              </div>

              {!finalScript ? (
                <Card className="bg-slate-900 border-indigo-500/10 p-12 text-center border-dashed border-2 rounded-3xl">
                  <FileText className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                  <p className="text-slate-500 mb-6">Audited nouns will be replaced. Others will use original text.</p>
                  <Button
                    onClick={generateAuditedScript}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8"
                  >
                    Generate Final Script
                  </Button>
                </Card>
              ) : (
                <Card className="bg-slate-900 border-indigo-500/30 rounded-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
                  <div className="bg-indigo-500/5 px-6 py-4 border-b border-indigo-500/10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-indigo-400" />
                      <span className="text-xs font-bold uppercase tracking-widest text-indigo-400">Final Audited Script</span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                        onClick={() => {
                          if (!finalScript) return;
                          const updated = finalScript.replace(/(\d+)\.(\d+)/g, (match, p1, p2) => {
                            const digits = p2.split("").join(" ");
                            return `${p1} point ${digits}`;
                          });
                          setFinalScript(updated);
                          toast.success("Numbers formatted!");
                        }}
                      >
                        <Hash className="w-3.5 h-3.5" />
                        Format Numbers
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                        onClick={() => {
                          if (!finalScript) return;
                          const updated = finalScript.replace(/%/g, " percentage");
                          setFinalScript(updated);
                          toast.success("Percentages formatted!");
                        }}
                      >
                        <Percent className="w-3.5 h-3.5" />
                        Format %
                      </Button>
                      {/* <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                        onClick={() => {
                          if (!finalScript) return;
                          const updated = finalScript.replace(/\bCGPA[,.]/g, "CGPA");
                          setFinalScript(updated);
                          toast.success("CGPA cleaned!");
                        }}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Clean CGPA
                      </Button> */}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                        onClick={() => {
                          if (!finalScript) return;
                          const updated = finalScript.replace(/\bTetr\b/g, "Tet-er");
                          setFinalScript(updated);
                          toast.success("Tetr fixed!");
                        }}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                        Fix Tetr
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                        onClick={() => {
                          if (!finalScript) return;
                          // Adds ... after sentence-ending punctuation if followed by space, avoiding double adds
                          const updated = finalScript.replace(/(?<=[.!?])\s+(?!\.\.\.)/g, " ... ");
                          setFinalScript(updated);
                          toast.success("Humanized pauses added!");
                        }}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        Humanize
                      </Button>
                      {/* <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                        onClick={() => {
                          if (!finalScript) return;
                          const updated = finalScript.replace(/(?<!\s)([,.]+)(?!\d)/g, " $1");
                          setFinalScript(updated);
                          toast.success("Punctuation spaced!");
                        }}
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                        Space Punctuation
                      </Button> */}
                      {/* <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                        onClick={() => {
                          if (!finalScript) return;

                          // Split into sentences (simple logic based on punctuation)
                          // This approach splits only when punctuation is followed by space, correctly ignoring decimal points
                          const sentences = finalScript.split(/(?<=[.!?])\s+/);

                          if (sentences.length > 0) {
                            const lastIdx = sentences.length - 1;
                            const lastSentence = sentences[lastIdx].trim();

                            // Transform last sentence: strip existing emotional cues first if any
                            const clean = lastSentence.replace(/[—!]/g, "").trim().toUpperCase();
                            sentences[lastIdx] = ` — ${clean} !!`;

                            const updated = sentences.join(" ").trim();
                            setFinalScript(updated);
                            toast.success("Excited ending applied!");
                          }
                        }}
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Excite Ending
                      </Button> */}
                      {/* <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5"
                        onClick={() => {
                          if (!finalScript) return;

                          // Split into sentences (simple logic based on punctuation)
                          // This approach splits only when punctuation is followed by space, correctly ignoring decimal points
                          const sentences = finalScript.split(/(?<=[.!?])\s+/);

                          if (sentences.length > 0) {
                            const paragraphs = [];
                            for (let i = 0; i < sentences.length; i += 2) {
                              paragraphs.push(sentences.slice(i, i + 2).join(" "));
                            }
                            const updated = paragraphs.join("\n\n");
                            setFinalScript(updated);
                            toast.success("Split into paragraphs!");
                          }
                        }}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Split Paragraphs
                      </Button> */}
                      <Button variant="ghost" size="sm" className="h-8 text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10 gap-1.5" onClick={generateAuditedScript}>
                        <RotateCcw className="w-3.5 h-3.5" />
                        Regenerate
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 text-slate-400 hover:text-white" onClick={copyToClipboard}>
                        <Copy className="w-3.5 h-3.5 mr-2" />
                        Copy text
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 text-slate-400 hover:text-white" onClick={() => {
                        setFinalScript(null);
                        setIsPlayingFinal(false);
                        stopAudio();
                      }}>
                        Reset
                      </Button>
                    </div>
                  </div>
                  <div className="p-8 space-y-8">
                    <Textarea
                      className="min-h-[200px] bg-slate-950 border-slate-800 text-lg leading-relaxed text-slate-300 focus-visible:ring-indigo-500 transition-all rounded-2xl p-6 font-serif resize-none"
                      value={finalScript}
                      onChange={(e) => setFinalScript(e.target.value)}
                    />

                    <Button
                      onClick={handlePlayFinalAudio}
                      disabled={isFinalLoading}
                      className="w-full h-14 bg-indigo-600 hover:bg-indigo-700 text-white transition-all rounded-xl shadow-lg shadow-indigo-500/20 text-lg font-semibold gap-3"
                    >
                      {isFinalLoading ? (
                        <>
                          <Loader2 className="w-6 h-6 animate-spin" />
                          Generating Audio...
                        </>
                      ) : (
                        <>
                          <Music className="w-6 h-6" />
                          {finalScript && audioCache[finalScript] ? "Play Audio" : "Generate Final Audio"}
                        </>
                      )}
                    </Button>

                    <div className="pt-4 border-t border-slate-800/50 space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 flex items-center gap-2">
                          <Search className="w-3 h-3" />
                          Word Scratchpad
                        </label>
                        <span className="text-[10px] text-slate-500 italic">Test pronunciations on the fly</span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Type a word to test..."
                          className="bg-slate-950 border-slate-800 rounded-xl px-4 h-11 text-sm focus-visible:ring-indigo-500 transition-all font-sans"
                          value={scratchpadText}
                          onChange={(e) => setScratchpadText(e.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className={`h-11 w-11 rounded-xl border-slate-800 transition-all ${playingAudio?.vIndex === "scratchpad" ? "text-white border-indigo-500 bg-indigo-500/10" : "text-slate-400 hover:text-white"}`}
                          onClick={() => scratchpadText && handlePlay(scratchpadText, -1, "scratchpad")}
                          disabled={!scratchpadText || (audioLoading?.vIndex === "scratchpad")}
                        >
                          {audioLoading?.vIndex === "scratchpad" ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : playingAudio?.vIndex === "scratchpad" ? (
                            <Pause className="w-5 h-5 fill-current" />
                          ) : (
                            <Play className="w-5 h-5 fill-current" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {/* Advanced Audio Player */}
                    <div className="bg-slate-950/50 border border-slate-800 rounded-2xl p-6 space-y-6">
                      {/* Live Transcript / Word Scrubbing */}
                      {wordAlignments.length > 0 && (
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 flex items-center gap-2">
                              <FileText className="w-3 h-3" />
                              Live Transcript (Click word to scrub)
                            </label>
                            <span className="text-[10px] text-slate-500 italic">Shift + Click for phrase selection</span>
                          </div>

                          {/* Selection Toolbar */}
                          {selectionStart !== null && (
                            <div className="space-y-3 p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl animate-in fade-in slide-in-from-top-1">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <div className="bg-indigo-500 p-1.5 rounded-lg">
                                    <Sparkles className="w-4 h-4 text-white" />
                                  </div>
                                  <div>
                                    <p className="text-xs font-bold text-white uppercase tracking-wider">
                                      {selectionEnd !== null ? "Phrase Scratchpad" : "Word Selected"}
                                    </p>
                                    <p className="text-[10px] text-indigo-300">
                                      {selectionEnd !== null
                                        ? `Editing range: ${Math.min(selectionStart, selectionEnd)} - ${Math.max(selectionStart, selectionEnd)}`
                                        : "Shift-click another word to select a range"}
                                    </p>
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-[10px] text-slate-500 hover:text-white"
                                  onClick={() => { setSelectionStart(null); setSelectionEnd(null); setTempPhraseVariation(""); }}
                                >
                                  Cancel
                                </Button>
                              </div>

                              {selectionEnd !== null && (
                                <div className="flex flex-col gap-3 pt-1">
                                  <div className="flex items-center gap-2">
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <Button
                                          variant="outline"
                                          className="h-10 px-3 bg-slate-950 border-slate-800 text-slate-400 hover:text-white flex items-center gap-2 shrink-0"
                                        >
                                          <Hash className="w-4 h-4" />
                                          <span className="text-xs">Pronoun Shortcut</span>
                                          <ChevronDown className="w-3 h-3 ml-1 opacity-50" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent className="w-56 p-2 bg-slate-900 border-slate-800 shadow-2xl">
                                        <div className="space-y-1 max-h-[200px] overflow-y-auto custom-scrollbar">
                                          {extractedNouns.map((noun, nIdx) => (
                                            <button
                                              key={nIdx}
                                              className="w-full text-left px-3 py-1.5 rounded-md text-xs text-slate-400 hover:bg-indigo-500/10 hover:text-indigo-400 transition-colors flex items-center justify-between group/noun"
                                              onClick={() => {
                                                const approvedText = noun.selectedVariation || noun.customVariation || noun.original;
                                                setTempPhraseVariation(approvedText);
                                                toast.info(`Applied pronoun: "${approvedText}"`);
                                              }}
                                            >
                                              <span className="truncate">{noun.original}</span>
                                              <span className="text-[9px] text-slate-600 group-hover/noun:text-indigo-500/50 italic shrink-0">
                                                {noun.selectedVariation || noun.customVariation ? "Approved" : "Default"}
                                              </span>
                                            </button>
                                          ))}
                                          {extractedNouns.length === 0 && (
                                            <p className="px-3 py-4 text-[10px] text-slate-600 text-center">No pronouns analyzed yet.</p>
                                          )}
                                        </div>
                                      </PopoverContent>
                                    </Popover>
                                    <Input
                                      value={tempPhraseVariation}
                                      onChange={(e) => setTempPhraseVariation(e.target.value)}
                                      placeholder="Type phrase variation phonetic respelling..."
                                      className="h-10 text-xs bg-slate-950 border-slate-800"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="outline"
                                      className="flex-1 h-9 text-xs border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                                      onClick={() => handleTryVariation(tempPhraseVariation)}
                                    >
                                      <Play className="w-4 h-4 mr-2" />
                                      Try Selection
                                    </Button>
                                    <Button
                                      className="flex-1 h-9 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-bold"
                                      onClick={handlePatchPhrase}
                                      disabled={isPatching !== null}
                                    >
                                      {isPatching === -1 ? (
                                        <Loader2 className="w-3 h-3 animate-spin mr-2" />
                                      ) : (
                                        <CheckCircle2 className="w-3 h-3 mr-2" />
                                      )}
                                      Patch Phrase
                                    </Button>
                                  </div>

                                  {/* Special Case: Auditor Shortcut for Phrases */}
                                  {extractedNouns.some(n =>
                                    normalizeForMatch(n.original) === normalizeForMatch(tempPhraseVariation.trim())
                                  ) && (
                                      <div className="pt-2 border-t border-indigo-500/20">
                                        <Button
                                          variant="ghost"
                                          className="w-full justify-start h-8 text-[10px] text-indigo-400 hover:bg-indigo-500/10 px-0"
                                          onClick={() => {
                                            const noun = extractedNouns.find(n =>
                                              normalizeForMatch(n.original) === normalizeForMatch(tempPhraseVariation.trim())
                                            );
                                            if (noun) {
                                              const approvedText = noun.selectedVariation || noun.customVariation || noun.original;
                                              setTempPhraseVariation(approvedText);
                                              toast.info(`Applied approved greeting: "${approvedText}"`);
                                            }
                                          }}
                                          disabled={isPatching !== null}
                                        >
                                          <CheckCircle2 className="w-4 h-4 mr-2" />
                                          Use Auditor Approved Greeting Variation
                                        </Button>
                                      </div>
                                    )}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="p-4 bg-slate-900/50 rounded-xl border border-slate-800/50 text-base leading-relaxed text-slate-400 flex flex-wrap gap-x-1.5 gap-y-1 max-h-[150px] overflow-y-auto custom-scrollbar">
                            {wordAlignments.map((alignment, idx) => {
                              const normTarget = normalizeForMatch(alignment.word);
                              const isProperNoun = extractedNouns.some(n =>
                                normalizeForMatch(n.original) === normTarget ||
                                (n.selectedVariation && normalizeForMatch(n.selectedVariation) === normTarget) ||
                                (n.customVariation && normalizeForMatch(n.customVariation) === normTarget)
                              );

                              return (
                                <div key={idx} className="group/word relative py-1">
                                  <span
                                    onClick={(e) => {
                                      if (e.shiftKey) {
                                        if (selectionStart === null) {
                                          setSelectionStart(idx);
                                        } else {
                                          setSelectionEnd(idx);
                                          // Initialize phrase variation with current words
                                          const start = Math.min(selectionStart, idx);
                                          const end = Math.max(selectionStart, idx);
                                          const text = wordAlignments.slice(start, end + 1).map(a => a.word).join(" ");
                                          setTempPhraseVariation(text);
                                        }
                                      } else {
                                        setSelectionStart(idx);
                                        setSelectionEnd(null);
                                        // Initialize variation for single word selection
                                        setTempPhraseVariation(alignment.word.replace(/[.,!?]$/, "").trim());

                                        if (finalAudioRef.current) {
                                          finalAudioRef.current.currentTime = alignment.start;
                                          setCurrentTime(alignment.start);
                                          if (!isPlayingFinal) {
                                            finalAudioRef.current.play();
                                            setIsPlayingFinal(true);
                                          }
                                        }
                                      }
                                    }}
                                    className={`cursor-pointer transition-all px-1.5 rounded-lg hover:text-white hover:bg-slate-800 
                                      ${currentWordIndex === idx ? "text-indigo-400 bg-indigo-500/10 font-bold scale-105" : "text-slate-400"} 
                                      ${isProperNoun ? "underline decoration-indigo-500/50 decoration-2 underline-offset-4" : ""}
                                      ${(selectionStart !== null && selectionEnd !== null) &&
                                        ((idx >= Math.min(selectionStart, selectionEnd) && idx <= Math.max(selectionStart, selectionEnd)))
                                        ? "bg-indigo-500/40 text-white ring-1 ring-indigo-500/50"
                                        : selectionStart === idx ? "bg-indigo-500/20 text-white" : ""}
                                    `}
                                  >
                                    {alignment.word}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div className="space-y-4">
                        <div className="flex items-center justify-between text-xs font-medium text-slate-500">
                          <span>{formatTime(currentTime)}</span>
                          <span>{formatTime(duration)}</span>
                        </div>
                        <Slider
                          value={[currentTime]}
                          max={duration}
                          step={0.1}
                          onValueChange={([val]) => {
                            if (finalAudioRef.current) {
                              finalAudioRef.current.currentTime = val;
                              setCurrentTime(val);
                            }
                          }}
                          className="py-4"
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-6">
                        <div className="flex items-center gap-4">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 rounded-full border-slate-800 text-slate-400 hover:text-white"
                            onClick={() => skip10(false)}
                          >
                            <Rewind className="w-5 h-5 fill-current" />
                          </Button>

                          <Button
                            onClick={handlePlayFinalAudio}
                            disabled={isFinalLoading}
                            className={`h-16 w-16 rounded-full flex items-center justify-center transition-all shadow-xl ${isPlayingFinal
                              ? "bg-red-500/10 border border-red-500/50 text-red-400 hover:bg-red-500/20"
                              : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20"
                              }`}
                          >
                            {isFinalLoading ? (
                              <Loader2 className="w-8 h-8 animate-spin" />
                            ) : isPlayingFinal ? (
                              <Pause className="w-8 h-8 fill-current" />
                            ) : (
                              <Play className="w-8 h-8 fill-current ml-1" />
                            )}
                          </Button>

                          <Button
                            variant="outline"
                            size="icon"
                            className="h-10 w-10 rounded-full border-slate-800 text-slate-400 hover:text-white"
                            onClick={() => skip10(true)}
                          >
                            <FastForward className="w-5 h-5 fill-current" />
                          </Button>

                          <Button
                            variant="outline"
                            size="icon"
                            className={`h-10 w-10 rounded-full border-slate-800 transition-all ${finalAudioRef.current?.src ? "text-indigo-400 border-indigo-500/30 hover:bg-indigo-500/10" : "text-slate-700 opacity-50 cursor-not-allowed"}`}
                            onClick={handleDownloadAudio}
                            title="Download Audio"
                          >
                            <Download className="w-5 h-5 text-indigo-400" />
                          </Button>
                        </div>

                        <div className="flex items-center gap-2 bg-slate-900 p-1.5 rounded-xl border border-slate-800">
                          {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                            <Button
                              key={rate}
                              variant="ghost"
                              size="sm"
                              className={`h-8 px-3 text-[10px] font-bold rounded-lg transition-all ${playbackRate === rate
                                ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/20"
                                : "text-slate-500 hover:text-slate-300"
                                }`}
                              onClick={() => setPlaybackRate(rate)}
                            >
                              {rate}x
                            </Button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </section>
          </section>
        ) : !isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-24 text-slate-600 border-2 border-dashed border-slate-900 rounded-3xl">
            <Search className="w-12 h-12 mb-4 opacity-10" />
            <p className="text-lg">Paste a script above to begin auditing.</p>
          </div>
        )}
      </main>
    </div >
  );
}

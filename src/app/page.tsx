"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractProperNouns, ExtractedNoun, regenerateNounVariations } from "@/actions/extraction-actions";
import { generateVariationAudio, generateContextAudio } from "@/actions/audio-actions";
import { toast } from "sonner";
import { Loader2, Music, Search, CheckCircle2, RotateCcw, Play, Pause, Check, Download, Copy, FileText } from "lucide-react";

interface AuditState extends ExtractedNoun {
  selectedVariation?: string;
  customVariation?: string;
}

export default function AudioAuditDashboard() {
  const [script, setScript] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedNouns, setExtractedNouns] = useState<AuditState[]>([]);
  const [isRegenerating, setIsRegenerating] = useState<Record<number, boolean>>({});
  const [playingAudio, setPlayingAudio] = useState<{ index: number; vIndex: number | "manual" | "context" } | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [finalScript, setFinalScript] = useState<string | null>(null);
  const [isPlayingFinal, setIsPlayingFinal] = useState(false);

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

    setFinalScript(audited);
    toast.success("Final script prepared!");
  };

  const handlePlayFinalAudio = async () => {
    if (!finalScript) return;

    if (isPlayingFinal) {
      stopAudio();
      setIsPlayingFinal(false);
      return;
    }

    setIsPlayingFinal(true);
    try {
      const audioData = await generateVariationAudio(finalScript);
      const audio = new Audio(audioData);
      setAudioElement(audio);
      audio.play();
      audio.onended = () => {
        setIsPlayingFinal(false);
        setAudioElement(null);
      };
    } catch (error) {
      toast.error("Failed to generate final audio. Script might be too long.");
      setIsPlayingFinal(false);
    }
  };

  const copyToClipboard = () => {
    if (finalScript) {
      navigator.clipboard.writeText(finalScript);
      toast.success("Copied to clipboard!");
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

  const stopAudio = () => {
    if (audioElement) {
      audioElement.pause();
      setAudioElement(null);
    }
    setPlayingAudio(null);
  };

  const handlePlay = async (text: string, index: number, vIndex: number | "manual" | "context") => {
    if (playingAudio?.index === index && playingAudio?.vIndex === vIndex) {
      stopAudio();
      return;
    }

    stopAudio();
    setPlayingAudio({ index, vIndex });

    try {
      const audioData = await generateVariationAudio(text);
      const audio = new Audio(audioData);
      setAudioElement(audio);
      audio.play();
      audio.onended = () => {
        setPlayingAudio(null);
        setAudioElement(null);
      };
    } catch (error) {
      toast.error("Failed to play audio.");
      setPlayingAudio(null);
    }
  };

  const handleSelect = (index: number, variation: string) => {
    const updatedNouns = [...extractedNouns];
    updatedNouns[index] = { ...updatedNouns[index], selectedVariation: variation };
    setExtractedNouns(updatedNouns);
    setFinalScript(null); // Force re-generate to see changes
    toast.success(`Selected "${variation}" for ${updatedNouns[index].original}`);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 p-8 font-sans">
      <header className="max-w-5xl mx-auto mb-12 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight mb-2 flex items-center gap-3">
            <Music className="w-8 h-8 text-indigo-400" />
            Audio Audit
          </h1>
          <p className="text-slate-400">Pronunciation Auditing Tool for ElevenLabs</p>
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
                      <CardTitle className="text-2xl font-bold tracking-tight text-white group-hover:text-indigo-400 transition-colors">
                        {noun.original}
                      </CardTitle>
                      <CheckCircle2 className="w-6 h-6 text-slate-700 group-hover:text-slate-600 transition-colors" />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-6">
                    <p className="text-sm text-slate-400 leading-relaxed italic border-l-2 border-indigo-500/30 pl-4 py-1">
                      "{noun.context}"
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
                              <span className={`text-sm font-medium ${noun.selectedVariation === variant ? "text-white" : "text-slate-300"}`}>
                                {variant}
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
                              >
                                {playingAudio?.index === index && playingAudio?.vIndex === vIndex ? (
                                  <Pause className="w-4 h-4 fill-current" />
                                ) : (
                                  <Play className="w-4 h-4 fill-current" />
                                )}
                              </Button>
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
                          >
                            {playingAudio?.index === index && playingAudio?.vIndex === "context" ? (
                              <Pause className="w-4 h-4 fill-current animate-pulse" />
                            ) : (
                              <Music className="w-4 h-4 group-hover:scale-110 transition-transform" />
                            )}
                            {playingAudio?.index === index && playingAudio?.vIndex === "context" ? "Playing Context..." : "Listen in Context"}
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
                          disabled={!noun.customVariation}
                        >
                          {playingAudio?.index === index && playingAudio?.vIndex === "manual" ? (
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
                  <div className="p-8 space-y-6">
                    <div className="bg-slate-950 p-6 rounded-2xl border border-slate-800 text-lg leading-relaxed text-slate-300 whitespace-pre-wrap font-serif min-h-[150px]">
                      {finalScript}
                    </div>

                    <Button
                      onClick={handlePlayFinalAudio}
                      disabled={isPlayingFinal && !audioElement}
                      className={`w-full h-14 rounded-2xl text-lg font-bold transition-all gap-3 shadow-xl ${isPlayingFinal
                        ? "bg-red-500/10 border border-red-500/50 text-red-400 hover:bg-red-500/20"
                        : "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/20"
                        }`}
                    >
                      {isPlayingFinal ? (
                        <>
                          <Pause className="w-6 h-6 fill-current" />
                          Stop Playback
                        </>
                      ) : (
                        <>
                          <Music className="w-6 h-6" />
                          Generate & Play Final Audio
                        </>
                      )}
                    </Button>
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
    </div>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractProperNouns, ExtractedNoun, regenerateNounVariations } from "@/actions/extraction-actions";
import { toast } from "sonner";
import { Loader2, Music, Search, CheckCircle2, RotateCcw } from "lucide-react";

export default function AudioAuditDashboard() {
  const [script, setScript] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedNouns, setExtractedNouns] = useState<ExtractedNoun[]>([]);
  const [isRegenerating, setIsRegenerating] = useState<Record<number, boolean>>({});

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
      toast.error("Failed to analyze script. Please check your Gemini API key.");
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
                      <div className="flex flex-wrap gap-2 max-h-[120px] overflow-y-auto pr-2 custom-scrollbar">
                        {noun.variations.map((variant, vIndex) => (
                          <div
                            key={vIndex}
                            className="px-3 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-sm font-medium text-indigo-300 hover:bg-indigo-500/20 transition-colors cursor-pointer"
                          >
                            {variant}
                          </div>
                        ))}
                      </div>
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
                        />
                        <Button variant="outline" size="sm" className="border-slate-800 hover:bg-slate-800 h-9">
                          Update
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

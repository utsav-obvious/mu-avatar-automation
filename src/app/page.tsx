"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { extractProperNouns, ExtractedNoun } from "@/actions/extraction-actions";
import { toast } from "sonner";
import { Loader2, Music, Search, CheckCircle2 } from "lucide-react";

export default function AudioAuditDashboard() {
  const [script, setScript] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedNouns, setExtractedNouns] = useState<ExtractedNoun[]>([]);

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
                      <CheckCircle2 className="w-6 h-6 text-slate-700 group-hover:text-slate-600" />
                    </div>
                  </CardHeader>
                  <CardContent className="pt-4">
                    <p className="text-slate-400 leading-relaxed italic border-l-2 border-indigo-500/30 pl-4 py-1">
                      "{noun.context}"
                    </p>
                    <div className="mt-8 flex flex-col gap-3">
                      <label className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                        Next Step: Variation Auditing
                      </label>
                      <div className="h-32 w-full bg-slate-950/50 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center text-sm text-slate-600 gap-2">
                        <Music className="w-5 h-5 opacity-20" />
                        <span>Milestone 3: Phonetic Variations</span>
                      </div>
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

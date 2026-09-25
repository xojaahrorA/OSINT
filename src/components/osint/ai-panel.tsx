"use client";

import { useState, useRef, useEffect } from "react";
import { BrainCircuit, Send, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ReactMarkdown from "react-markdown";

export function AiPanel({
  aiText,
  aiStatus,
  onRunAnalysis,
  onAskQuestion,
  canAnalyze,
}: {
  aiText: string;
  aiStatus: "idle" | "streaming" | "done" | "error";
  onRunAnalysis: () => void;
  onAskQuestion: (q: string) => void;
  canAnalyze: boolean;
}) {
  const [question, setQuestion] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [aiText]);

  const ask = () => {
    const q = question.trim();
    if (!q || aiStatus === "streaming") return;
    onAskQuestion(q);
    setQuestion("");
  };

  return (
    <div className="rounded-lg border bg-card overflow-hidden flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <BrainCircuit className="w-4 h-4 text-emerald-400" />
        <span className="text-sm font-medium">AI tahlilchi</span>
        {aiStatus === "streaming" && (
          <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 ml-auto" />
        )}
        {aiStatus === "done" && (
          <Sparkles className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
        )}
      </div>

      <div className="p-4">
        {aiText === "" ? (
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground mb-4">
              Tizim topgan barcha ochiq manbalar asosida AI to&apos;liq OSINT
              xulosa yozib beradi: asosiy topilmalar, ochiqlik darajasi va
              tavsiyalar.
            </p>
            <Button
              onClick={onRunAnalysis}
              disabled={!canAnalyze || aiStatus === "streaming"}
              className="gap-2"
            >
              {aiStatus === "streaming" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <BrainCircuit className="w-4 h-4" />
              )}
              AI xulosa chiqarish
            </Button>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              className="max-h-96 overflow-y-auto pr-2 prose prose-sm prose-invert prose-emerald max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-1.5 prose-li:my-0.5"
            >
              <ReactMarkdown>{aiText}</ReactMarkdown>
            </div>
            <div className="flex gap-2 mt-4">
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && ask()}
                placeholder="Natijalar bo'yicha savol bering..."
                className="h-9 text-sm"
                disabled={aiStatus === "streaming"}
              />
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={ask}
                disabled={aiStatus === "streaming" || !question.trim()}
                aria-label="Savol yuborish"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

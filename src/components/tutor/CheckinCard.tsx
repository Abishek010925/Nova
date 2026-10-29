import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useState } from "react";

import { RichInline } from "@/components/tutor/Rich";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CheckinBlock } from "@/lib/tutor-blocks";
import { cn } from "@/lib/utils";

/**
 * A free-text comprehension check for the concept currently being taught.
 * Unlike QuizCard, this is graded by the tutor (LLM or the built-in fallback)
 * rather than against a fixed answer key, so the result arrives asynchronously.
 */
export function CheckinCard({
  block,
  onSubmit,
  result,
  busy,
}: {
  block: CheckinBlock;
  onSubmit: (text: string) => void;
  result?: { correct: boolean } | null | undefined;
  busy?: boolean | undefined;
}) {
  const [text, setText] = useState("");
  const answered = result !== undefined && result !== null;

  return (
    <section className="rounded-xl border border-primary/30 bg-accent/40 p-4">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">
        Check your understanding — {block.concept}
      </p>
      <h4 className="mt-2 font-serif text-base font-semibold">
        <RichInline>{block.prompt}</RichInline>
      </h4>

      {!answered ? (
        <form
          className="mt-3 flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = text.trim();
            if (!trimmed || busy) return;
            onSubmit(trimmed);
          }}
        >
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Answer in your own words…"
            rows={2}
            className="resize-none bg-card"
            disabled={busy}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <Button type="submit" size="sm" className="self-start" disabled={busy || !text.trim()}>
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {busy ? "Checking…" : "Submit answer"}
          </Button>
        </form>
      ) : (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-lg border p-3 text-sm",
            result.correct
              ? "border-chart-2 bg-chart-2/10 text-foreground"
              : "border-border bg-card text-foreground",
          )}
        >
          {result.correct ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-chart-2" />
          ) : (
            <XCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <span>{result.correct ? "Understood — moving on." : "Let's refine that a bit."}</span>
        </div>
      )}
    </section>
  );
}

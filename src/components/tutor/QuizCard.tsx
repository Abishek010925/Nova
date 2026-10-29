import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";

import { CodeBlock } from "@/components/tutor/CodeBlock";
import { RichInline } from "@/components/tutor/Rich";
import { Button } from "@/components/ui/button";
import type { QuizQuestion } from "@/lib/course-types";
import { cn } from "@/lib/utils";

export function QuizCard({
  question,
  onAnswer,
}: {
  question: QuizQuestion;
  onAnswer?: (correct: boolean) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const correct = submitted && selected === question.answerIndex;

  const submit = () => {
    if (selected === null) return;
    setSubmitted(true);
    onAnswer?.(selected === question.answerIndex);
  };

  return (
    <section className="rounded-xl border border-primary/30 bg-accent/40 p-4">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">
        {question.kind === "code-prediction" ? "Predict the output" : "Checkpoint"}
      </p>
      <h4 className="mt-2 font-serif text-base font-semibold">
        <RichInline>{question.prompt}</RichInline>
      </h4>

      {question.code && (
        <CodeBlock
          className="mt-3"
          code={question.code}
          language={question.language ?? "text"}
          label="Read carefully"
        />
      )}

      <ul className="mt-3 space-y-2">
        {question.options.map((option, index) => {
          const isAnswer = index === question.answerIndex;
          const isPicked = index === selected;
          return (
            <li key={option}>
              <button
                type="button"
                disabled={submitted}
                onClick={() => setSelected(index)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm transition-colors",
                  !submitted && "hover:border-primary/50 hover:bg-background",
                  isPicked && !submitted && "border-primary bg-background",
                  submitted && isAnswer && "border-chart-2 bg-chart-2/10",
                  submitted && isPicked && !isAnswer && "border-destructive bg-destructive/10",
                )}
              >
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-border text-[11px] font-semibold">
                  {String.fromCharCode(65 + index)}
                </span>
                <span className="flex-1">
                  <RichInline>{option}</RichInline>
                </span>
                {submitted && isAnswer && <CheckCircle2 className="size-4 text-chart-2" />}
                {submitted && isPicked && !isAnswer && (
                  <XCircle className="size-4 text-destructive" />
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {!submitted ? (
        <Button className="mt-3" size="sm" onClick={submit} disabled={selected === null}>
          Check answer
        </Button>
      ) : (
        <div className="mt-3 rounded-lg border border-border bg-card p-3 text-sm">
          <p className={cn("font-medium", correct ? "text-chart-2" : "text-destructive")}>
            {correct ? "Correct." : "Not quite."}
          </p>
          <p className="mt-1 text-muted-foreground">
            <RichInline>{question.explanation}</RichInline>
          </p>
        </div>
      )}
    </section>
  );
}

import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { CheckinCard } from "@/components/tutor/CheckinCard";
import { CodeBlock } from "@/components/tutor/CodeBlock";
import { QuizCard } from "@/components/tutor/QuizCard";
import { Rich } from "@/components/tutor/Rich";
import type { TutorBlock } from "@/lib/tutor-blocks";

const Mermaid = lazy(() => import("@/components/tutor/Mermaid"));

export function TutorBlockView({
  block,
  onAnswer,
  onCheckin,
  checkinResult,
  checkinBusy,
}: {
  block: TutorBlock;
  onAnswer?: ((questionId: string, correct: boolean) => void) | undefined;
  onCheckin?: ((text: string) => void) | undefined;
  checkinResult?: { correct: boolean } | null | undefined;
  checkinBusy?: boolean | undefined;
}) {
  if (block.kind === "text") {
    return (
      <Rich className="tutor-prose">{block.markdown}</Rich>
    );
  }

  if (block.kind === "code") {
    return <CodeBlock code={block.code} language={block.language} label={block.label} />;
  }

  if (block.kind === "mermaid") {
    return (
      <ClientOnly
        fallback={<div className="h-32 animate-pulse rounded-xl border border-border bg-muted" />}
      >
        <Suspense
          fallback={<div className="h-32 animate-pulse rounded-xl border border-border bg-muted" />}
        >
          <Mermaid chart={block.chart} title={block.title} />
        </Suspense>
      </ClientOnly>
    );
  }

  if (block.kind === "checkin") {
    return (
      <CheckinCard
        block={block}
        onSubmit={(text) => onCheckin?.(text)}
        result={checkinResult}
        busy={checkinBusy}
      />
    );
  }

  return (
    <QuizCard
      question={block.question}
      onAnswer={(correct) => onAnswer?.(block.question.id, correct)}
    />
  );
}

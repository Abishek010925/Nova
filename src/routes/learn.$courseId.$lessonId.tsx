import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { ArrowUp, Check, Cpu, Loader2, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Rich } from "@/components/tutor/Rich";
import { TutorBlockView } from "@/components/tutor/TutorBlockView";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/app-store";
import { EXPLAIN_LEVELS, flattenLessons, type ExplainLevel } from "@/lib/course-types";
import { useLessonPanel } from "@/lib/lesson-panel";
import { useTutorSession } from "@/lib/use-tutor-session";
import { cn } from "@/lib/utils";

const QUIZ_FEEDBACK_DELAY_MS = 900;

export const Route = createFileRoute("/learn/$courseId/$lessonId")({
  head: () => ({
    meta: [
      { title: "Tutor workspace — Sarathi AI Tutor" },
      {
        name: "description",
        content:
          "Learn one concept at a time: the tutor explains at your level, checks your understanding, and adapts its pace to you.",
      },
      { property: "og:title", content: "Tutor workspace — Sarathi AI Tutor" },
      {
        property: "og:description",
        content: "A step-by-step AI tutor that adapts its language, pace and depth to you.",
      },
    ],
  }),
  component: TutorWorkspace,
});

function LevelPicker({
  value,
  onChange,
  disabled,
}: {
  value: ExplainLevel;
  onChange: (level: ExplainLevel) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Explanation level"
      className="inline-flex rounded-full border border-border bg-muted/50 p-0.5"
    >
      {EXPLAIN_LEVELS.map((l) => (
        <button
          key={l.id}
          type="button"
          role="radio"
          aria-checked={value === l.id}
          disabled={disabled}
          title={`${l.label} — explained for a ${l.audience} student. ${l.blurb}`}
          onClick={() => onChange(l.id)}
          className={cn(
            "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
            value === l.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {l.label}
          <span className="ml-1 hidden text-[10px] font-normal opacity-70 sm:inline">
            · {l.audience}
          </span>
        </button>
      ))}
    </div>
  );
}

function isNextTopicCommand(message: string): boolean {
  const command = message
    .toLowerCase()
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .replace(/^(please\s+)|(\s+please)$/g, "");
  return [
    "next",
    "next topic",
    "next section",
    "next concept",
    "go next",
    "go to next",
    "go to next topic",
    "go to next section",
    "go to next concept",
    "go to the next topic",
    "go to the next section",
    "go to the next concept",
    "move on",
    "let's move on",
    "continue",
  ].includes(command);
}

function TutorWorkspace() {
  const { courseId, lessonId } = Route.useParams();
  const navigate = useNavigate();
  const {
    courses,
    hydrated,
    enrollmentFor,
    enroll,
    touchLesson,
    completeLesson,
    recordAttempt,
    level: storedLevel,
    levelSet,
    setLevel,
  } = useAppStore();
  const { setPanel } = useLessonPanel();

  const course = courses.find((c) => c.id === courseId);
  const lessons = useMemo(() => (course ? flattenLessons(course) : []), [course]);
  const index = lessons.findIndex((l) => l.lessonId === lessonId);
  const current = index >= 0 ? lessons[index] : undefined;
  const level: ExplainLevel = levelSet
    ? storedLevel
    : (course?.teaching.defaultLevel ?? storedLevel);

  const {
    turns,
    streaming,
    engine,
    engineDetail,
    sessionLoaded,
    persistenceError,
    conceptIndex,
    lessonDone,
    error,
    mastery,
    checkinResults,
    activeCheckinId,
    teachConcept,
    askQuestion,
    submitCheckin,
    requestNextTopic,
    advanceAfterQuiz,
  } = useTutorSession(`${courseId}/${lessonId}`);
  const [question, setQuestion] = useState("");
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const [advanceQuizPending, setAdvanceQuizPending] = useState(false);
  const [advanceQuizCompleted, setAdvanceQuizCompleted] = useState(false);
  const advanceQuizAnswers = useRef(new Set<string>());
  const advanceQuizAdvanced = useRef(false);
  const streamEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  const lastAutoTaughtConcept = useRef(0);
  const finishRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!course || !current) return;
    if (!enrollmentFor(course.id)) enroll(course.id);
    touchLesson(course.id, current.lessonId);
    started.current = false;
    setAnswered({});
    setAdvanceQuizPending(false);
    setAdvanceQuizCompleted(false);
    advanceQuizAnswers.current.clear();
    advanceQuizAdvanced.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, lessonId, hydrated]);

  useEffect(() => {
    if (!sessionLoaded) return;
    started.current = turns.length > 0;
    lastAutoTaughtConcept.current = conceptIndex;
    // Restore the saved cursor once; later concept-index changes should trigger teaching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionLoaded]);

  useEffect(() => {
    if (error) setAdvanceQuizPending(false);
  }, [error]);

  useEffect(() => {
    if (!advanceQuizCompleted || !current || conceptIndex < current.lesson.concepts.length - 1) {
      return;
    }
    const timer = setTimeout(() => finishRef.current(), QUIZ_FEEDBACK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [advanceQuizCompleted, conceptIndex, current]);

  useEffect(() => {
    streamEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, lessonDone]);

  // Grow the composer with its content, like a chat app.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [question]);

  // Teach each new concept automatically once the previous check-in is passed.
  useEffect(() => {
    if (!sessionLoaded || !started.current || !course || !current) return;
    if (conceptIndex === lastAutoTaughtConcept.current) return;
    lastAutoTaughtConcept.current = conceptIndex;
    if (lessonDone) return;
    teachConcept(
      {
        courseTitle: course.title,
        moduleTitle: current.moduleTitle,
        teaching: course.teaching,
        lesson: current.lesson,
        level,
      },
      conceptIndex,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conceptIndex]);

  const hasTurns = turns.length > 0;
  const pace = mastery.pace;

  // Publish lesson progress to the sidebar.
  useEffect(() => {
    setPanel({
      conceptIndex,
      started: hasTurns,
      done: lessonDone,
      pace,
      busy: streaming,
      onComplete: () => finishRef.current(),
    });
  }, [conceptIndex, hasTurns, lessonDone, pace, streaming, setPanel]);
  useEffect(() => () => setPanel(null), [setPanel]);

  if (!course || !current) {
    if (!hydrated) return <div className="p-10 text-sm text-muted-foreground">Loading lesson…</div>;
    throw notFound();
  }

  const lesson = current.lesson;
  const next = index < lessons.length - 1 ? lessons[index + 1] : undefined;
  const answeredList = Object.values(answered);
  const quizPassed = answeredList.some(Boolean);

  const baseRequest = {
    courseTitle: course.title,
    moduleTitle: current.moduleTitle,
    teaching: course.teaching,
    lesson,
    level,
  };

  const requiresQuiz = course.teaching.enforceQuizzes && lesson.quiz.length > 0;

  const onAnswer = (questionId: string, correct: boolean, isAdvanceQuiz: boolean) => {
    setAnswered((a) => ({ ...a, [questionId]: correct }));
    recordAttempt(course.id, questionId, correct);
    toast[correct ? "success" : "error"](correct ? "Correct — nice." : "Review the explanation.");
    if (isAdvanceQuiz) {
      advanceQuizAnswers.current.add(questionId);
      if (advanceQuizAnswers.current.size === 3 && !advanceQuizAdvanced.current) {
        advanceQuizAdvanced.current = true;
        setAdvanceQuizPending(false);
        const isLastConcept = conceptIndex >= lesson.concepts.length - 1;
        setAdvanceQuizCompleted(isLastConcept);
        advanceAfterQuiz(isLastConcept);
      }
    }
  };

  const startLesson = () => {
    started.current = true;
    teachConcept(baseRequest, 0);
  };

  const finish = () => {
    if (advanceQuizPending) {
      toast.error("Finish all three checkpoint questions before continuing.");
      return;
    }
    if (requiresQuiz && !quizPassed && !advanceQuizCompleted) {
      toast.error("Answer the checkpoint question correctly to complete this lesson.");
      return;
    }
    completeLesson(course.id, lesson.id, lesson.concepts);
    toast.success(`${lesson.title} marked as mastered`);
    if (next) {
      void navigate({
        to: "/learn/$courseId/$lessonId",
        params: { courseId: course.id, lessonId: next.lessonId },
      });
    } else {
      void navigate({ to: "/" });
    }
  };
  finishRef.current = finish;

  const changeLevel = (newLevel: ExplainLevel) => {
    if (newLevel === level) return;
    setLevel(newLevel);
    // Mid-lesson: re-explain what the student is looking at in the new register right away.
    if (hasTurns && !streaming) {
      const meta = EXPLAIN_LEVELS.find((l) => l.id === newLevel)!;
      askQuestion(
        { ...baseRequest, level: newLevel },
        `Please explain the current idea again for ${meta.label.toLowerCase()} level (${meta.audience}).`,
      );
    }
  };

  const submit = () => {
    const q = question.trim();
    if (!q || streaming || !hasTurns || advanceQuizPending) return;
    setQuestion("");
    if (isNextTopicCommand(q)) {
      advanceQuizAnswers.current.clear();
      advanceQuizAdvanced.current = false;
      setAdvanceQuizCompleted(false);
      setAdvanceQuizPending(true);
      requestNextTopic(baseRequest, q);
      return;
    }
    askQuestion(baseRequest, q);
  };

  const levelMeta = EXPLAIN_LEVELS.find((l) => l.id === level)!;

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-8 sm:px-6">
          {!sessionLoaded && (
            <div className="flex min-h-[55vh] items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Restoring your conversation…
            </div>
          )}

          {sessionLoaded && !hasTurns && !streaming && (
            <div className="flex min-h-[55vh] flex-col items-center justify-center text-center">
              <span className="grid size-11 place-items-center rounded-full bg-accent text-primary">
                <Sparkles className="size-5" />
              </span>
              <h1 className="mt-4 text-2xl font-semibold sm:text-3xl">{lesson.title}</h1>
              <Rich className="tutor-prose mt-3 max-w-xl text-muted-foreground">
                {lesson.intuition}
              </Rich>
              <p className="mt-3 max-w-md text-xs text-muted-foreground">
                {lesson.concepts.length} concepts, one at a time · about {lesson.minutes} min
                {lesson.sourceRef ? ` · from ${lesson.sourceRef} of the source` : ""}. I'll explain
                at <strong>{levelMeta.label}</strong> level ({levelMeta.audience}) — change it any
                time below.
              </p>
              <Button className="mt-5" size="lg" onClick={startLesson}>
                Start lesson
              </Button>
            </div>
          )}

          <div className="space-y-7">
            {turns.map((turn) =>
              turn.author === "student" ? (
                <div key={turn.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5">
                    {turn.blocks.map((block) => (
                      <TutorBlockView key={block.id} block={block} />
                    ))}
                  </div>
                </div>
              ) : (
                <article key={turn.id} className="flex gap-3">
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Sparkles className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    {turn.pending ? (
                      <p className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" /> Thinking…
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {turn.blocks.map((block) => (
                          <TutorBlockView
                            key={block.id}
                            block={block}
                            onAnswer={onAnswer}
                            onCheckin={
                              block.kind === "checkin"
                                ? (text) => submitCheckin(baseRequest, text)
                                : undefined
                            }
                            checkinResult={
                              block.kind === "checkin" ? checkinResults[block.id] : undefined
                            }
                            checkinBusy={
                              block.kind === "checkin" && block.id === activeCheckinId
                                ? streaming
                                : false
                            }
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ),
            )}

            {lessonDone && !streaming && (
              <div className="rounded-2xl border border-primary/30 bg-accent/40 p-5 text-center">
                <p className="font-serif text-lg font-semibold">
                  You've reached the end of this lesson
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ask anything below if something is still fuzzy, or move on when you're ready.
                </p>
                <Button className="mt-3" onClick={finish} disabled={advanceQuizPending}>
                  <Check className="mr-2 size-4" />
                  {next ? "Mark complete & continue" : "Mark complete & finish course"}
                </Button>
              </div>
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
          {persistenceError && (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {persistenceError}
            </p>
          )}
          <div ref={streamEnd} />
        </div>
      </div>

      <div className="shrink-0 bg-gradient-to-t from-background via-background to-transparent px-4 pt-2 pb-4 sm:px-6">
        <form
          className="mx-auto w-full max-w-3xl rounded-3xl border border-border bg-card p-2 shadow-sm focus-within:border-primary/50"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              !sessionLoaded
                ? "Restoring your conversation…"
                : hasTurns
                  ? "Ask a question or type “next” to continue…"
                  : "Start the lesson to ask questions…"
            }
            rows={1}
            disabled={!sessionLoaded || !hasTurns || advanceQuizPending}
            aria-label="Message Sarathi"
            className="block max-h-44 w-full resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2 px-1 pt-1">
            <LevelPicker value={level} onChange={changeLevel} disabled={streaming} />
            <div className="flex items-center gap-2">
              <span
                className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex"
                title={engineDetail}
              >
                <Cpu className="size-3" />
                {engine === "groq"
                  ? "Live AI tutor"
                  : engine === "openrouter"
                    ? "Live AI tutor (Nemotron fallback)"
                    : "Built-in tutor"}
              </span>
              <Button
                type="submit"
                size="icon"
                className="size-8 rounded-full"
                disabled={streaming || advanceQuizPending || !question.trim() || !hasTurns}
                aria-label="Send"
              >
                <ArrowUp className="size-4" />
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

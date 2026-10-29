import { useCallback, useMemo, useRef, useState } from "react";

import {
  defaultMastery,
  deriveMastery,
  nextId,
  type ConceptOutcome,
  type MasterySignal,
  type TutorBlock,
  type TutorHistoryItem,
  type TutorRequest,
  type TutorTurn,
} from "./tutor-blocks";

type StreamEvent =
  | { type: "meta"; engine: string; detail?: string }
  | { type: "block"; block: TutorBlock }
  | { type: "judgement"; correct: boolean; advance: boolean }
  | { type: "done"; done: boolean };

type BaseRequest = {
  courseTitle: string;
  moduleTitle: string;
  teaching: TutorRequest["teaching"];
  lesson: TutorRequest["lesson"];
  level: TutorRequest["level"];
};

const AUTO_ADVANCE_DELAY_MS = 900;

function blockToHistoryText(block: TutorBlock): string | null {
  if (block.kind === "text") return block.markdown;
  if (block.kind === "checkin") return `(asked: ${block.prompt})`;
  if (block.kind === "code") return "[shared a code example]";
  if (block.kind === "mermaid") return "[shared a diagram]";
  if (block.kind === "quiz") return `(checkpoint: ${block.question.prompt})`;
  return null;
}

function turnToHistoryItem(turn: TutorTurn): TutorHistoryItem | null {
  const text = turn.blocks
    .map(blockToHistoryText)
    .filter((t): t is string => !!t)
    .join(" ")
    .slice(0, 400);
  if (!text) return null;
  return { role: turn.author, text };
}

export function useTutorSession() {
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [engine, setEngine] = useState<string>("simulated");
  const [engineDetail, setEngineDetail] = useState<string | undefined>(undefined);
  const [conceptIndex, setConceptIndex] = useState(0);
  const [lessonDone, setLessonDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ConceptOutcome[]>([]);
  const [checkinResults, setCheckinResults] = useState<Record<string, { correct: boolean }>>({});
  const [activeCheckinId, setActiveCheckinId] = useState<string | null>(null);

  const hintedConcepts = useRef<Set<number>>(new Set());
  const busy = useRef(false);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors activeCheckinId so the stable runRequest callback can read the latest
  // "which checkin is awaiting an answer" value without needing to be re-created.
  const activeCheckinIdRef = useRef<string | null>(null);

  const mastery: MasterySignal = useMemo(
    () => (outcomes.length === 0 ? defaultMastery() : deriveMastery(outcomes)),
    [outcomes],
  );

  const reset = useCallback(() => {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    setTurns([]);
    setConceptIndex(0);
    setLessonDone(false);
    setError(null);
    setOutcomes([]);
    setCheckinResults({});
    setActiveCheckinId(null);
    activeCheckinIdRef.current = null;
    hintedConcepts.current = new Set();
  }, []);

  const setActiveCheckin = useCallback((id: string | null) => {
    activeCheckinIdRef.current = id;
    setActiveCheckinId(id);
  }, []);

  const runRequest = useCallback(
    async (req: TutorRequest, opts?: { echoStudentText?: string }) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      setStreaming(true);

      if (opts?.echoStudentText) {
        setTurns((t) => [
          ...t,
          {
            id: nextId("turn"),
            author: "student",
            blocks: [{ id: nextId(), kind: "text", markdown: opts.echoStudentText! }],
          },
        ]);
      }
      const turnId = nextId("turn");
      setTurns((t) => [...t, { id: turnId, author: "tutor", blocks: [], pending: true }]);

      let judgement: { correct: boolean; advance: boolean } | null = null;

      try {
        const res = await fetch("/api/tutor", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(req),
        });
        if (!res.ok || !res.body) throw new Error(`Tutor unavailable (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastCheckinId: string | null = null;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let event: StreamEvent;
            try {
              event = JSON.parse(line) as StreamEvent;
            } catch {
              continue;
            }
            if (event.type === "meta") {
              setEngine(event.engine);
              setEngineDetail(event.detail);
            }
            if (event.type === "block") {
              if (event.block.kind === "checkin") lastCheckinId = event.block.id;
              setTurns((t) =>
                t.map((turn) =>
                  turn.id === turnId
                    ? { ...turn, pending: false, blocks: [...turn.blocks, event.block] }
                    : turn,
                ),
              );
            }
            if (event.type === "judgement") judgement = event;
            if (event.type === "done" && event.done) setLessonDone(true);
          }
        }
        setTurns((t) => t.map((turn) => (turn.id === turnId ? { ...turn, pending: false } : turn)));

        if (req.mode === "check") {
          const concept = req.lesson.concepts[req.conceptIndex] ?? req.lesson.title;
          const correct = judgement?.correct ?? false;
          const advance = judgement?.advance ?? true;
          const submittedId = activeCheckinIdRef.current;
          if (submittedId) {
            setCheckinResults((r) => ({ ...r, [submittedId]: { correct } }));
          }
          setOutcomes((o) => [...o, { concept, correct, hinted: !!req.hinted, at: Date.now() }]);
          const isLastConcept = req.conceptIndex >= req.lesson.concepts.length - 1;
          if (advance) {
            hintedConcepts.current.delete(req.conceptIndex);
            setActiveCheckin(null);
            if (!isLastConcept) {
              autoAdvanceTimer.current = setTimeout(() => {
                setConceptIndex((i) => i + 1);
              }, AUTO_ADVANCE_DELAY_MS);
            }
          } else {
            hintedConcepts.current.add(req.conceptIndex);
            setActiveCheckin(lastCheckinId);
          }
        } else if (req.mode === "concept" && lastCheckinId) {
          setActiveCheckin(lastCheckinId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "The tutor could not respond.");
        setTurns((t) => t.filter((turn) => turn.id !== turnId));
      } finally {
        busy.current = false;
        setStreaming(false);
      }
    },
    [setActiveCheckin],
  );

  const historyForRequest = useCallback(
    () =>
      turns
        .map(turnToHistoryItem)
        .filter((h): h is TutorHistoryItem => !!h)
        .slice(-6),
    [turns],
  );

  const teachConcept = useCallback(
    (base: BaseRequest, index: number) => {
      void runRequest({
        mode: "concept",
        conceptIndex: index,
        history: historyForRequest(),
        mastery,
        ...base,
      });
    },
    [historyForRequest, mastery, runRequest],
  );

  const askQuestion = useCallback(
    (base: BaseRequest, question: string) => {
      void runRequest(
        { mode: "ask", conceptIndex, question, history: historyForRequest(), mastery, ...base },
        { echoStudentText: question },
      );
    },
    [conceptIndex, historyForRequest, mastery, runRequest],
  );

  const submitCheckin = useCallback(
    (base: BaseRequest, text: string) => {
      void runRequest(
        {
          mode: "check",
          conceptIndex,
          answerText: text,
          hinted: hintedConcepts.current.has(conceptIndex),
          history: historyForRequest(),
          mastery,
          ...base,
        },
        { echoStudentText: text },
      );
    },
    [conceptIndex, historyForRequest, mastery, runRequest],
  );

  return {
    turns,
    streaming,
    engine,
    engineDetail,
    conceptIndex,
    lessonDone,
    error,
    mastery,
    checkinResults,
    activeCheckinId,
    teachConcept,
    askQuestion,
    submitCheckin,
    reset,
  };
}

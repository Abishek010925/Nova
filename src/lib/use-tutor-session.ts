import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  defaultMastery,
  deriveMastery,
  nextId,
  type ConceptOutcome,
  type MasterySignal,
  type TutorBlock,
  type TutorRequest,
  type TutorTurn,
} from "./tutor-blocks";
import { isTutorTurn, loadTutorSession, saveTutorSession } from "./tutor-session-storage";

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

export function useTutorSession(sessionId: string) {
  const activeSessionId = useRef(sessionId);
  activeSessionId.current = sessionId;
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [engine, setEngine] = useState<string>("simulated");
  const [engineDetail, setEngineDetail] = useState<string | undefined>(undefined);
  const [conceptIndex, setConceptIndex] = useState(0);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [loadedSessionId, setLoadedSessionId] = useState("");
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [lessonDone, setLessonDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<ConceptOutcome[]>([]);
  const [checkinResults, setCheckinResults] = useState<Record<string, { correct: boolean }>>({});
  const [activeCheckinId, setActiveCheckinId] = useState<string | null>(null);

  const hintedConcepts = useRef<Set<number>>(new Set());
  const busy = useRef(false);
  const activeController = useRef<AbortController | null>(null);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors activeCheckinId so the stable runRequest callback can read the latest
  // "which checkin is awaiting an answer" value without needing to be re-created.
  const activeCheckinIdRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    activeController.current?.abort();
    activeController.current = null;
    busy.current = false;
    setStreaming(false);
    setSessionLoaded(false);
    setLoadedSessionId("");
    setPersistenceError(null);
    setError(null);
    setTurns([]);
    setEngine("simulated");
    setEngineDetail(undefined);
    setConceptIndex(0);
    setLessonDone(false);
    setOutcomes([]);
    setCheckinResults({});
    setActiveCheckinId(null);
    activeCheckinIdRef.current = null;
    busy.current = false;
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    hintedConcepts.current.clear();

    void loadTutorSession(sessionId)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          const restoredTurns = Array.isArray(saved.turns) ? saved.turns.filter(isTutorTurn) : [];
          setTurns(restoredTurns.map((turn) => ({ ...turn, pending: false })));
          setEngine(saved.engine || "simulated");
          setEngineDetail(saved.engineDetail);
          setConceptIndex(
            Number.isInteger(saved.conceptIndex) ? Math.max(0, saved.conceptIndex) : 0,
          );
          setLessonDone(saved.lessonDone === true);
          setOutcomes(Array.isArray(saved.outcomes) ? saved.outcomes : []);
          const savedResults = saved.checkinResults;
          setCheckinResults(savedResults && typeof savedResults === "object" ? savedResults : {});
          const checkinId =
            typeof saved.activeCheckinId === "string" ? saved.activeCheckinId : null;
          setActiveCheckinId(checkinId);
          activeCheckinIdRef.current = checkinId;
          hintedConcepts.current = new Set(
            Array.isArray(saved.hintedConcepts) ? saved.hintedConcepts : [],
          );
        }
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error("[tutor-session] Could not restore chat history:", error);
        setPersistenceError("Previous chat history could not be loaded in this browser.");
      })
      .finally(() => {
        if (active) {
          setLoadedSessionId(sessionId);
          setSessionLoaded(true);
        }
      });

    return () => {
      active = false;
      activeController.current?.abort();
      activeController.current = null;
      busy.current = false;
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    };
  }, [sessionId]);

  const mastery: MasterySignal = useMemo(
    () => (outcomes.length === 0 ? defaultMastery() : deriveMastery(outcomes)),
    [outcomes],
  );
  const isSessionReady = sessionLoaded && loadedSessionId === sessionId;

  useEffect(() => {
    if (!isSessionReady || streaming) return;
    void saveTutorSession(sessionId, {
      turns: turns.filter((turn) => !turn.pending),
      conceptIndex,
      lessonDone,
      outcomes,
      checkinResults,
      activeCheckinId,
      hintedConcepts: [...hintedConcepts.current],
      engine,
      ...(engineDetail ? { engineDetail } : {}),
    }).catch((error: unknown) => {
      console.error("[tutor-session] Could not save chat history:", error);
      setPersistenceError("Chat history could not be saved in this browser.");
    });
  }, [
    activeCheckinId,
    checkinResults,
    conceptIndex,
    engine,
    engineDetail,
    isSessionReady,
    lessonDone,
    outcomes,
    sessionId,
    streaming,
    turns,
  ]);

  const setActiveCheckin = useCallback((id: string | null) => {
    activeCheckinIdRef.current = id;
    setActiveCheckinId(id);
  }, []);

  const runRequest = useCallback(
    async (req: TutorRequest, opts?: { echoStudentText?: string }) => {
      if (busy.current) return;
      busy.current = true;
      const requestSessionId = sessionId;
      const controller = new AbortController();
      activeController.current = controller;
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
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error(`Tutor unavailable (${res.status})`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastCheckinId: string | null = null;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (activeSessionId.current !== requestSessionId) return;
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
        if (requestSessionId === activeSessionId.current && !controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "The tutor could not respond.");
          setTurns((t) => t.filter((turn) => turn.id !== turnId));
        }
      } finally {
        if (activeController.current === controller) {
          activeController.current = null;
          busy.current = false;
          setStreaming(false);
        }
      }
    },
    [sessionId, setActiveCheckin],
  );

  const teachConcept = useCallback(
    (base: BaseRequest, index: number) => {
      void runRequest({
        mode: "concept",
        conceptIndex: index,
        mastery,
        ...base,
      });
    },
    [mastery, runRequest],
  );

  const askQuestion = useCallback(
    (base: BaseRequest, question: string) => {
      void runRequest(
        { mode: "ask", conceptIndex, question, mastery, ...base },
        { echoStudentText: question },
      );
    },
    [conceptIndex, mastery, runRequest],
  );

  const submitCheckin = useCallback(
    (base: BaseRequest, text: string) => {
      void runRequest(
        {
          mode: "check",
          conceptIndex,
          answerText: text,
          hinted: hintedConcepts.current.has(conceptIndex),
          mastery,
          ...base,
        },
        { echoStudentText: text },
      );
    },
    [conceptIndex, mastery, runRequest],
  );

  const requestNextTopic = useCallback(
    (base: BaseRequest, command: string) => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      void runRequest(
        { mode: "quiz", conceptIndex, mastery, ...base },
        { echoStudentText: command },
      );
    },
    [conceptIndex, mastery, runRequest],
  );

  const advanceAfterQuiz = useCallback(
    (isLastConcept: boolean) => {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      setActiveCheckin(null);
      autoAdvanceTimer.current = setTimeout(() => {
        if (isLastConcept) setLessonDone(true);
        else setConceptIndex((index) => index + 1);
      }, AUTO_ADVANCE_DELAY_MS);
    },
    [setActiveCheckin],
  );

  return {
    turns: isSessionReady ? turns : [],
    sessionLoaded: isSessionReady,
    persistenceError,
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
    requestNextTopic,
    advanceAfterQuiz,
  };
}

import { createFileRoute } from "@tanstack/react-router";

import {
  adaptTeachingStyle,
  defaultMastery,
  fallbackCheckPrompt,
  finalConceptExtras,
  levelInstruction,
  levelLabel,
  MATH_RULE,
  nextId,
  parseModelMarkdown,
  retryCheckPrompt,
  simulatedAsk,
  simulatedConceptTeach,
  simulatedJudge,
  splitConceptResponse,
  type TutorBlock,
  type TutorRequest,
} from "@/lib/tutor-blocks";
import type { QuizQuestion, TeachingStyle } from "@/lib/course-types";
import { TUTOR_MODEL } from "@/lib/groq";
import { hasOpenRouterKey, openRouterText } from "@/lib/openrouter";

// GPT-OSS is a reasoning model, so reasoning_format/reasoning_effort apply here.

type StreamEvent =
  | { type: "meta"; engine: string; detail?: string }
  | { type: "block"; block: TutorBlock }
  | { type: "judgement"; correct: boolean; advance: boolean }
  | { type: "done"; done: boolean };

function encodeEvent(event: StreamEvent) {
  return `${JSON.stringify(event)}\n`;
}

const EXCERPT_PROMPT_CHARS = 3200;

/** Ground each request in saved course notes, never in the archived conversation. */
function courseNotes(body: TutorRequest): string {
  const { lesson } = body;
  return [
    `SAVED COURSE NOTES: Course: ${body.courseTitle}. Module: ${body.moduleTitle}. Lesson: ${lesson.title}.`,
    `Lesson summary: ${lesson.intuition}`,
    `Learning objectives: ${lesson.objectives.join("; ")}`,
    `Concepts in course order: ${lesson.concepts.join("; ")}`,
    lesson.sourceExcerpt
      ? [
          "SOURCE EXCERPT (teach faithfully from the uploaded document; do not invent facts, numbers or citations it does not support). If a question is outside this excerpt, say so and clearly label any general-knowledge answer.",
          `"""${lesson.sourceExcerpt.slice(0, EXCERPT_PROMPT_CHARS)}"""`,
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function masteryNote(mastery: TutorRequest["mastery"]): string {
  if (mastery.streak >= 2) {
    return `The student is on a ${mastery.streak}-answer correct streak — they're moving fast. Skip basic scaffolding, but fully explain the current idea.`;
  }
  if (mastery.streak <= -2) {
    return `The student has struggled on the last ${Math.abs(mastery.streak)} check-ins. Slow down, use concrete examples, keep the tone warm and encouraging, and avoid jargon.`;
  }
  return "The student's understanding so far looks about average for this point in the lesson — keep a steady, clear pace.";
}

/**
 * Some GPT-OSS deployments have, under load, leaked their internal reasoning
 * trace into `message.content` even with reasoning_format=hidden requested
 * (a known upstream quirk). Strip anything that looks like a leaked trace
 * defensively, on top of requesting hidden reasoning in the first place.
 */
function stripReasoningArtifacts(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*(analysis|reasoning|thinking)\s*:\s*/i, "")
    .trim();
}

async function callGroq(
  apiKey: string,
  system: string,
  user: string,
  opts?: { json?: boolean; reasoningEffort?: "low" | "medium" | "high" },
): Promise<string> {
  const model = TUTOR_MODEL;
  const isReasoningModel = /gpt-oss|qwen3/i.test(model);

  const res = await fetch(
    `${process.env["GROQ_BASE_URL"] || "https://api.groq.com/openai/v1"}/chat/completions`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: opts?.json ? 0.2 : 0.4,
        ...(opts?.json ? { response_format: { type: "json_object" } } : {}),
        // GPT-OSS (and Qwen3) are reasoning models on Groq: without these, the
        // model's chain-of-thought can end up mixed into `message.content`
        // instead of the final answer, which is the most common cause of this
        // route silently looking "broken" even with a valid key.
        ...(isReasoningModel
          ? { reasoning_effort: opts?.reasoningEffort ?? "low", reasoning_format: "hidden" }
          : {}),
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq ${model} request failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Groq ${model} returned no content`);
  return stripReasoningArtifacts(content);
}

async function callTutorModel(
  system: string,
  user: string,
  opts?: { json?: boolean; reasoningEffort?: "low" | "medium" | "high" },
): Promise<{ content: string; engine: "groq" | "openrouter" }> {
  const groqKey = process.env["GROQ_API_KEY"];
  let groqFailure: string | undefined;

  if (groqKey) {
    try {
      return {
        content: await callGroq(groqKey, system, user, opts),
        engine: "groq",
      };
    } catch (error) {
      groqFailure = error instanceof Error ? error.message : String(error);
      console.warn("[api/tutor] Groq unavailable; trying NVIDIA Nemotron fallback:", groqFailure);
    }
  }

  if (!hasOpenRouterKey()) {
    throw new Error(
      groqFailure
        ? `${groqFailure}; OPENROUTER_API_KEY is not set for the fallback`
        : "GROQ_API_KEY and OPENROUTER_API_KEY are not set",
    );
  }

  try {
    return {
      content: await openRouterText(system, user, {
        ...(opts?.json ? { json: true } : {}),
        maxTokens: opts?.json ? 3500 : 5000,
      }),
      engine: "openrouter",
    };
  } catch (error) {
    const fallbackFailure = error instanceof Error ? error.message : String(error);
    throw new Error(
      groqFailure
        ? `${groqFailure}; NVIDIA Nemotron fallback failed: ${fallbackFailure}`
        : fallbackFailure,
    );
  }
}

/** Teach exactly one concept, ending (for non-final concepts) with a `CHECK:` line. */
async function aiTeachConcept(
  body: TutorRequest,
  teaching: TeachingStyle,
): Promise<{ blocks: TutorBlock[]; engine: "groq" | "openrouter" }> {
  const { lesson, conceptIndex } = body;
  const concept = lesson.concepts[conceptIndex] ?? lesson.title;
  const isFinal = conceptIndex >= lesson.concepts.length - 1;

  const system = [
    "You are Sarathi, a warm, precise 1:1 tutor teaching ONE concept at a time.",
    levelInstruction(body.level),
    MATH_RULE,
    "Never introduce or explain any concept other than the single one you are given.",
    `Teach ONLY this concept: "${concept}".`,
    `Style: depth=${teaching.depth}, tone=${teaching.tone}, pacing=${teaching.pacing}.`,
    "Explain the concept fully and clearly. Use as much detail as needed; do not cut off the explanation to meet a length limit.",
    "Focus only on the current concept and the saved course notes.",
    isFinal
      ? "This is the last concept in the lesson — a code example, diagram, and quiz will be shown right after your explanation, so do not write your own code block."
      : "After your explanation, on its own final line, write exactly: CHECK: <one short question that makes the student apply or restate this concept in their own words — never a yes/no question>.",
    masteryNote(body.mastery),
  ].join(" ");

  const user = [
    `Course: ${body.courseTitle}. Module: ${body.moduleTitle}. Lesson: ${lesson.title}.`,
    courseNotes(body),
  ]
    .filter(Boolean)
    .join("\n");

  const { content: raw, engine } = await callTutorModel(system, user, { reasoningEffort: "low" });
  const { explanation, checkPrompt } = splitConceptResponse(raw);
  const blocks = parseModelMarkdown(explanation);

  if (isFinal) {
    blocks.push(...finalConceptExtras(lesson, teaching));
    if (!lesson.quiz[0]) {
      blocks.push({
        id: nextId(),
        kind: "checkin",
        concept,
        prompt: checkPrompt ?? fallbackCheckPrompt(concept, lesson.objectives),
      });
    }
  } else {
    blocks.push({
      id: nextId(),
      kind: "checkin",
      concept,
      prompt: checkPrompt ?? fallbackCheckPrompt(concept, lesson.objectives),
    });
  }
  return { blocks, engine };
}

async function aiAsk(
  body: TutorRequest,
  teaching: TeachingStyle,
): Promise<{ blocks: TutorBlock[]; engine: "groq" | "openrouter" }> {
  const { lesson, conceptIndex } = body;
  const concept = lesson.concepts[conceptIndex] ?? lesson.concepts[0] ?? lesson.title;

  const system = [
    "You are Sarathi, a warm, precise 1:1 tutor.",
    levelInstruction(body.level),
    MATH_RULE,
    `The student is currently focused on the concept "${concept}" within the lesson "${lesson.title}".`,
    `Style: depth=${teaching.depth}, tone=${teaching.tone}, pacing=${teaching.pacing}.`,
    "Answer their question directly and completely. Use as much detail as needed; do not cut off the explanation to meet a length limit.",
    "Markdown is fine; use a fenced code block only if a short example genuinely helps, and a `mermaid` fenced block only if a diagram genuinely helps.",
    "If their question reveals a misunderstanding, gently correct it before answering.",
    masteryNote(body.mastery),
  ].join(" ");

  const user = [
    `Course: ${body.courseTitle}. Module: ${body.moduleTitle}.`,
    courseNotes(body),
    `Student question: ${body.question ?? ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { content: raw, engine } = await callTutorModel(system, user, { reasoningEffort: "low" });
  const answer = splitConceptResponse(raw).explanation || raw;
  const blocks = parseModelMarkdown(answer);
  return {
    blocks: blocks.length > 0 ? blocks : [{ id: nextId(), kind: "text", markdown: raw }],
    engine,
  };
}

async function aiJudge(
  body: TutorRequest,
): Promise<{ understood: boolean; feedback: string; engine: "groq" | "openrouter" }> {
  const { lesson, conceptIndex } = body;
  const concept = lesson.concepts[conceptIndex] ?? lesson.title;
  const hinted = !!body.hinted;

  const system = [
    "You are grading a student's short answer to a comprehension check for ONE concept, and writing the feedback they'll actually read.",
    `Write the feedback in language suited to this audience — ${levelLabel(body.level)}. ${levelInstruction(body.level)}`,
    MATH_RULE,
    "Judge generously but honestly: partial, imprecise phrasing that shows real understanding still counts as understood.",
    "If the student's answer is empty, says they don't know, or is not a real attempt, mark understood=false — do NOT ask them to guess again.",
    hinted
      ? "This is their SECOND attempt and they will move on regardless of this result. If understood=false, `feedback` must plainly state the correct idea in full (2-3 sentences) so they leave with a real answer, not just a verdict."
      : 'This is their FIRST attempt. If understood=false, `feedback` must include a real, concrete explanation of the concept (not just "not quite") so a retry has something to work from — 2-3 sentences.',
    'Respond with ONLY compact JSON, no prose, no markdown fences: {"understood": true|false, "feedback": "speak directly to the student"}.',
  ].join(" ");

  const user = [
    `Concept: ${concept}.`,
    courseNotes(body),
    `Student's answer: ${body.answerText ?? ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { content: raw, engine } = await callTutorModel(system, user, {
    json: true,
    reasoningEffort: "medium",
  });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in judge response: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { understood?: unknown; feedback?: unknown };
  if (typeof parsed.understood !== "boolean" || typeof parsed.feedback !== "string") {
    throw new Error(`Malformed judge response: ${raw.slice(0, 200)}`);
  }
  return { understood: parsed.understood, feedback: parsed.feedback, engine };
}

async function aiQuiz(
  body: TutorRequest,
): Promise<{ blocks: TutorBlock[]; engine: "groq" | "openrouter" }> {
  const concept = body.lesson.concepts[body.conceptIndex] ?? body.lesson.title;
  const { content: raw, engine } = await callTutorModel(
    [
      "You are writing a short checkpoint quiz for a student who has just studied one concept.",
      levelInstruction(body.level),
      MATH_RULE,
      `Write exactly 3 distinct multiple-choice questions about the concept "${concept}".`,
      "Use only the saved course notes; do not invent facts. Each question must have exactly four plausible options, one unambiguous correct answer, and a concise explanation that teaches the correct answer.",
      'Respond with ONLY JSON: {"questions":[{"prompt":"...","options":["...","...","...","..."],"answerIndex":0,"explanation":"..."}]}',
    ].join(" "),
    [courseNotes(body), `Current concept: ${concept}.`].join("\n"),
    { json: true, reasoningEffort: "low" },
  );
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON in quiz response");
  const parsed = JSON.parse(match[0]) as { questions?: unknown };
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 3) {
    throw new Error("Quiz response must contain exactly three questions");
  }

  const questions: QuizQuestion[] = parsed.questions.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Malformed quiz question");
    const item = value as Record<string, unknown>;
    const options = item["options"];
    const answerIndex = item["answerIndex"];
    if (
      typeof item["prompt"] !== "string" ||
      !item["prompt"].trim() ||
      !Array.isArray(options) ||
      options.length !== 4 ||
      !options.every((option) => typeof option === "string" && option.trim()) ||
      typeof answerIndex !== "number" ||
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex > 3 ||
      typeof item["explanation"] !== "string" ||
      !item["explanation"].trim()
    ) {
      throw new Error("Malformed quiz question");
    }
    return {
      id: nextId("advance-quiz"),
      kind: "multiple-choice",
      prompt: item["prompt"].trim().slice(0, 400),
      options: (options as string[]).map((option) => option.trim().slice(0, 240)),
      answerIndex,
      explanation: item["explanation"].trim().slice(0, 500),
    };
  });
  return {
    blocks: questions.map((question) => ({
      id: nextId(),
      kind: "quiz" as const,
      question,
      advance: true,
    })),
    engine,
  };
}

function simulatedQuiz(body: TutorRequest): TutorBlock[] {
  const { lesson, conceptIndex } = body;
  const concept = lesson.concepts[conceptIndex] ?? lesson.title;
  const questions: QuizQuestion[] = [];

  const authored = lesson.quiz[0];
  if (authored) {
    questions.push({
      ...authored,
      id: nextId("advance-quiz"),
      kind: "multiple-choice",
    });
  }

  const uniqueChoices = (answer: string, candidates: string[]) => {
    const choices = [answer];
    for (const candidate of candidates) {
      if (candidate.trim() && !choices.includes(candidate.trim())) choices.push(candidate.trim());
      if (choices.length === 4) break;
    }
    while (choices.length < 4) choices.push(`Another option (${choices.length + 1})`);
    return choices;
  };
  let fallbackQuestionCount = 0;
  const createFallbackQuestion = (
    prompt: string,
    answer: string,
    candidates: string[],
    explanation: string,
  ): QuizQuestion => {
    const options = uniqueChoices(answer, candidates);
    const answerIndex = fallbackQuestionCount % options.length;
    const firstOption = options[0] ?? answer;
    const correctOption = options[answerIndex] ?? answer;
    options[0] = correctOption;
    options[answerIndex] = firstOption;
    fallbackQuestionCount += 1;
    return {
      id: nextId("advance-quiz"),
      kind: "multiple-choice",
      prompt,
      options,
      answerIndex,
      explanation,
    };
  };

  questions.push(
    createFallbackQuestion(
      "Which concept are we moving on from?",
      concept,
      [...lesson.concepts.filter((item) => item !== concept), lesson.title, ...lesson.objectives],
      `The current concept is ${concept}.`,
    ),
    createFallbackQuestion(
      "Which statement is one of this lesson's learning objectives?",
      lesson.objectives[0] ?? lesson.intuition,
      [
        ...lesson.concepts.map((item) => `Study the unrelated topic: ${item}`),
        `Review the lesson titled "${lesson.title}"`,
        `Study the module "${body.moduleTitle}"`,
      ],
      `One stated learning objective is: ${lesson.objectives[0] ?? lesson.intuition}`,
    ),
  );
  const followingConcept = lesson.concepts[conceptIndex + 1];
  const orderedConcept = followingConcept ?? concept;
  questions.push(
    createFallbackQuestion(
      followingConcept
        ? "Which concept comes immediately after this one in the lesson?"
        : "Which concept are we finishing in this lesson?",
      orderedConcept,
      lesson.concepts.filter((item) => item !== orderedConcept),
      followingConcept
        ? `The lesson introduces ${followingConcept} immediately after ${concept}.`
        : `The final concept in this lesson is ${concept}.`,
    ),
  );

  return questions.slice(0, 3).map((question) => ({
    id: nextId(),
    kind: "quiz",
    question,
    advance: true,
  }));
}

export const Route = createFileRoute("/api/tutor")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: TutorRequest;
        try {
          body = (await request.json()) as TutorRequest;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (
          !body?.lesson?.title ||
          (body.mode !== "concept" &&
            body.mode !== "check" &&
            body.mode !== "ask" &&
            body.mode !== "quiz")
        ) {
          return new Response("Invalid tutor request", { status: 400 });
        }
        body.mastery = body.mastery ?? defaultMastery();
        body.level =
          body.level === "easy" || body.level === "pro" || body.level === "normal"
            ? body.level
            : "normal";

        const groqKey = process.env["GROQ_API_KEY"];
        const teaching = adaptTeachingStyle(body.teaching, body.mastery);
        const isFinal = body.conceptIndex >= body.lesson.concepts.length - 1;
        const concept = body.lesson.concepts[body.conceptIndex] ?? body.lesson.title;

        let engine = "simulated";
        let engineDetail: string | undefined;
        let blocks: TutorBlock[] = [];
        let judgement: { correct: boolean; advance: boolean } | null = null;

        if (!groqKey && !hasOpenRouterKey()) {
          engineDetail = "GROQ_API_KEY and OPENROUTER_API_KEY are not set on this server";
        } else {
          try {
            if (body.mode === "concept") {
              const result = await aiTeachConcept(body, teaching);
              blocks = result.blocks;
              engine = result.engine;
            } else if (body.mode === "ask") {
              const result = await aiAsk(body, teaching);
              blocks = result.blocks;
              engine = result.engine;
            } else if (body.mode === "quiz") {
              const result = await aiQuiz(body);
              blocks = result.blocks;
              engine = result.engine;
            } else {
              const result = await aiJudge(body);
              engine = result.engine;
              const { understood, feedback } = result;
              const advance = understood || !!body.hinted;
              blocks = [{ id: nextId(), kind: "text", markdown: feedback }];
              if (!advance) {
                blocks.push({
                  id: nextId(),
                  kind: "checkin",
                  concept,
                  prompt: retryCheckPrompt(concept),
                });
              }
              judgement = { correct: understood, advance };
            }
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(
              "[api/tutor] AI providers failed, using built-in tutor instead:",
              message,
            );
            engineDetail = message;
            blocks = [];
            judgement = null;
          }
        }

        if (engine !== "groq" && engine !== "openrouter") {
          if (body.mode === "concept") {
            blocks = simulatedConceptTeach(body, teaching);
          } else if (body.mode === "ask") {
            blocks = simulatedAsk(body);
          } else if (body.mode === "quiz") {
            blocks = simulatedQuiz(body);
          } else {
            const { understood, feedback } = simulatedJudge(
              body.lesson,
              concept,
              body.answerText ?? "",
              !!body.hinted,
            );
            const advance = understood || !!body.hinted;
            blocks = [{ id: nextId(), kind: "text", markdown: feedback }];
            if (!advance) {
              blocks.push({
                id: nextId(),
                kind: "checkin",
                concept,
                prompt: retryCheckPrompt(concept),
              });
            }
            judgement = { correct: understood, advance };
          }
        }

        const done = body.mode === "concept" ? isFinal : false;

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(
                encodeEvent({
                  type: "meta",
                  engine,
                  ...(engineDetail ? { detail: engineDetail } : {}),
                }),
              ),
            );
            for (const block of blocks) {
              await new Promise((r) => setTimeout(r, 220));
              controller.enqueue(encoder.encode(encodeEvent({ type: "block", block })));
            }
            if (judgement) {
              controller.enqueue(encoder.encode(encodeEvent({ type: "judgement", ...judgement })));
            }
            controller.enqueue(encoder.encode(encodeEvent({ type: "done", done })));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});

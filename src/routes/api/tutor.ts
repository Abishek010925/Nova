import { createFileRoute } from "@tanstack/react-router";

import {
  adaptTeachingStyle,
  capWords,
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
  wordBudget,
  type TutorBlock,
  type TutorHistoryItem,
  type TutorRequest,
} from "@/lib/tutor-blocks";
import type { TeachingStyle } from "@/lib/course-types";

// Override with a GROQ_MODEL env var if you want a different model; this is
// the current recommended Groq-hosted default. GPT-OSS models are reasoning
// models, so `reasoning_format`/`reasoning_effort` below only apply to them.
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

type StreamEvent =
  | { type: "meta"; engine: string; detail?: string }
  | { type: "block"; block: TutorBlock }
  | { type: "judgement"; correct: boolean; advance: boolean }
  | { type: "done"; done: boolean };

function encodeEvent(event: StreamEvent) {
  return `${JSON.stringify(event)}\n`;
}

function historyText(history: TutorHistoryItem[]): string {
  if (history.length === 0) return "(no prior turns yet)";
  return history
    .slice(-6)
    .map((h) => `${h.role === "tutor" ? "Tutor" : "Student"}: ${h.text.slice(0, 300)}`)
    .join("\n");
}

const EXCERPT_PROMPT_CHARS = 3200;

/** Source-grounding note: when a lesson came from an uploaded document, the tutor must teach from it. */
function sourceNote(lesson: TutorRequest["lesson"]): string {
  if (!lesson.sourceExcerpt) return "";
  return [
    "SOURCE EXCERPT (the uploaded document this lesson is built from). Teach from it, stay faithful to it, and do not invent facts, numbers or citations that it does not support.",
    "If the student asks about something the excerpt does not cover, say so briefly and answer from general knowledge, flagged as such.",
    `"""${lesson.sourceExcerpt.slice(0, EXCERPT_PROMPT_CHARS)}"""`,
  ].join("\n");
}

function masteryNote(mastery: TutorRequest["mastery"]): string {
  if (mastery.streak >= 2) {
    return `The student is on a ${mastery.streak}-answer correct streak — they're moving fast. Keep this brief, skip basic scaffolding, don't over-explain.`;
  }
  if (mastery.streak <= -2) {
    return `The student has struggled on the last ${Math.abs(mastery.streak)} check-ins. Slow down, use one concrete example, keep the tone warm and encouraging, and avoid jargon.`;
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
  const model = process.env["GROQ_MODEL"] || DEFAULT_GROQ_MODEL;
  const isReasoningModel = /gpt-oss|qwen3/i.test(model);

  const res = await fetch(`${process.env["GROQ_BASE_URL"] || "https://api.groq.com/openai/v1"}/chat/completions`, {
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
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Groq ${model} request failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error(`Groq ${model} returned no content`);
  return stripReasoningArtifacts(content);
}

/** Teach exactly one concept, ending (for non-final concepts) with a `CHECK:` line. */
async function groqTeachConcept(
  body: TutorRequest,
  teaching: TeachingStyle,
  apiKey: string,
): Promise<{ blocks: TutorBlock[] }> {
  const { lesson, conceptIndex } = body;
  const concept = lesson.concepts[conceptIndex] ?? lesson.title;
  const isFinal = conceptIndex >= lesson.concepts.length - 1;
  const budget = wordBudget(teaching.pacing, body.level);

  const system = [
    "You are Sarathi, a warm, precise 1:1 tutor teaching ONE concept at a time.",
    levelInstruction(body.level),
    MATH_RULE,
    "Never introduce or explain any concept other than the single one you are given.",
    `Teach ONLY this concept: "${concept}".`,
    `Style: depth=${teaching.depth}, tone=${teaching.tone}, pacing=${teaching.pacing}.`,
    `Hard limit: at most ${budget} words, plain prose, no headers, at most one short paragraph.`,
    "Do not restate concepts already covered in the conversation history.",
    isFinal
      ? "This is the last concept in the lesson — a code example, diagram, and quiz will be shown right after your explanation, so do not write your own code block."
      : "After your explanation, on its own final line, write exactly: CHECK: <one short question that makes the student apply or restate this concept in their own words — never a yes/no question>.",
    masteryNote(body.mastery),
  ].join(" ");

  const user = [
    `Course: ${body.courseTitle}. Module: ${body.moduleTitle}. Lesson: ${lesson.title}.`,
    `Lesson objectives: ${lesson.objectives.join("; ")}.`,
    sourceNote(lesson),
    `Recent conversation:\n${historyText(body.history)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callGroq(apiKey, system, user, { reasoningEffort: "low" });
  const { explanation, checkPrompt } = splitConceptResponse(raw);
  const blocks = parseModelMarkdown(capWords(explanation, budget));

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
  return { blocks };
}

async function groqAsk(
  body: TutorRequest,
  teaching: TeachingStyle,
  apiKey: string,
): Promise<TutorBlock[]> {
  const { lesson, conceptIndex } = body;
  const concept = lesson.concepts[conceptIndex] ?? lesson.concepts[0] ?? lesson.title;
  const budget = wordBudget(teaching.pacing, body.level);

  const system = [
    "You are Sarathi, a warm, precise 1:1 tutor.",
    levelInstruction(body.level),
    MATH_RULE,
    `The student is currently focused on the concept "${concept}" within the lesson "${lesson.title}".`,
    `Style: depth=${teaching.depth}, tone=${teaching.tone}, pacing=${teaching.pacing}.`,
    `Answer their question directly in at most ${budget} words.`,
    "Markdown is fine; use a fenced code block only if a short example genuinely helps, and a `mermaid` fenced block only if a diagram genuinely helps.",
    "If their question reveals a misunderstanding, gently correct it before answering.",
    masteryNote(body.mastery),
  ].join(" ");

  const user = [
    `Course: ${body.courseTitle}. Module: ${body.moduleTitle}.`,
    sourceNote(lesson),
    `Recent conversation:\n${historyText(body.history)}`,
    `Student question: ${body.question ?? ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callGroq(apiKey, system, user, { reasoningEffort: "low" });
  const answer = splitConceptResponse(raw).explanation || raw;
  const blocks = parseModelMarkdown(capWords(answer, budget));
  return blocks.length > 0 ? blocks : [{ id: nextId(), kind: "text", markdown: raw }];
}

async function groqJudge(
  body: TutorRequest,
  apiKey: string,
): Promise<{ understood: boolean; feedback: string }> {
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
    sourceNote(lesson),
    `Recent conversation (includes how the concept was taught):\n${historyText(body.history)}`,
    `Student's answer: ${body.answerText ?? ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await callGroq(apiKey, system, user, { json: true, reasoningEffort: "medium" });
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in judge response: ${raw.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as { understood?: unknown; feedback?: unknown };
  if (typeof parsed.understood !== "boolean" || typeof parsed.feedback !== "string") {
    throw new Error(`Malformed judge response: ${raw.slice(0, 200)}`);
  }
  return { understood: parsed.understood, feedback: parsed.feedback };
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
          (body.mode !== "concept" && body.mode !== "check" && body.mode !== "ask")
        ) {
          return new Response("Invalid tutor request", { status: 400 });
        }
        body.mastery = body.mastery ?? defaultMastery();
        body.history = Array.isArray(body.history) ? body.history : [];
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

        if (!groqKey) {
          engineDetail = "GROQ_API_KEY is not set on this server";
        } else {
          try {
            if (body.mode === "concept") {
              blocks = (await groqTeachConcept(body, teaching, groqKey)).blocks;
            } else if (body.mode === "ask") {
              blocks = await groqAsk(body, teaching, groqKey);
            } else {
              const { understood, feedback } = await groqJudge(body, groqKey);
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
            engine = "groq";
          } catch (e) {
            // This used to be swallowed silently — log it so it's visible in
            // server logs (e.g. Render's Logs tab), and surface a short
            // reason to the client too, instead of failing invisibly.
            const message = e instanceof Error ? e.message : String(e);
            console.error("[api/tutor] Groq call failed, using built-in tutor instead:", message);
            engineDetail = message;
            blocks = [];
            judgement = null;
          }
        }

        if (engine !== "groq") {
          if (body.mode === "concept") {
            blocks = simulatedConceptTeach(body, teaching);
          } else if (body.mode === "ask") {
            blocks = simulatedAsk(body, teaching);
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

import { createFileRoute } from "@tanstack/react-router";

import { groqJson, groqModel, hasGroqKey } from "@/lib/groq";

/**
 * Course generation from an uploaded document (text already extracted in the browser).
 *   action "outline" -> a full course outline mapped onto the document's chunks
 *   action "lesson"  -> the finished content for one lesson (summary, objectives, concepts, quiz)
 * Without GROQ_API_KEY these return { ok: false } and the client falls back to a
 * structure-based outline, so uploading never dead-ends.
 */

const MATH =
  "Write any mathematics in LaTeX with $...$ (inline) or $$...$$ (display). Never use \\( \\) or \\[ \\].";

type RawOutline = {
  title?: unknown;
  tagline?: unknown;
  description?: unknown;
  docType?: unknown;
  difficulty?: unknown;
  tags?: unknown;
  modules?: unknown;
};

const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strList = (v: unknown, maxItems: number, maxLen = 160): string[] =>
  Array.isArray(v)
    ? v
        .map((x) => str(x, maxLen))
        .filter(Boolean)
        .slice(0, maxItems)
    : [];

function sanitizeOutline(raw: RawOutline, chunkCount: number) {
  const modulesIn = Array.isArray(raw.modules) ? raw.modules : [];
  type L = {
    title: string;
    minutes: number;
    intuition: string;
    objectives: string[];
    concepts: string[];
    chunks: [number, number];
  };
  const modules = modulesIn
    .slice(0, 12)
    .map((m) => {
      const mm = (m ?? {}) as Record<string, unknown>;
      const lessons: L[] = (Array.isArray(mm["lessons"]) ? mm["lessons"] : [])
        .slice(0, 10)
        .map((l) => {
          const ll = (l ?? {}) as Record<string, unknown>;
          const c = Array.isArray(ll["chunks"]) ? (ll["chunks"] as unknown[]) : [];
          const a = Number(c[0]);
          const b = Number(c[1] ?? c[0]);
          return {
            title: str(ll["title"], 90) || "Untitled lesson",
            minutes: Math.min(45, Math.max(5, Math.round(Number(ll["minutes"]) || 12))),
            intuition: str(ll["intuition"], 700),
            objectives: strList(ll["objectives"], 5),
            concepts: strList(ll["concepts"], 6, 60),
            chunks: [Number.isFinite(a) ? a : 0, Number.isFinite(b) ? b : 0] as [number, number],
          };
        })
        .filter((l) => l.title);
      return { title: str(mm["title"], 90) || "Untitled module", summary: str(mm["summary"], 300), lessons };
    })
    .filter((m) => m.lessons.length > 0)
    .slice(0, 12);

  // Force contiguous, in-order, gap-free coverage of chunks 0..N-1 so nothing in the document is skipped.
  const flat = modules.flatMap((m) => m.lessons);
  let cursor = 0;
  flat.forEach((lesson, i) => {
    const isLast = i === flat.length - 1;
    const start = Math.min(cursor, chunkCount - 1);
    let end = Math.max(start, Math.min(chunkCount - 1, Math.round(lesson.chunks[1])));
    if (isLast) end = chunkCount - 1;
    if (end < start) end = start;
    lesson.chunks = [start, end];
    cursor = end + 1;
  });

  const diff = str(raw.difficulty, 20);
  return {
    title: str(raw.title, 120),
    tagline: str(raw.tagline, 200),
    description: str(raw.description, 700),
    docType: str(raw.docType, 40) || "document",
    difficulty: diff === "beginner" || diff === "advanced" ? diff : "intermediate",
    tags: strList(raw.tags, 5, 30),
    modules,
  };
}

async function buildOutline(body: {
  fileName?: string;
  map?: string;
  chunkCount?: number;
  totalChars?: number;
  pages?: number;
}) {
  const chunkCount = Math.max(1, Math.floor(body.chunkCount ?? 1));
  const system = [
    "You are an expert instructional designer. You turn ONE uploaded document (research paper, book, article, magazine, report or notes) into a complete course outline that, if a student finishes it, leaves them understanding the whole document.",
    "First decide what kind of document it is and shape the course accordingly: for a research paper use problem/background → method → experiments/results → limitations and implications; for a book follow its parts/chapters; for an article or magazine group related pieces; for notes follow their structure.",
    `The document has been split into ${chunkCount} consecutive chunks, numbered 0..${chunkCount - 1}. Every lesson MUST declare the chunk range it covers as "chunks": [startIndex, endIndex].`,
    "Lessons must be in document order and together cover every chunk with no gaps and no overlap, so no part of the document is left out.",
    `Size the course to the document: roughly one lesson per 2–4 chunks, 2–8 lessons per module, at most 40 lessons in total; a short article may be a single module of 2–4 lessons.`,
    "Each lesson needs: a specific title, minutes (5–30), a 2–3 sentence 'intuition' (what the lesson is about, in plain words), 3–4 learning 'objectives' (start with a verb), and 3–6 short 'concepts' (2–5 words each, the exact ideas the tutor will teach one at a time, in learning order).",
    "Be faithful to the document; do not invent content that is not in it.",
    MATH,
    'Respond with ONLY JSON: {"title","tagline","description","docType","difficulty":"beginner|intermediate|advanced","tags":[...],"modules":[{"title","summary","lessons":[{"title","minutes","intuition","objectives":[],"concepts":[],"chunks":[start,end]}]}]}',
  ].join(" ");

  const user = [
    `File name: ${body.fileName ?? "document"}. ${body.pages ? `Pages: ${body.pages}. ` : ""}Total characters: ${body.totalChars ?? "unknown"}.`,
    "DOCUMENT MAP (each entry is [chunk index] followed by a skim of that chunk, with any headings found):",
    (body.map ?? "").slice(0, 22_000),
  ].join("\n");

  const raw = await groqJson<RawOutline>(system, user, { effort: "medium", maxTokens: 6000 });
  const outline = sanitizeOutline(raw, chunkCount);
  if (outline.modules.length === 0) throw new Error("Model returned an outline with no lessons");
  return outline;
}

function shuffleQuiz(options: string[], answerIndex: number) {
  const order = options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { options: order.map((i) => options[i]!), answerIndex: order.indexOf(answerIndex) };
}

async function buildLesson(body: {
  courseTitle?: string;
  moduleTitle?: string;
  lessonTitle?: string;
  concepts?: string[];
  objectives?: string[];
  excerpt?: string;
}) {
  const system = [
    "You finish ONE lesson of a course that is built strictly from a source excerpt. Use only what the excerpt supports; do not invent facts, numbers or citations.",
    "Return: 'intuition' (2–3 sentences, plain language, the big idea of this lesson), 'objectives' (3–4, each starting with a verb), 'concepts' (3–6 short names, in the order they should be taught, covering the excerpt's key ideas), 'minutes' (5–30), and 'quiz': exactly one multiple-choice question that tests real understanding (not trivia) with 4 plausible options, 'answerIndex' (0–3) and a short 'explanation'.",
    MATH,
    'Respond with ONLY JSON: {"intuition","objectives":[],"concepts":[],"minutes":number,"quiz":{"prompt","options":[4 strings],"answerIndex":number,"explanation"}}',
  ].join(" ");
  const user = [
    `Course: ${body.courseTitle ?? ""}. Module: ${body.moduleTitle ?? ""}. Lesson: ${body.lessonTitle ?? ""}.`,
    `Planned concepts: ${(body.concepts ?? []).join("; ")}.`,
    `Planned objectives: ${(body.objectives ?? []).join("; ")}.`,
    `SOURCE EXCERPT:\n"""${(body.excerpt ?? "").slice(0, 5000)}"""`,
  ].join("\n");

  const raw = await groqJson<Record<string, unknown>>(system, user, { effort: "low", maxTokens: 1800 });
  const quizRaw = (raw["quiz"] ?? {}) as Record<string, unknown>;
  const options = strList(quizRaw["options"], 4, 220);
  const answerIndex = Number(quizRaw["answerIndex"]);
  let quiz: { prompt: string; options: string[]; answerIndex: number; explanation: string } | null = null;
  if (
    str(quizRaw["prompt"], 400) &&
    options.length === 4 &&
    Number.isInteger(answerIndex) &&
    answerIndex >= 0 &&
    answerIndex < 4
  ) {
    const shuffled = shuffleQuiz(options, answerIndex);
    quiz = {
      prompt: str(quizRaw["prompt"], 400),
      explanation: str(quizRaw["explanation"], 500),
      ...shuffled,
    };
  }
  return {
    intuition: str(raw["intuition"], 700),
    objectives: strList(raw["objectives"], 5),
    concepts: strList(raw["concepts"], 6, 60),
    minutes: Math.min(45, Math.max(5, Math.round(Number(raw["minutes"]) || 12))),
    quiz,
  };
}

export const Route = createFileRoute("/api/course-gen")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false, reason: "Invalid JSON" }, { status: 400 });
        }
        if (!hasGroqKey()) {
          return Response.json({ ok: false, reason: "GROQ_API_KEY is not set on this server" });
        }
        try {
          if (body["action"] === "outline") {
            const outline = await buildOutline(body as Parameters<typeof buildOutline>[0]);
            return Response.json({ ok: true, model: groqModel(), outline });
          }
          if (body["action"] === "lesson") {
            const lesson = await buildLesson(body as Parameters<typeof buildLesson>[0]);
            return Response.json({ ok: true, lesson });
          }
          return Response.json({ ok: false, reason: "Unknown action" }, { status: 400 });
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          console.error("[api/course-gen] failed:", reason);
          return Response.json({ ok: false, reason });
        }
      },
    },
  },
});

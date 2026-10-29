import type { Course, Difficulty, Lesson, Module, QuizQuestion } from "./course-types";

/**
 * Document -> course pipeline (runs in the browser; only the LLM calls hit the server).
 *   1. extractDocument()   PDF / txt / md -> pages of text
 *   2. chunkPages()        pages -> ~4.5k-char chunks (page-aware)
 *   3. outline             AI via /api/course-gen, or a structure-based fallback
 *   4. lessons             each lesson is grounded in its own slice of the document and
 *                          completed (summary, objectives, concepts, quiz) by the AI
 */

export type ExtractedDoc = {
  fileName: string;
  kind: "pdf" | "text";
  pages: string[];
  chars: number;
};

export type Chunk = { index: number; text: string; pageStart: number; pageEnd: number };

export const MAX_CHARS = 700_000;
const CHUNK_CHARS = 4500;
const EXCERPT_CHARS = 4200;

function slug(text: string) {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 36) || "course"
  );
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function cleanPageText(text: string): string {
  return text
    .replace(/\u00ad/g, "")
    .replace(/(\w)-\n(\w)/g, "$1$2") // re-join hyphenated line breaks
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractDocument(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<ExtractedDoc> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    const text = cleanPageText(await file.text());
    // Treat form feeds as page breaks; otherwise group paragraphs into virtual pages.
    const pages = text.includes("\f")
      ? text.split("\f").map(cleanPageText).filter(Boolean)
      : groupParagraphs(text, 3000);
    return { fileName: file.name, kind: "text", pages, chars: text.length };
  }

  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const pdf = await task.promise;
  const pages: string[] = [];
  let chars = 0;
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let out = "";
    let lastY: number | null = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform?.[5] as number | undefined;
      // A noticeable vertical jump is a new line; a bigger one is a new paragraph.
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
        out += Math.abs(y - lastY) > 20 ? "\n\n" : "\n";
      } else if (out && !out.endsWith(" ") && !item.str.startsWith(" ")) {
        out += " ";
      }
      out += item.str;
      if (y !== undefined) lastY = y;
    }
    const cleaned = cleanPageText(out);
    pages.push(cleaned);
    chars += cleaned.length;
    onProgress?.(i, pdf.numPages);
    if (chars > MAX_CHARS) break;
  }
  await task.destroy();
  return { fileName: file.name, kind: "pdf", pages, chars };
}

export function docFromText(fileName: string, text: string): ExtractedDoc {
  const cleaned = cleanPageText(text);
  return { fileName, kind: "text", pages: groupParagraphs(cleaned, 3000), chars: cleaned.length };
}

function groupParagraphs(text: string, size: number): string[] {
  const paras = text.split(/\n{2,}/);
  const pages: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > size) {
      pages.push(cur.trim());
      cur = "";
    }
    cur += `${p}\n\n`;
  }
  if (cur.trim()) pages.push(cur.trim());
  return pages;
}

export function chunkPages(pages: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buf = "";
  let start = 1;
  const flush = (end: number) => {
    if (!buf.trim()) return;
    chunks.push({ index: chunks.length, text: buf.trim(), pageStart: start, pageEnd: end });
    buf = "";
  };
  pages.forEach((page, i) => {
    if (!page) return;
    if (!buf) start = i + 1;
    buf += `${page}\n\n`;
    if (buf.length >= CHUNK_CHARS) flush(i + 1);
  });
  flush(pages.length);
  return chunks;
}

const HEADING_RE =
  /^(?:(?:chapter|part|section)\s+[\divxlc]+[.:)]?\s+.+|\d{1,2}(?:\.\d{1,2}){0,2}[.)]?\s+[A-Z][^.!?]{2,80}|[A-Z][A-Za-z0-9 ,:'’&-]{3,70})$/;

export function headingCandidates(text: string, max = 6): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length < 4 || line.length > 80) continue;
    if (/[.!?;,]$/.test(line)) continue;
    const words = line.split(/\s+/).length;
    if (words > 10) continue;
    if (HEADING_RE.test(line) && (/^\d|^(chapter|part|section)\b/i.test(line) || words <= 7)) {
      if (/^[A-Z]/.test(line) || /^\d/.test(line)) out.push(line);
    }
    if (out.length >= max) break;
  }
  return out;
}

/** A budgeted skim of the whole document, so the outline model sees every part of it. */
export function buildDocumentMap(chunks: Chunk[], budget = 16_000): string {
  const per = Math.max(140, Math.floor(budget / Math.max(1, chunks.length)));
  return chunks
    .map((c) => {
      const heads = headingCandidates(c.text, 4);
      const snippet = c.text.replace(/\s+/g, " ").slice(0, per);
      return `[${c.index}] (p${c.pageStart}${c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ""})${
        heads.length ? ` HEADINGS: ${heads.join(" | ")}` : ""
      } ${snippet}`;
    })
    .join("\n");
}

type OutlineLesson = {
  title: string;
  minutes: number;
  intuition: string;
  objectives: string[];
  concepts: string[];
  chunks: [number, number];
};
export type Outline = {
  title: string;
  tagline: string;
  description: string;
  docType: string;
  difficulty: Difficulty;
  tags: string[];
  modules: Array<{ title: string; summary: string; lessons: OutlineLesson[] }>;
};

function firstSentences(text: string, n: number, max = 260) {
  const s = text.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).filter((x) => x.length > 25);
  return s.slice(0, n).join(" ").slice(0, max);
}

function keyTerms(text: string, n: number): string[] {
  const stop = new Set(
    "this that with from have were which their there these those about would could should into than then also such other more most some many each when what where while using used based data between within over under they them been being does done will shall because however therefore thus".split(
      " ",
    ),
  );
  const freq = new Map<string, number>();
  for (const w of text.toLowerCase().match(/[a-z][a-z-]{4,}/g) ?? []) {
    if (stop.has(w)) continue;
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([w]) => w.charAt(0).toUpperCase() + w.slice(1));
}

/** Used when no AI key is configured or the AI call fails: groups chunks by detected headings. */
export function structureOutline(doc: ExtractedDoc, chunks: Chunk[]): Outline {
  const title = (
    doc.pages[0]?.split("\n").find((l) => l.trim().length > 6 && l.trim().length < 120) ??
    doc.fileName.replace(/\.[a-z0-9]+$/i, "")
  )
    .trim()
    .slice(0, 100);

  const perLesson = chunks.length <= 3 ? 1 : chunks.length <= 12 ? 2 : 3;
  const lessons: OutlineLesson[] = [];
  for (let i = 0; i < chunks.length; i += perLesson) {
    const slice = chunks.slice(i, i + perLesson);
    const text = slice.map((c) => c.text).join("\n");
    const heads = headingCandidates(text, 3);
    const concepts = (heads.length >= 3 ? heads : [...heads, ...keyTerms(text, 5 - heads.length)])
      .map((h) => h.replace(/^\d+(\.\d+)*[.)]?\s*/, "").slice(0, 50))
      .slice(0, 5);
    lessons.push({
      title: (heads[0]?.replace(/^\d+(\.\d+)*[.)]?\s*/, "") ?? `Part ${lessons.length + 1}`).slice(0, 80),
      minutes: Math.min(30, Math.max(8, Math.round(text.length / 900))),
      intuition: firstSentences(text, 2) || "A section of the uploaded document.",
      objectives: concepts.slice(0, 3).map((c) => `Explain ${c}`),
      concepts,
      chunks: [slice[0]!.index, slice[slice.length - 1]!.index],
    });
  }
  const perModule = 4;
  const modules: Outline["modules"] = [];
  for (let i = 0; i < lessons.length; i += perModule) {
    const group = lessons.slice(i, i + perModule);
    modules.push({
      title: lessons.length <= perModule ? title : `Part ${modules.length + 1}: ${group[0]!.title}`.slice(0, 90),
      summary: group.map((l) => l.title).join(" · ").slice(0, 200),
      lessons: group,
    });
  }
  return {
    title,
    tagline: `A guided course built from ${doc.fileName}`,
    description: firstSentences(chunks[0]?.text ?? "", 3, 400),
    docType: "document",
    difficulty: "intermediate",
    tags: keyTerms(chunks.map((c) => c.text).join(" ").slice(0, 20_000), 3),
    modules,
  };
}

async function post<T>(payload: unknown): Promise<T> {
  const res = await fetch("/api/course-gen", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Course generator unavailable (${res.status})`);
  return (await res.json()) as T;
}

function excerptFor(chunks: Chunk[], range: [number, number]): { text: string; ref: string } {
  const slice = chunks.slice(range[0], range[1] + 1);
  const full = slice.map((c) => c.text).join("\n\n");
  const ps = slice[0]?.pageStart ?? 1;
  const pe = slice[slice.length - 1]?.pageEnd ?? ps;
  return {
    text: full.slice(0, EXCERPT_CHARS),
    ref: ps === pe ? `p. ${ps}` : `pp. ${ps}–${pe}`,
  };
}

export type GenerateProgress = { stage: "outline" | "lessons" | "done"; done: number; total: number; note?: string };

export type GenerateResult = {
  course: Course;
  usedAi: boolean;
  warnings: string[];
};

export async function generateCourse(
  doc: ExtractedDoc,
  opts: { publish: boolean; onProgress?: (p: GenerateProgress) => void },
): Promise<GenerateResult> {
  const warnings: string[] = [];
  const chunks = chunkPages(doc.pages);
  if (chunks.length === 0) throw new Error("No readable text found. Scanned PDFs (images only) are not supported yet.");

  opts.onProgress?.({ stage: "outline", done: 0, total: 1, note: "Reading the document and planning the course…" });

  let outline: Outline | null = null;
  let usedAi = false;
  try {
    const res = await post<{ ok: boolean; reason?: string; outline?: Outline }>({
      action: "outline",
      fileName: doc.fileName,
      map: buildDocumentMap(chunks),
      chunkCount: chunks.length,
      totalChars: doc.chars,
      pages: doc.kind === "pdf" ? doc.pages.length : undefined,
    });
    if (res.ok && res.outline) {
      outline = res.outline;
      usedAi = true;
    } else {
      warnings.push(`AI outline unavailable (${res.reason ?? "unknown"}); built the outline from the document's structure instead.`);
    }
  } catch (e) {
    warnings.push(`AI outline failed (${e instanceof Error ? e.message : "error"}); built the outline from the document's structure instead.`);
  }
  if (!outline) outline = structureOutline(doc, chunks);

  const courseId = `${slug(outline.title || doc.fileName)}-${uid()}`;
  const total = outline.modules.reduce((n, m) => n + m.lessons.length, 0);
  let done = 0;
  let lessonFailures = 0;

  const modules: Module[] = [];
  for (const [mi, m] of outline.modules.entries()) {
    const lessons: Lesson[] = [];
    for (const [li, l] of m.lessons.entries()) {
      const id = `${courseId}-m${mi + 1}-l${li + 1}`;
      const { text, ref } = excerptFor(chunks, l.chunks);
      let lesson: Lesson = {
        id,
        title: l.title,
        minutes: l.minutes,
        intuition: l.intuition,
        objectives: l.objectives,
        concepts: l.concepts.length ? l.concepts : [l.title],
        codeExamples: [],
        quiz: [],
        sourceExcerpt: text,
        sourceRef: ref,
      };
      opts.onProgress?.({ stage: "lessons", done, total, note: `Writing lesson ${done + 1} of ${total}: ${l.title}` });

      if (usedAi && lessonFailures < 3) {
        try {
          const res = await post<{
            ok: boolean;
            lesson?: {
              intuition: string;
              objectives: string[];
              concepts: string[];
              minutes: number;
              quiz: Omit<QuizQuestion, "id" | "kind"> | null;
            };
          }>({
            action: "lesson",
            courseTitle: outline.title,
            moduleTitle: m.title,
            lessonTitle: l.title,
            concepts: l.concepts,
            objectives: l.objectives,
            excerpt: text,
          });
          if (res.ok && res.lesson) {
            const r = res.lesson;
            lesson = {
              ...lesson,
              intuition: r.intuition || lesson.intuition,
              objectives: r.objectives.length ? r.objectives : lesson.objectives,
              concepts: r.concepts.length ? r.concepts : lesson.concepts,
              minutes: r.minutes || lesson.minutes,
              quiz: r.quiz ? [{ ...r.quiz, id: `${id}-q1`, kind: "multiple-choice" }] : [],
            };
          } else {
            lessonFailures++;
          }
        } catch {
          lessonFailures++;
        }
      }
      lessons.push(lesson);
      done++;
    }
    modules.push({ id: `${courseId}-m${mi + 1}`, title: m.title, summary: m.summary, lessons });
  }
  if (lessonFailures > 0) {
    warnings.push(
      `${lessonFailures >= 3 ? "Some" : lessonFailures} lesson(s) could not be enriched by the AI (rate limit or error) and kept their outline-level content; the tutor still teaches them from the source text.`,
    );
  }

  const course: Course = {
    id: courseId,
    title: outline.title || doc.fileName.replace(/\.[a-z0-9]+$/i, ""),
    tagline: outline.tagline,
    description: outline.description,
    difficulty: outline.difficulty,
    status: opts.publish ? "published" : "draft",
    tags: outline.tags,
    teaching: { depth: "balanced", tone: "encouraging", pacing: "balanced", enforceQuizzes: false, defaultLevel: "normal" },
    modules,
    source: {
      fileName: doc.fileName,
      kind: outline.docType,
      ...(doc.kind === "pdf" ? { pages: doc.pages.length } : {}),
      chars: doc.chars,
      generatedBy: usedAi ? "ai" : "structure",
      createdAt: Date.now(),
    },
  };
  opts.onProgress?.({ stage: "done", done: total, total });
  return { course, usedAi, warnings };
}

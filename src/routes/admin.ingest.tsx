import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/lib/app-store";
import type { Course } from "@/lib/course-types";
import {
  docFromText,
  extractDocument,
  generateCourse,
  type ExtractedDoc,
  type GenerateProgress,
} from "@/lib/doc-ingest";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/ingest")({
  head: () => ({
    meta: [
      { title: "Create a course from a document — Sarathi AI Tutor" },
      {
        name: "description",
        content:
          "Upload a PDF or text file (research paper, book, article, magazine) and Sarathi builds a complete, editable course from it.",
      },
      { property: "og:title", content: "Create a course from a document — Sarathi AI Tutor" },
      {
        property: "og:description",
        content:
          "Upload a PDF or text and get a complete course outline and lessons automatically.",
      },
    ],
  }),
  component: Ingest,
});

type Phase =
  | { kind: "idle" }
  | { kind: "working"; label: string; done: number; total: number }
  | { kind: "error"; message: string }
  | {
      kind: "done";
      course: Course;
      usedAi: boolean;
      warnings: string[];
      appended: boolean;
    };

const NEW = "__new__";

function Ingest() {
  const { courses, addCourse, updateCourse } = useAppStore();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [publish, setPublish] = useState(true);
  const [target, setTarget] = useState<string>(NEW);
  const [pasted, setPasted] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = phase.kind === "working";

  const run = useCallback(
    async (getDoc: () => Promise<ExtractedDoc>) => {
      try {
        setPhase({ kind: "working", label: "Extracting text…", done: 0, total: 1 });
        const doc = await getDoc();
        if (doc.chars < 200) {
          throw new Error(
            "Almost no text was found. If this is a scanned PDF (pictures of pages), it needs OCR first.",
          );
        }
        const onProgress = (p: GenerateProgress) =>
          setPhase({
            kind: "working",
            label: p.note ?? "Working…",
            done: p.done,
            total: Math.max(1, p.total),
          });
        const result = await generateCourse(doc, { publish, onProgress });
        const appended = target !== NEW && courses.some((c) => c.id === target);
        if (appended) {
          updateCourse(target, (c) => ({
            ...c,
            modules: [...c.modules, ...result.course.modules],
          }));
        } else {
          addCourse(result.course);
        }
        toast.success(appended ? "Modules added to the course" : "Course created", {
          description: `Outline built with ${result.outlineModel}.`,
          duration: 3000,
        });
        setPhase({
          kind: "done",
          course: appended
            ? (courses.find((c) => c.id === target) ?? result.course)
            : result.course,
          usedAi: result.usedAi,
          warnings: result.warnings,
          appended,
        });
      } catch (e) {
        setPhase({
          kind: "error",
          message: e instanceof Error ? e.message : "Something went wrong.",
        });
      }
    },
    [addCourse, courses, publish, target, updateCourse],
  );

  const onFile = (file: File | undefined) => {
    if (!file || busy) return;
    if (file.size > 40 * 1024 * 1024) {
      toast.error("That file is over 40 MB. Split it and upload the parts you need.");
      return;
    }
    void run(() =>
      extractDocument(file, (done, total) =>
        setPhase({ kind: "working", label: `Reading page ${done} of ${total}…`, done, total }),
      ),
    );
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold sm:text-4xl">Create a course from a document</h1>
      <p className="mt-2 text-muted-foreground">
        Upload a research paper, book, article, magazine or notes as a PDF or text file. Sarathi
        reads it, plans the outline, writes every lesson and quiz, and teaches from the document
        itself. You can edit anything afterwards.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "mt-8 flex flex-col items-center rounded-2xl border-2 border-dashed p-10 text-center transition-colors",
          dragging ? "border-primary bg-accent/50" : "border-border bg-card/60",
          busy && "pointer-events-none opacity-60",
        )}
      >
        <UploadCloud className="size-9 text-primary" />
        <p className="mt-3 font-serif text-lg font-semibold">Drop a PDF or text file here</p>
        <p className="mt-1 text-sm text-muted-foreground">.pdf, .txt or .md · up to 40 MB</p>
        <Button className="mt-4" onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileText className="mr-2 size-4" /> Choose file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          className="hidden"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      <details className="mt-4 rounded-xl border border-border bg-card/60 px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium">Or paste text instead</summary>
        <Textarea
          rows={8}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="Paste an article, lecture notes, a transcript…"
          className="mt-3 text-sm"
        />
        <Button
          className="mt-3"
          size="sm"
          disabled={busy || pasted.trim().length < 200}
          onClick={() => void run(async () => docFromText("Pasted text", pasted))}
        >
          <Sparkles className="mr-2 size-4" /> Generate course
        </Button>
      </details>

      <div className="mt-6 grid gap-4 rounded-xl border border-border bg-card/60 p-4 sm:grid-cols-2">
        <div>
          <p className="text-sm font-medium">Where should it go?</p>
          <Select value={target} onValueChange={setTarget} disabled={busy}>
            <SelectTrigger className="mt-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW}>A new course (recommended)</SelectItem>
              {courses.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  Add as modules to: {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">Publish right away</p>
            <p className="text-xs text-muted-foreground">Turn off to keep it as a draft</p>
          </div>
          <Switch checked={publish} onCheckedChange={setPublish} disabled={busy} />
        </div>
      </div>

      {phase.kind === "working" && (
        <div className="mt-6 rounded-xl border border-border bg-card p-5" role="status">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-primary" /> {phase.label}
          </p>
          <Progress className="mt-3" value={(phase.done / phase.total) * 100} />
        </div>
      )}

      {phase.kind === "error" && (
        <p className="mt-6 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {phase.message}
        </p>
      )}

      {phase.kind === "done" && (
        <div className="mt-6 rounded-xl border border-chart-2/50 bg-chart-2/10 p-5">
          <p className="flex items-center gap-2 font-serif text-lg font-semibold">
            <CheckCircle2 className="size-5 text-chart-2" />
            {phase.appended ? "Modules added" : "Your course is ready"}
          </p>
          <p className="mt-1 text-sm">
            <span className="font-medium">{phase.course.title}</span> ·{" "}
            {phase.course.modules.length} modules ·{" "}
            {phase.course.modules.reduce((n, m) => n + m.lessons.length, 0)} lessons
            {phase.usedAi ? "" : " · outline built from document structure (native fallback)"}
          </p>
          {phase.warnings.map((w) => (
            <p key={w} className="mt-2 flex gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {w}
            </p>
          ))}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/admin/courses/$courseId" params={{ courseId: phase.course.id }}>
                Review &amp; edit outline
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/catalog">See it in the catalog</Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  EXPLAIN_LEVELS,
  type Course,
  type CourseStatus,
  type ExplainLevel,
  type Lesson,
  type Module,
  type TeachingStyle,
} from "@/lib/course-types";

export const Route = createFileRoute("/admin/courses/$courseId")({
  head: () => ({
    meta: [
      { title: "Outline builder — Sarathi AI Tutor" },
      {
        name: "description",
        content:
          "Build the course outline: reorder modules and lessons, edit objectives, concepts and teaching style.",
      },
      { property: "og:title", content: "Outline builder — Sarathi AI Tutor" },
      {
        property: "og:description",
        content: "Reorder modules and lessons and tune how the AI tutor teaches them.",
      },
    ],
  }),
  component: Builder,
});

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}

function Builder() {
  const { courseId } = Route.useParams();
  const { courses, updateCourse, hydrated } = useAppStore();
  const course = courses.find((c) => c.id === courseId);

  if (!course) {
    if (!hydrated) return <div className="p-10 text-sm text-muted-foreground">Loading…</div>;
    throw notFound();
  }

  const patch = (update: (c: Course) => Course) => updateCourse(course.id, update);

  const patchModule = (moduleId: string, update: (m: Module) => Module) =>
    patch((c) => ({ ...c, modules: c.modules.map((m) => (m.id === moduleId ? update(m) : m)) }));

  const patchLesson = (moduleId: string, lessonId: string, update: (l: Lesson) => Lesson) =>
    patchModule(moduleId, (m) => ({
      ...m,
      lessons: m.lessons.map((l) => (l.id === lessonId ? update(l) : l)),
    }));

  const setTeaching = <K extends keyof TeachingStyle>(key: K, value: TeachingStyle[K]) =>
    patch((c) => ({ ...c, teaching: { ...c.teaching, [key]: value } }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <Link to="/admin" className="text-xs text-muted-foreground hover:text-foreground">
        ← Back to studio
      </Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Input
            value={course.title}
            onChange={(e) => patch((c) => ({ ...c, title: e.target.value }))}
            className="h-auto border-none bg-transparent px-0 font-serif !text-3xl font-semibold shadow-none focus-visible:ring-0"
          />
          <Input
            value={course.tagline}
            onChange={(e) => patch((c) => ({ ...c, tagline: e.target.value }))}
            className="mt-1 border-none bg-transparent px-0 text-muted-foreground shadow-none focus-visible:ring-0"
          />
        </div>
        <Select
          value={course.status}
          onValueChange={(value) => patch((c) => ({ ...c, status: value as CourseStatus }))}
        >
          <SelectTrigger className="w-36 capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["draft", "published", "archived"] as const).map((s) => (
              <SelectItem key={s} value={s} className="capitalize">
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {course.source && (
        <p className="mt-4 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Generated from <span className="font-medium text-foreground">{course.source.fileName}</span>{" "}
          ({course.source.kind}
          {course.source.pages ? `, ${course.source.pages} pages` : ""}) ·{" "}
          {course.source.generatedBy === "ai" ? "AI-planned outline" : "structure-based outline"}. Edit
          anything below; the tutor teaches from each lesson's source text.
        </p>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Teaching style</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <Label className="text-xs">Default explanation level</Label>
            <Select
              value={course.teaching.defaultLevel ?? "normal"}
              onValueChange={(v) => setTeaching("defaultLevel", v as ExplainLevel)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPLAIN_LEVELS.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.label} — {l.audience}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">Students can still switch.</p>
          </div>
          <StyleSelect
            label="Depth"
            value={course.teaching.depth}
            options={["overview", "balanced", "deep-dive"]}
            onChange={(v) => setTeaching("depth", v as TeachingStyle["depth"])}
          />
          <StyleSelect
            label="Tone"
            value={course.teaching.tone}
            options={["neutral", "encouraging", "socratic"]}
            onChange={(v) => setTeaching("tone", v as TeachingStyle["tone"])}
          />
          <StyleSelect
            label="Pacing"
            value={course.teaching.pacing}
            options={["slow", "balanced", "brisk"]}
            onChange={(v) => setTeaching("pacing", v as TeachingStyle["pacing"])}
          />
          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">Enforce quizzes</p>
              <p className="text-xs text-muted-foreground">Block completion until passed</p>
            </div>
            <Switch
              checked={course.teaching.enforceQuizzes}
              onCheckedChange={(checked) => setTeaching("enforceQuizzes", checked)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Outline</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const id = `mod-${Date.now().toString(36)}`;
            patch((c) => ({
              ...c,
              modules: [
                ...c.modules,
                { id, title: "New module", summary: "What this module covers", lessons: [] },
              ],
            }));
            toast.success("Module added");
          }}
        >
          <Plus className="mr-2 size-4" /> Add module
        </Button>
      </div>

      <div className="mt-4 space-y-5">
        {course.modules.map((module, moduleIndex) => (
          <Card key={module.id}>
            <CardHeader className="gap-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    value={module.title}
                    onChange={(e) => patchModule(module.id, (m) => ({ ...m, title: e.target.value }))}
                    className="font-medium"
                  />
                  <Input
                    value={module.summary}
                    onChange={(e) =>
                      patchModule(module.id, (m) => ({ ...m, summary: e.target.value }))
                    }
                    className="mt-2 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move module up"
                    onClick={() =>
                      patch((c) => ({ ...c, modules: move(c.modules, moduleIndex, moduleIndex - 1) }))
                    }
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move module down"
                    onClick={() =>
                      patch((c) => ({ ...c, modules: move(c.modules, moduleIndex, moduleIndex + 1) }))
                    }
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete module"
                    onClick={() =>
                      patch((c) => ({ ...c, modules: c.modules.filter((m) => m.id !== module.id) }))
                    }
                  >
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {module.lessons.map((lesson, lessonIndex) => (
                <div key={lesson.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-start gap-2">
                    <Input
                      value={lesson.title}
                      onChange={(e) =>
                        patchLesson(module.id, lesson.id, (l) => ({ ...l, title: e.target.value }))
                      }
                      className="flex-1 font-medium"
                    />
                    <Badge variant="secondary">{lesson.minutes} min</Badge>
                    {lesson.sourceRef && <Badge variant="outline">{lesson.sourceRef}</Badge>}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Move lesson up"
                      onClick={() =>
                        patchModule(module.id, (m) => ({
                          ...m,
                          lessons: move(m.lessons, lessonIndex, lessonIndex - 1),
                        }))
                      }
                    >
                      <ArrowUp className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Move lesson down"
                      onClick={() =>
                        patchModule(module.id, (m) => ({
                          ...m,
                          lessons: move(m.lessons, lessonIndex, lessonIndex + 1),
                        }))
                      }
                    >
                      <ArrowDown className="size-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete lesson"
                      onClick={() =>
                        patchModule(module.id, (m) => ({
                          ...m,
                          lessons: m.lessons.filter((l) => l.id !== lesson.id),
                        }))
                      }
                    >
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Objectives (one per line)</Label>
                      <Textarea
                        rows={3}
                        className="mt-1 text-sm"
                        value={lesson.objectives.join("\n")}
                        onChange={(e) =>
                          patchLesson(module.id, lesson.id, (l) => ({
                            ...l,
                            objectives: e.target.value.split("\n"),
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Key concepts (comma separated)</Label>
                      <Textarea
                        rows={3}
                        className="mt-1 text-sm"
                        value={lesson.concepts.join(", ")}
                        onChange={(e) =>
                          patchLesson(module.id, lesson.id, (l) => ({
                            ...l,
                            concepts: e.target.value.split(",").map((c) => c.trim()),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <Label className="text-xs">Summary shown to the student</Label>
                    <Textarea
                      rows={2}
                      className="mt-1 text-sm"
                      value={lesson.intuition}
                      onChange={(e) =>
                        patchLesson(module.id, lesson.id, (l) => ({ ...l, intuition: e.target.value }))
                      }
                    />
                  </div>
                  {lesson.sourceExcerpt !== undefined && (
                    <details className="mt-3">
                      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                        Source text the tutor teaches from
                      </summary>
                      <Textarea
                        rows={6}
                        className="mt-2 font-mono text-xs"
                        value={lesson.sourceExcerpt}
                        onChange={(e) =>
                          patchLesson(module.id, lesson.id, (l) => ({
                            ...l,
                            sourceExcerpt: e.target.value,
                          }))
                        }
                      />
                    </details>
                  )}
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const id = `les-${Date.now().toString(36)}`;
                  patchModule(module.id, (m) => ({
                    ...m,
                    lessons: [
                      ...m.lessons,
                      {
                        id,
                        title: "New lesson",
                        minutes: 12,
                        intuition: "Describe the core intuition for this lesson.",
                        objectives: [],
                        concepts: [],
                        codeExamples: [],
                        quiz: [],
                      },
                    ],
                  }));
                }}
              >
                <Plus className="mr-2 size-4" /> Add lesson
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StyleSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="mt-1 capitalize">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option} className="capitalize">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

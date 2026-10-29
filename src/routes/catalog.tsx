import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Layers, PlayCircle } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppStore } from "@/lib/app-store";
import { countLessons, flattenLessons } from "@/lib/course-types";

export const Route = createFileRoute("/catalog")({
  head: () => ({
    meta: [
      { title: "Course catalog — Sarathi AI Tutor" },
      {
        name: "description",
        content:
          "Browse AI-tutored courses on distributed systems, Python algorithms and SQL, and enroll in one click.",
      },
      { property: "og:title", content: "Course catalog — Sarathi AI Tutor" },
      {
        property: "og:description",
        content: "Browse AI-tutored programming courses and enroll in one click.",
      },
    ],
  }),
  component: Catalog,
});

function ProgressRing({ value }: { value: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 44 44" className="size-11 -rotate-90">
      <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-muted" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c - (c * value) / 100}
        className="text-primary transition-all"
      />
    </svg>
  );
}

function Catalog() {
  const { courses, enrollmentFor, enroll, progressFor } = useAppStore();
  const published = courses.filter((c) => c.status !== "archived");

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold sm:text-4xl">Course catalog</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        Every course is taught by the Sarathi tutor: explanations, live diagrams, runnable examples
        and checkpoint quizzes that gate your progress.
      </p>

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {published.map((course) => {
          const enrollment = enrollmentFor(course.id);
          const lessons = flattenLessons(course);
          const first =
            lessons.find((l) => l.lessonId === enrollment?.lastLessonId) ?? lessons[0]!;
          return (
            <Card key={course.id} className="flex flex-col">
              <CardHeader className="gap-3">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-lg leading-snug">{course.title}</CardTitle>
                  {enrollment ? (
                    <div className="relative shrink-0">
                      <ProgressRing value={progressFor(course.id)} />
                      <span className="absolute inset-0 grid place-items-center text-[10px] font-semibold">
                        {progressFor(course.id)}%
                      </span>
                    </div>
                  ) : (
                    <Badge variant="secondary" className="capitalize">
                      {course.difficulty}
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{course.description}</p>
              </CardHeader>
              <CardContent className="mt-auto space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {course.tags.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-[11px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Layers className="size-3.5" /> {course.modules.length} modules
                  </span>
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="size-3.5" /> {countLessons(course)} lessons
                  </span>
                </div>
                {enrollment ? (
                  <Button asChild size="sm" className="w-full">
                    <Link
                      to="/learn/$courseId/$lessonId"
                      params={{ courseId: course.id, lessonId: first.lessonId }}
                    >
                      <PlayCircle className="mr-2 size-4" /> Continue learning
                    </Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      enroll(course.id);
                      toast.success(`Enrolled in ${course.title}`);
                    }}
                  >
                    Enroll
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

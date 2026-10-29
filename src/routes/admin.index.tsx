import { createFileRoute, Link } from "@tanstack/react-router";
import { PenLine, Users, Wand2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/lib/app-store";
import { countLessons } from "@/lib/course-types";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Course studio — Sarathi AI Tutor" },
      {
        name: "description",
        content:
          "Admin studio: manage course states, enrollments, completion rates and quiz averages.",
      },
      { property: "og:title", content: "Course studio — Sarathi AI Tutor" },
      {
        property: "og:description",
        content: "Manage courses, enrollments and teaching style from the Sarathi studio.",
      },
    ],
  }),
  component: AdminStudio,
});

export function statusVariant(status: string) {
  if (status === "published") return "default" as const;
  if (status === "draft") return "secondary" as const;
  return "outline" as const;
}

function AdminStudio() {
  const { courses, enrollments, progressFor, quizAverage } = useAppStore();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold sm:text-4xl">Course studio</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Shape the curriculum and how Sarathi teaches it — outline, objectives, key concepts and
            teaching style.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/ingest">
            <Wand2 className="mr-2 size-4" /> New course from document
          </Link>
        </Button>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-6">
            <div className="text-2xl font-semibold">{courses.length}</div>
            <p className="text-xs text-muted-foreground">
              {courses.filter((c) => c.status === "published").length} published ·{" "}
              {courses.filter((c) => c.status === "draft").length} draft
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <div className="text-2xl font-semibold">{enrollments.length}</div>
            <p className="text-xs text-muted-foreground">Total enrollments</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-6">
            <div className="text-2xl font-semibold">
              {quizAverage() === null ? "—" : `${quizAverage()}%`}
            </div>
            <p className="text-xs text-muted-foreground">Quiz average across cohort</p>
          </CardContent>
        </Card>
      </div>

      <h2 className="mt-12 text-xl font-semibold">Courses</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {courses.map((course) => {
          const enrolled = enrollments.filter((e) => e.courseId === course.id).length;
          return (
            <Card key={course.id}>
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-lg">{course.title}</CardTitle>
                  <Badge variant={statusVariant(course.status)} className="capitalize">
                    {course.status}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{course.tagline}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>{course.modules.length} modules</span>
                  <span>{countLessons(course)} lessons</span>
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" /> {enrolled} enrolled
                  </span>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Average completion</span>
                    <span>{progressFor(course.id)}%</span>
                  </div>
                  <Progress className="mt-2" value={progressFor(course.id)} />
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/admin/courses/$courseId" params={{ courseId: course.id }}>
                    <PenLine className="mr-2 size-4" /> Edit outline
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

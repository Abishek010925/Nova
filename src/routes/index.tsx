import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock, Compass, Sparkles, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/lib/app-store";
import { countLessons, flattenLessons } from "@/lib/course-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Your learning dashboard — Sarathi AI Tutor" },
      {
        name: "description",
        content:
          "Track course progress, quiz averages and resume your last lesson with the Sarathi AI tutor.",
      },
      { property: "og:title", content: "Your learning dashboard — Sarathi AI Tutor" },
      {
        property: "og:description",
        content: "Track progress, quiz averages and resume lessons with your AI tutor.",
      },
    ],
  }),
  component: Dashboard,
});

function relative(ts: number) {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function Dashboard() {
  const { courses, enrollments, progressFor, quizAverage } = useAppStore();
  const active = enrollments
    .map((e) => ({ enrollment: e, course: courses.find((c) => c.id === e.courseId) }))
    .filter((x): x is { enrollment: typeof x.enrollment; course: NonNullable<typeof x.course> } =>
      Boolean(x.course),
    )
    .sort((a, b) => b.enrollment.lastActiveAt - a.enrollment.lastActiveAt);

  const overallQuiz = quizAverage();
  const lessonsDone = enrollments.reduce((n, e) => n + e.completedLessons.length, 0);
  const conceptsMastered = new Set(enrollments.flatMap((e) => e.masteredConcepts)).size;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-primary uppercase">
            Welcome back
          </p>
          <h1 className="mt-2 text-3xl font-semibold sm:text-4xl">Pick up where you left off</h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Sarathi teaches one beat at a time — intuition, code, a diagram, then a checkpoint
            question to prove it stuck.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/catalog">
            <Compass className="mr-2 size-4" /> Browse catalog
          </Link>
        </Button>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <StatCard icon={<Target className="size-4" />} label="Lessons completed" value={lessonsDone} />
        <StatCard
          icon={<Sparkles className="size-4" />}
          label="Concepts mastered"
          value={conceptsMastered}
        />
        <StatCard
          icon={<Clock className="size-4" />}
          label="Quiz average"
          value={overallQuiz === null ? "—" : `${overallQuiz}%`}
        />
      </div>

      <h2 className="mt-12 text-xl font-semibold">Active courses</h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {active.length === 0 && (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              You have no active courses yet.{" "}
              <Link to="/catalog" className="text-primary underline">
                Enroll in one
              </Link>{" "}
              to get started.
            </CardContent>
          </Card>
        )}
        {active.map(({ course, enrollment }) => {
          const lessons = flattenLessons(course);
          const resume =
            lessons.find((l) => l.lessonId === enrollment.lastLessonId) ??
            lessons.find((l) => !enrollment.completedLessons.includes(l.lessonId)) ??
            lessons[0]!;
          const pct = progressFor(course.id);
          const avg = quizAverage(course.id);
          return (
            <Card key={course.id}>
              <CardHeader className="gap-2">
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-lg">{course.title}</CardTitle>
                  <Badge variant="secondary" className="capitalize">
                    {course.difficulty}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">{course.tagline}</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>
                      {enrollment.completedLessons.length} of {countLessons(course)} lessons
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <Progress value={pct} className="mt-2" />
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span>Quiz average: {avg === null ? "—" : `${avg}%`}</span>
                  <span>Last active {relative(enrollment.lastActiveAt)}</span>
                </div>
                <Button asChild size="sm">
                  <Link
                    to="/learn/$courseId/$lessonId"
                    params={{ courseId: course.id, lessonId: resume.lessonId }}
                  >
                    Resume: {resume.lesson.title}
                    <ArrowRight className="ml-2 size-4" />
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

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-6">
        <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
          {icon}
        </span>
        <div>
          <div className="text-2xl font-semibold">{value}</div>
          <div className="text-xs text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

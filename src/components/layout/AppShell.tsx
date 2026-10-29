import { Link, useParams } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDot,
  Compass,
  FilePlus2,
  GraduationCap,
  LayoutDashboard,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/lib/app-store";
import { flattenLessons } from "@/lib/course-types";
import { LessonPanelContext, type LessonPanel } from "@/lib/lesson-panel";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const studentNav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/catalog", label: "All courses", icon: Compass },
] as const;

const adminNav = [
  { to: "/admin", label: "Studio", icon: LayoutDashboard },
  { to: "/admin/ingest", label: "New from document", icon: FilePlus2 },
] as const;

const SIDEBAR_KEY = "sarathi-sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const { role, setRole, courses, enrollments, progressFor } = useAppStore();
  const { theme, toggle } = useTheme();
  const params = useParams({ strict: false }) as { courseId?: string; lessonId?: string };
  const [open, setOpen] = useState(true);
  const [panel, setPanel] = useState<LessonPanel | null>(null);

  // Restore the saved choice; on small screens start closed so the lesson gets the full width.
  useEffect(() => {
    let initial = window.innerWidth >= 1024;
    try {
      const saved = window.localStorage.getItem(SIDEBAR_KEY);
      if (saved === "open") initial = true;
      if (saved === "closed") initial = false;
      if (saved === null && window.innerWidth < 1024) initial = false;
    } catch {
      // ignore
    }
    setOpen(initial);
  }, []);

  const setSidebar = useCallback((value: boolean) => {
    setOpen(value);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, value ? "open" : "closed");
    } catch {
      // ignore
    }
  }, []);

  // Close the drawer after navigating on mobile.
  const closeOnMobile = () => {
    if (window.innerWidth < 1024) setOpen(false);
  };

  const course = params.courseId ? courses.find((c) => c.id === params.courseId) : undefined;
  const lessons = useMemo(() => (course ? flattenLessons(course) : []), [course]);
  const index = lessons.findIndex((l) => l.lessonId === params.lessonId);
  const current = index >= 0 ? lessons[index] : undefined;
  const inLesson = !!course && !!current;
  const enrollment = course ? enrollments.find((e) => e.courseId === course.id) : undefined;
  const nav = role === "admin" ? adminNav : studentNav;
  const prev = index > 0 ? lessons[index - 1] : undefined;
  const next = index >= 0 && index < lessons.length - 1 ? lessons[index + 1] : undefined;
  const ctx = useMemo(() => ({ panel, setPanel }), [panel]);

  return (
    <LessonPanelContext.Provider value={ctx}>
      <div className="flex h-dvh overflow-hidden bg-background">
        {open && (
          <button
            type="button"
            aria-label="Close sidebar"
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setSidebar(false)}
          />
        )}

        <aside
          aria-label="Sidebar"
          inert={!open}
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[transform,margin] duration-200 ease-out lg:static",
            open ? "translate-x-0 lg:ml-0" : "-translate-x-full lg:-ml-72",
          )}
        >
          <div className="flex h-14 items-center justify-between px-3">
            <Link to="/" className="flex items-center gap-2 px-1" onClick={closeOnMobile}>
              <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
                <GraduationCap className="size-4.5" />
              </span>
              <span className="font-serif text-lg font-semibold">Sarathi</span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebar(false)}
              aria-label="Hide sidebar"
              className="text-muted-foreground"
            >
              <PanelLeftClose className="size-4.5" />
            </Button>
          </div>

          <nav className="space-y-0.5 px-2 pb-2">
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={closeOnMobile}
                activeOptions={{ exact: item.to === "/" || item.to === "/admin" }}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                activeProps={{ className: "bg-sidebar-accent text-sidebar-accent-foreground" }}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto border-t border-sidebar-border px-2 py-3">
            {inLesson && course && current ? (
              <div>
                <div className="px-3">
                  <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                    Current course
                  </p>
                  <p className="mt-1 font-serif text-base leading-snug font-semibold">
                    {course.title}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={progressFor(course.id)} className="h-1.5" />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {progressFor(course.id)}%
                    </span>
                  </div>
                  {course.source && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      From {course.source.fileName}
                    </p>
                  )}
                </div>

                <div className="mt-4 space-y-4">
                  {course.modules.map((module) => (
                    <div key={module.id}>
                      <p className="px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                        {module.title}
                      </p>
                      <ul className="mt-1 space-y-0.5">
                        {module.lessons.map((l) => {
                          const active = l.id === current.lessonId;
                          return (
                            <li key={l.id}>
                              <Link
                                to="/learn/$courseId/$lessonId"
                                params={{ courseId: course.id, lessonId: l.id }}
                                onClick={closeOnMobile}
                                className={cn(
                                  "flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-sidebar-accent",
                                  active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                                )}
                              >
                                {enrollment?.completedLessons.includes(l.id) ? (
                                  <Check className="mt-1 size-3.5 shrink-0 text-chart-2" />
                                ) : (
                                  <CircleDot className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                                )}
                                <span className="leading-snug">{l.title}</span>
                              </Link>
                              {active && (
                                <ul className="mt-1 mb-1 ml-[1.65rem] space-y-1 border-l border-sidebar-border pl-3">
                                  {l.concepts.map((concept, i) => {
                                    const reached = !!panel && (panel.conceptIndex > i || panel.done);
                                    const isNow =
                                      !!panel && panel.started && !panel.done && panel.conceptIndex === i;
                                    const mastered = enrollment?.masteredConcepts.includes(concept);
                                    return (
                                      <li
                                        key={concept}
                                        className={cn(
                                          "flex items-start gap-1.5 text-xs",
                                          isNow
                                            ? "font-medium text-foreground"
                                            : reached || mastered
                                              ? "text-foreground/80"
                                              : "text-muted-foreground",
                                        )}
                                      >
                                        {reached || mastered ? (
                                          <Check className="mt-0.5 size-3 shrink-0 text-chart-2" />
                                        ) : (
                                          <span
                                            className={cn(
                                              "mt-1.5 ml-1 size-1.5 shrink-0 rounded-full",
                                              isNow ? "bg-primary" : "bg-muted-foreground/40",
                                            )}
                                          />
                                        )}
                                        <span className="leading-snug">{concept}</span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>

                <div className="mt-4 space-y-2 px-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full"
                    disabled={!panel || panel.busy}
                    onClick={() => panel?.onComplete()}
                  >
                    <Check className="mr-2 size-4" /> Mark lesson complete
                  </Button>
                  <div className="flex gap-2">
                    {prev ? (
                      <Button asChild size="sm" variant="ghost" className="flex-1">
                        <Link
                          to="/learn/$courseId/$lessonId"
                          params={{ courseId: course.id, lessonId: prev.lessonId }}
                          onClick={closeOnMobile}
                        >
                          <ArrowLeft className="mr-1 size-4" /> Prev
                        </Link>
                      </Button>
                    ) : (
                      <span className="flex-1" />
                    )}
                    {next && (
                      <Button asChild size="sm" variant="ghost" className="flex-1">
                        <Link
                          to="/learn/$courseId/$lessonId"
                          params={{ courseId: course.id, lessonId: next.lessonId }}
                          onClick={closeOnMobile}
                        >
                          Next <ArrowRight className="ml-1 size-4" />
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <p className="px-3 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  Your courses
                </p>
                <ul className="mt-1 space-y-0.5">
                  {enrollments.map((e) => {
                    const c = courses.find((x) => x.id === e.courseId);
                    if (!c) return null;
                    const lessonsOf = flattenLessons(c);
                    const resume = lessonsOf.find((l) => l.lessonId === e.lastLessonId) ?? lessonsOf[0];
                    if (!resume) return null;
                    return (
                      <li key={c.id}>
                        <Link
                          to="/learn/$courseId/$lessonId"
                          params={{ courseId: c.id, lessonId: resume.lessonId }}
                          onClick={closeOnMobile}
                          className="block rounded-lg px-3 py-2 text-sm transition-colors hover:bg-sidebar-accent"
                        >
                          <span className="block leading-snug">{c.title}</span>
                          <span className="text-xs text-muted-foreground">
                            {progressFor(c.id)}% complete
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                  {enrollments.length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">
                      Nothing yet — pick a course from the catalog.
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>

          <div className="space-y-2 border-t border-sidebar-border p-3">
            <div className="flex rounded-lg border border-sidebar-border bg-background/60 p-0.5">
              {(["student", "admin"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                    role === r
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Avatar className="size-8">
                <AvatarFallback className="bg-secondary text-xs font-semibold">AC</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-sm font-medium">Abishek C.</p>
                <p className="truncate text-xs text-muted-foreground">Demo account · local</p>
              </div>
              <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle dark mode">
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </Button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-12 shrink-0 items-center gap-2 px-3">
            {!open && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebar(true)}
                aria-label="Show sidebar"
                className="text-muted-foreground"
              >
                <PanelLeftOpen className="size-4.5" />
              </Button>
            )}
            {inLesson && current && (
              <p className="min-w-0 truncate text-sm text-muted-foreground">
                <span className="hidden sm:inline">{course?.title} / </span>
                <span className="font-medium text-foreground">{current.lesson.title}</span>
              </p>
            )}
          </header>
          <main className="relative min-h-0 flex-1 overflow-y-auto">{children}</main>
        </div>
      </div>
    </LessonPanelContext.Provider>
  );
}

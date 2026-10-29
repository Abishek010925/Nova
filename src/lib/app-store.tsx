import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { Course, ExplainLevel } from "./course-types";
import { DEFAULT_LEVEL, countLessons, flattenLessons } from "./course-types";
import { seedCourses } from "./seed-courses";

export type Role = "student" | "admin";

export type QuizAttempt = {
  questionId: string;
  correct: boolean;
  at: number;
};

export type Enrollment = {
  courseId: string;
  enrolledAt: number;
  completedLessons: string[];
  masteredConcepts: string[];
  lastLessonId?: string;
  lastActiveAt: number;
  attempts: QuizAttempt[];
};

type PersistedState = {
  role: Role;
  /** The student's chosen explanation level (easy = Class 10, normal = undergrad, pro = graduate). */
  level?: ExplainLevel;
  courses: Course[];
  enrollments: Enrollment[];
};

const STORAGE_KEY = "sarathi-state-v1";

function demoState(): PersistedState {
  const ds = seedCourses[0]!;
  const py = seedCourses[1]!;
  const dsLessons = flattenLessons(ds);
  const pyLessons = flattenLessons(py);
  return {
    role: "student",
    courses: seedCourses,
    enrollments: [
      {
        courseId: ds.id,
        enrolledAt: Date.now() - 1000 * 60 * 60 * 24 * 9,
        completedLessons: [dsLessons[0]!.lessonId],
        masteredConcepts: ["Bounded context", "Data ownership", "Idempotency key"],
        lastLessonId: dsLessons[1]!.lessonId,
        lastActiveAt: Date.now() - 1000 * 60 * 60 * 20,
        attempts: [
          { questionId: "ds-m1-l1-q1", correct: true, at: Date.now() - 86400000 },
          { questionId: "ds-m1-l2-q1", correct: false, at: Date.now() - 72000000 },
        ],
      },
      {
        courseId: py.id,
        enrolledAt: Date.now() - 1000 * 60 * 60 * 24 * 3,
        completedLessons: [pyLessons[0]!.lessonId, pyLessons[1]!.lessonId],
        masteredConcepts: ["Big-O", "Hash lookup", "Recurrence", "lru_cache"],
        lastLessonId: pyLessons[2]!.lessonId,
        lastActiveAt: Date.now() - 1000 * 60 * 60 * 3,
        attempts: [
          { questionId: "py-m1-l1-q1", correct: true, at: Date.now() - 200000000 },
          { questionId: "py-m2-l1-q1", correct: true, at: Date.now() - 100000000 },
        ],
      },
    ],
  };
}

type StoreValue = {
  hydrated: boolean;
  role: Role;
  setRole: (role: Role) => void;
  level: ExplainLevel;
  /** True once the student has picked a level themselves (otherwise the course default applies). */
  levelSet: boolean;
  setLevel: (level: ExplainLevel) => void;
  courses: Course[];
  addCourse: (course: Course) => void;
  deleteCourse: (courseId: string) => void;
  enrollments: Enrollment[];
  updateCourse: (courseId: string, update: (course: Course) => Course) => void;
  enroll: (courseId: string) => void;
  enrollmentFor: (courseId: string) => Enrollment | undefined;
  completeLesson: (courseId: string, lessonId: string, concepts: string[]) => void;
  touchLesson: (courseId: string, lessonId: string) => void;
  recordAttempt: (courseId: string, questionId: string, correct: boolean) => void;
  progressFor: (courseId: string) => number;
  quizAverage: (courseId?: string) => number | null;
};

const StoreContext = createContext<StoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersistedState>(() => demoState());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PersistedState;
        if (parsed && Array.isArray(parsed.courses) && parsed.courses.length > 0) {
          setState(parsed);
        }
      }
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or unavailable
    }
  }, [state, hydrated]);

  const setRole = useCallback((role: Role) => setState((s) => ({ ...s, role })), []);
  const setLevel = useCallback((level: ExplainLevel) => setState((s) => ({ ...s, level })), []);

  const addCourse = useCallback((course: Course) => {
    setState((s) => ({ ...s, courses: [course, ...s.courses.filter((c) => c.id !== course.id)] }));
  }, []);

  const deleteCourse = useCallback((courseId: string) => {
    setState((s) => ({
      ...s,
      courses: s.courses.filter((c) => c.id !== courseId),
      enrollments: s.enrollments.filter((e) => e.courseId !== courseId),
    }));
  }, []);

  const updateCourse = useCallback((courseId: string, update: (course: Course) => Course) => {
    setState((s) => ({
      ...s,
      courses: s.courses.map((c) => (c.id === courseId ? update(c) : c)),
    }));
  }, []);

  const enroll = useCallback((courseId: string) => {
    setState((s) => {
      if (s.enrollments.some((e) => e.courseId === courseId)) return s;
      return {
        ...s,
        enrollments: [
          ...s.enrollments,
          {
            courseId,
            enrolledAt: Date.now(),
            completedLessons: [],
            masteredConcepts: [],
            lastActiveAt: Date.now(),
            attempts: [],
          },
        ],
      };
    });
  }, []);

  const mutateEnrollment = useCallback(
    (courseId: string, update: (e: Enrollment) => Enrollment) => {
      setState((s) => {
        const exists = s.enrollments.some((e) => e.courseId === courseId);
        const base: Enrollment = {
          courseId,
          enrolledAt: Date.now(),
          completedLessons: [],
          masteredConcepts: [],
          lastActiveAt: Date.now(),
          attempts: [],
        };
        const list = exists ? s.enrollments : [...s.enrollments, base];
        return {
          ...s,
          enrollments: list.map((e) => (e.courseId === courseId ? update(e) : e)),
        };
      });
    },
    [],
  );

  const value = useMemo<StoreValue>(() => {
    const enrollmentFor = (courseId: string) =>
      state.enrollments.find((e) => e.courseId === courseId);

    const progressFor = (courseId: string) => {
      const course = state.courses.find((c) => c.id === courseId);
      const enrollment = enrollmentFor(courseId);
      if (!course || !enrollment) return 0;
      const total = countLessons(course);
      if (total === 0) return 0;
      return Math.round((enrollment.completedLessons.length / total) * 100);
    };

    const quizAverage = (courseId?: string) => {
      const attempts = courseId
        ? (enrollmentFor(courseId)?.attempts ?? [])
        : state.enrollments.flatMap((e) => e.attempts);
      if (attempts.length === 0) return null;
      const correct = attempts.filter((a) => a.correct).length;
      return Math.round((correct / attempts.length) * 100);
    };

    return {
      hydrated,
      role: state.role,
      setRole,
      level: state.level ?? DEFAULT_LEVEL,
      levelSet: !!state.level,
      setLevel,
      addCourse,
      deleteCourse,
      courses: state.courses,
      enrollments: state.enrollments,
      updateCourse,
      enroll,
      enrollmentFor,
      progressFor,
      quizAverage,
      touchLesson: (courseId, lessonId) =>
        mutateEnrollment(courseId, (e) => ({
          ...e,
          lastLessonId: lessonId,
          lastActiveAt: Date.now(),
        })),
      completeLesson: (courseId, lessonId, concepts) =>
        mutateEnrollment(courseId, (e) => ({
          ...e,
          lastLessonId: lessonId,
          lastActiveAt: Date.now(),
          completedLessons: e.completedLessons.includes(lessonId)
            ? e.completedLessons
            : [...e.completedLessons, lessonId],
          masteredConcepts: Array.from(new Set([...e.masteredConcepts, ...concepts])),
        })),
      recordAttempt: (courseId, questionId, correct) =>
        mutateEnrollment(courseId, (e) => ({
          ...e,
          lastActiveAt: Date.now(),
          attempts: [
            ...e.attempts.filter((a) => a.questionId !== questionId),
            { questionId, correct, at: Date.now() },
          ],
        })),
    };
  }, [state, hydrated, setRole, setLevel, addCourse, deleteCourse, updateCourse, enroll, mutateEnrollment]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useAppStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useAppStore must be used inside AppStoreProvider");
  return ctx;
}

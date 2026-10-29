export type Difficulty = "beginner" | "intermediate" | "advanced";
export type CourseStatus = "draft" | "published" | "archived";

/** How the tutor pitches its language: easy = Class 10, normal = undergraduate, pro = graduate. */
export type ExplainLevel = "easy" | "normal" | "pro";

export const EXPLAIN_LEVELS: Array<{
  id: ExplainLevel;
  label: string;
  audience: string;
  blurb: string;
}> = [
  {
    id: "easy",
    label: "Easy",
    audience: "Class 10",
    blurb: "Everyday words, simple analogies and tiny examples.",
  },
  {
    id: "normal",
    label: "Normal",
    audience: "Undergrad",
    blurb: "Standard terminology with intuition and some rigour.",
  },
  {
    id: "pro",
    label: "Pro",
    audience: "Graduate",
    blurb: "Precise, technical, with assumptions and edge cases.",
  },
];

export const DEFAULT_LEVEL: ExplainLevel = "normal";

export type TeachingStyle = {
  /** Course-wide default explanation level; each student can still pick their own. */
  defaultLevel?: ExplainLevel;
  depth: "overview" | "balanced" | "deep-dive";
  tone: "neutral" | "encouraging" | "socratic";
  pacing: "slow" | "balanced" | "brisk";
  enforceQuizzes: boolean;
};

export type CodeExample = {
  label: string;
  language: string;
  code: string;
};

export type QuizQuestion = {
  id: string;
  kind: "multiple-choice" | "code-prediction";
  prompt: string;
  code?: string;
  language?: string;
  options: string[];
  answerIndex: number;
  explanation: string;
};

export type Lesson = {
  id: string;
  title: string;
  minutes: number;
  intuition: string;
  objectives: string[];
  concepts: string[];
  codeExamples: CodeExample[];
  diagram?: { title: string; mermaid: string };
  quiz: QuizQuestion[];
  /** Text from the uploaded document that this lesson is grounded in (sent to the tutor). */
  sourceExcerpt?: string;
  /** Human-readable location in the source, e.g. "pp. 12–15". */
  sourceRef?: string;
};

export type Module = {
  id: string;
  title: string;
  summary: string;
  lessons: Lesson[];
};

export type Course = {
  id: string;
  title: string;
  tagline: string;
  description: string;
  difficulty: Difficulty;
  status: CourseStatus;
  tags: string[];
  teaching: TeachingStyle;
  modules: Module[];
  /** Set when the course was generated from an uploaded document. */
  source?: {
    fileName: string;
    kind: string;
    pages?: number;
    chars: number;
    generatedBy: "ai" | "structure";
    createdAt: number;
  };
};

export type LessonRef = {
  courseId: string;
  moduleId: string;
  lessonId: string;
  moduleTitle: string;
  lesson: Lesson;
};

export function flattenLessons(course: Course): LessonRef[] {
  return course.modules.flatMap((m) =>
    m.lessons.map((lesson) => ({
      courseId: course.id,
      moduleId: m.id,
      lessonId: lesson.id,
      moduleTitle: m.title,
      lesson,
    })),
  );
}

export function countLessons(course: Course): number {
  return course.modules.reduce((n, m) => n + m.lessons.length, 0);
}

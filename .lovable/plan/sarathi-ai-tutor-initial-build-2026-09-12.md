# Sarathi AI Tutor — initial build

An interactive course platform with an AI tutor workspace, a student catalog/dashboard, and an admin course studio. Two rich demo courses are seeded so everything works the moment the app opens.

## What gets built

### 1. Shell and role switching
- Header with the Sarathi mark, primary nav, notifications bell (demo items), profile menu, dark/light toggle.
- A Student / Admin switcher in the header so both experiences can be tested instantly. No sign-in wall for the demo.

### 2. Seeded demo content
Two courses, published, with modules, lessons, objectives, key concepts, code examples, and teaching-style settings (pacing: balanced, tone: encouraging & intuitive, quizzes enforced):
- Distributed Systems & Microservices — Architecture & Message Queues, Consensus & Raft, Caching & Data Consistency.
- Python & Algorithmic Problem Solving — complexity intuition, recursion & memoization, arrays/strings patterns, graph traversal.
Plus a demo student with partial progress and quiz scores, so dashboards show real numbers.

### 3. Tutor workspace (the core slice)
- Main pane: a tutor conversation stream of typed blocks — explanation text (Markdown), code with syntax highlighting and a copy button, inline Mermaid diagrams (flowcharts and sequence diagrams), and checkpoint quiz cards (multiple choice or "predict the output") with instant grading, explanation, and score tracking.
- Sidebar: objectives checklist, mastered-concepts progress bar, prev/next lesson, and the full course outline.
- Controls: "Continue lesson" (advances the scripted teaching beat) and "Ask a question" (free-form).
- Responses stream in. The tutor engine works out of the box using a built-in lesson-aware simulated tutor; when an AI key is configured it uses the live model instead. Groq is supported as the configured provider.

### 4. Admin studio
- Dashboard: courses by state (draft / published / archived), enrollment counts, completion and quiz-average metrics.
- Outline builder: add/edit/reorder modules and lessons, edit objectives and key concepts, set teaching style (depth, tone, pacing, enforce quizzes).
- Content ingestion simulator: paste raw notes or drop a text file, get a suggested module/lesson outline with objectives and concepts that can be inserted into the course in one click.

### 5. Student dashboard and catalog
- Catalog: course cards with difficulty badge, module/lesson counts, enroll button, progress ring for enrolled courses.
- Dashboard: active courses with progress %, quiz average, last-activity, and "Resume lesson" shortcuts.

### 6. Design
Clean, focused, reading-first educational UI: warm-neutral surfaces with a single deep teal accent, generous line length for lesson text, monospace only for code, calm motion. Full dark/light support, all colors as design tokens.

## Technical notes

- Backend: Lovable Cloud (Postgres) for courses, modules, lessons, blocks, enrollments, progress, and quiz attempts, with grants and RLS. Demo courses and progress are inserted in the same migration.
- Routes: `/` (student dashboard), `/catalog`, `/learn/$courseId/$lessonId` (tutor workspace), `/admin`, `/admin/courses/$courseId` (builder), `/admin/ingest`.
- Tutor streaming: a TanStack server route (`/api/tutor`) streams blocks. It parses model output into typed blocks (`text` | `code` | `mermaid` | `quiz`); with no provider key it falls back to a deterministic, lesson-aware script built from the lesson's objectives, concepts, and examples. `GROQ_API_KEY` is read server-side only and, when present, drives live responses.
- Rendering: `react-markdown` + `shiki`-style highlighting for code, `mermaid` loaded client-side only (dynamic import after hydration to keep SSR safe).
- Quiz submissions persist attempts and recompute lesson mastery + course progress.
- Per-route head metadata (unique titles/descriptions) on every page.

## Not in this build
- Real sign-up/login (role switcher stands in), payments, certificates, video, and multi-tenant admin permissions.

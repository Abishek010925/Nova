# Sarathi AI Tutor

Build "Sarathi AI Tutor", an interactive full-stack AI-tutored course platform.

Key Deliverables for the initial build:
1. Navigation & Role Switcher:
   - Header with student & admin mode toggle (or role-based access with demo switcher for immediate testing), notifications, and user profile.
2. Seed Data / Sample Courses:
   - Seed at least 2 structured, rich demo courses:
     a) "Distributed Systems & Microservices" (Modules: Architecture & Message Queues, Consensus & Raft, Caching & Data Consistency)
     b) "Python & Algorithmic Problem Solving"
   - Each course should have modules, lessons, learning objectives, key concepts, suggested code examples, and pre-configured teaching styles (pacing: balanced, tone: encouraging & intuitive, enforce_quizzes: true).
3. Student Interactive Tutor Workspace (Core Vertical Slice):
   - Interactive split/chat view for lessons:
     - Left/Main pane: AI Tutor conversation stream with typed rich blocks:
       * Explanatory text & intuition breakdowns (Markdown)
       * Code snippets with syntax highlighting and copy button
       * Interactive dynamic Mermaid.js diagrams (flowcharts, sequence diagrams) rendered inline
       * Interactive Checkpoint Quiz widgets (multiple choice or code prediction) with instant submit, grading feedback, and score tracking
     - Right/Sidebar pane: Lesson objectives checklist, mastered concepts progress bar, lesson navigation (next/prev lesson), and course outline.
     - Simulated/Integrated streaming AI tutor engine supporting Groq API configuration (with fallback simulated intelligent responses so the app works immediately out of the box).
   - "Ask a free-form question" vs "Continue lesson" controls.
4. Admin Studio & Course Builder:
   - Admin dashboard with courses list (draft, published, archived), student enrollments, and completion metrics.
   - Course outline builder (add modules, lessons, objectives, key concepts, teaching style options: depth, tone, pacing).
   - Raw content ingestion simulator / prompt generator: paste raw text/notes or upload file to generate a structured module outline.
5. Student Dashboard & Catalog:
   - Course catalog with enrollment, difficulty badges, and progress tracking.
   - Student dashboard showing active courses, progress %, quiz average, and "Resume Lesson" shortcuts.
6. Design: Clean, modern, distraction-free educational UI (dark/light friendly, polished typography, intuitive learning flow).

This project was developed by Abishek Chaudhari.
Github: https://github.com/abishek-c367
LinkedIn: https://www.linkedin.com/in/abishek-chaudhari

**Live app**: https://nova-pka8.onrender.com/

## Built with Copilot and Claude

Continue developing this project as per your imagination.

- **Stay in sync**: ask for creating a branch to upload every changes made by you 
- **Full ownership**: this code is yours. Clone it and change as per your desire.
## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Documents → courses

Admins can upload a PDF / .txt / .md (research paper, book, article, magazine, notes) at
`/admin/ingest`. Text is extracted in the browser (pdf.js), then `/api/course-gen` drafts
chapter outlines with `openai/gpt-oss-20b` and lesson content with `openai/gpt-oss-120b`,
using `GROQ_API_KEY`. Tutor explanations, quizzes, and tutoring also use
`openai/gpt-oss-120b`. Without a key it falls back to a structure-based outline. Scanned
(image-only) PDFs need OCR first. Students pick Easy (Class 10) / Normal (Undergrad) / Pro
(Graduate) in the chat bar; maths renders through KaTeX.

Tutor conversations are saved in the current browser's IndexedDB per course lesson, so students
can return to the same browser and continue later. Archived chat is shown in the UI but is not
sent back to the AI; tutor requests use the lesson's saved objectives, concepts, and source excerpt
as course notes. Conversations are not synced across browsers or devices.

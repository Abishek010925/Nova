import Markdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { normalizeMath } from "@/lib/math";

const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]] as never;
const rehypePlugins = [[rehypeKatex, { strict: "ignore", throwOnError: false }]] as never;
const markdownComponents: Components = {
  table: ({ children, ...props }) => (
    <div className="tutor-table-wrap">
      <table {...props}>{children}</table>
    </div>
  ),
};

/**
 * The one place tutor text is rendered. Every surface (explanations, quizzes,
 * check-ins, student bubbles) goes through here so formulas always look the same.
 */
export function Rich({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className ?? "tutor-prose"}>
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={markdownComponents}
      >
        {normalizeMath(children)}
      </Markdown>
    </div>
  );
}

/** Same pipeline, but renders inline (no wrapping block) for buttons, labels and headings. */
export function RichInline({ children }: { children: string }) {
  return (
    <Markdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={{ ...markdownComponents, p: ({ children: c }) => <>{c}</> }}
    >
      {normalizeMath(children)}
    </Markdown>
  );
}

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const KEYWORDS = new Set([
  "def","return","if","else","elif","for","while","in","not","and","or","import","from","class","await","async",
  "const","let","var","function","new","try","except","catch","finally","print","select","join","group","by",
  "order","left","count","as","from","where","true","false","none","null","interface","type","export","public",
]);

function highlight(code: string, language: string) {
  const commentToken = language === "python" ? "#" : language === "sql" ? "--" : "//";
  return code.split("\n").map((line, lineIndex) => {
    const commentAt = line.indexOf(commentToken);
    const codePart = commentAt >= 0 ? line.slice(0, commentAt) : line;
    const comment = commentAt >= 0 ? line.slice(commentAt) : "";
    const tokens = codePart.split(/(\s+|[()[\]{}.,:;=+\-*/<>!]|"[^"]*"|'[^']*')/g);
    return (
      <div key={lineIndex} className="whitespace-pre">
        {tokens.map((token, i) => {
          if (!token) return null;
          const lower = token.toLowerCase();
          if (/^["'].*["']$/.test(token)) {
            return (
              <span key={i} className="text-chart-2">
                {token}
              </span>
            );
          }
          if (KEYWORDS.has(lower)) {
            return (
              <span key={i} className="text-primary font-medium">
                {token}
              </span>
            );
          }
          if (/^\d+$/.test(token)) {
            return (
              <span key={i} className="text-chart-5">
                {token}
              </span>
            );
          }
          return <span key={i}>{token}</span>;
        })}
        {comment && <span className="text-muted-foreground italic">{comment}</span>}
      </div>
    );
  });
}

export function CodeBlock({
  code,
  language,
  label,
  className,
}: {
  code: string;
  language: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-muted/40 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 bg-muted/60 px-3 py-1.5">
        <figcaption className="truncate text-xs font-medium text-muted-foreground">
          {label ?? language}
        </figcaption>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-relaxed">
        <code>{highlight(code, language)}</code>
      </pre>
    </figure>
  );
}

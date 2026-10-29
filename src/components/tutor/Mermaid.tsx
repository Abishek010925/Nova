import { useEffect, useRef, useState } from "react";

let idSeq = 0;

export default function Mermaid({ chart, title }: { chart: string; title?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    idSeq += 1;
    const renderId = `sarathi-mermaid-${idSeq}`;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        const dark = document.documentElement.classList.contains("dark");
        mermaid.initialize({
          startOnLoad: false,
          theme: dark ? "dark" : "neutral",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(renderId, chart);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (failed) {
    return (
      <pre className="overflow-x-auto rounded-xl border border-border bg-muted/40 p-3 text-xs">
        {chart}
      </pre>
    );
  }

  return (
    <figure className="rounded-xl border border-border bg-card p-4">
      {title && (
        <figcaption className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {title}
        </figcaption>
      )}
      {svg ? (
        <div
          ref={containerRef}
          className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="h-24 animate-pulse rounded-lg bg-muted" />
      )}
    </figure>
  );
}

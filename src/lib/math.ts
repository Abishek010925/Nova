/**
 * Math helpers. LLMs (and PDFs) emit maths in several dialects: \( … \), \[ … \],
 * $…$, $$…$$, or bare LaTeX. We normalise everything to the `$…$` / `$$…$$` dialect
 * that remark-math understands, so a formula looks identical wherever it appears
 * (tutor text, quiz options, check-ins, student messages).
 */

/** Convert \( … \) and \[ … \] (and \begin{equation}) to $ … $ / $$ … $$, leaving code untouched. */
export function normalizeMath(markdown: string): string {
  // Split out fenced code and inline code so we never rewrite inside them.
  const parts = markdown.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
        // `$$x$$` on one line -> a proper display block, so it renders like every other display formula.
        .replace(/\$\$([^\n$]+?)\$\$/g, (_m, body: string) => `\n\n$$\n${body.trim()}\n$$\n\n`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body: string) => `$${body.trim()}$`)
        .replace(
          /\\begin\{(equation|align|gather)\*?\}([\s\S]+?)\\end\{\1\*?\}/g,
          (_m, env: string, body: string) =>
            env === "equation"
              ? `\n\n$$\n${body.trim()}\n$$\n\n`
              : `\n\n$$\n\\begin{aligned}${body.trim()}\\end{aligned}\n$$\n\n`,
        );
    })
    .join("");
}

/** Number of unescaped `$` delimiters in a string (ignores currency like "$5" is not handled — fine for lesson text). */
function countDollars(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === "$") n++;
  }
  return n;
}

/**
 * If a truncated string ends inside a formula (odd number of `$`), back up to just before
 * the dangling opener so the formula is dropped whole rather than rendered broken.
 */
export function closeOpenMath(text: string): string {
  if (countDollars(text) % 2 === 0) return text;
  const idx = text.lastIndexOf("$");
  // Handle `$$` openers too.
  const cut = idx > 0 && text[idx - 1] === "$" ? idx - 1 : idx;
  return text.slice(0, Math.max(0, cut)).trimEnd();
}

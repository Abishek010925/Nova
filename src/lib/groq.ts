/**
 * Minimal Groq chat-completions client used by the course generator.
 * Server-only (reads process.env at call time). Retries once on 429 rate limits,
 * which are common on free-tier keys when generating many lessons in a row.
 */
const DEFAULT_MODEL = "openai/gpt-oss-120b";

export function groqModel(): string {
  return process.env["GROQ_MODEL"] || DEFAULT_MODEL;
}

export function hasGroqKey(): boolean {
  return !!process.env["GROQ_API_KEY"];
}

function stripReasoning(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*(analysis|reasoning|thinking)\s*:\s*/i, "")
    .trim();
}

export async function groqJson<T>(
  system: string,
  user: string,
  opts?: { effort?: "low" | "medium" | "high"; maxTokens?: number },
): Promise<T> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const model = groqModel();
  const reasoning = /gpt-oss|qwen3/i.test(model);

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    max_tokens: opts?.maxTokens ?? 3500,
    response_format: { type: "json_object" },
    ...(reasoning ? { reasoning_effort: opts?.effort ?? "low", reasoning_format: "hidden" } : {}),
  });

  let res: Response | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(`${process.env["GROQ_BASE_URL"] || "https://api.groq.com/openai/v1"}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body,
    });
    if (res.status !== 429 || attempt === 1) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Math.min(20_000, Math.max(2_000, (Number.isFinite(retryAfter) ? retryAfter : 6) * 1000));
    await new Promise((r) => setTimeout(r, waitMs));
  }

  if (!res || !res.ok) {
    const detail = res ? await res.text().catch(() => "") : "";
    throw new Error(`Groq ${model} request failed (${res?.status ?? "no response"}): ${detail.slice(0, 300)}`);
  }
  const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = stripReasoning(payload.choices?.[0]?.message?.content ?? "");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON in model response: ${raw.slice(0, 160)}`);
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    throw new Error(`Model returned malformed JSON: ${match[0].slice(0, 160)}`);
  }
}

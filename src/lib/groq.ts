/**
 * Minimal Groq chat-completions client used by the course generator.
 * Server-only (reads process.env at call time). Retries once on 429 rate limits,
 * which are common on free-tier keys when generating many lessons in a row.
 */
const DEFAULT_MODEL = "openai/gpt-oss-120b";
export const TUTOR_MODEL = "openai/gpt-oss-120b";
export const OUTLINE_MODEL = "openai/gpt-oss-20b";

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

function isJsonValidationFailure(detail: string): boolean {
  try {
    const error = (JSON.parse(detail) as { error?: { code?: unknown } }).error;
    return error?.code === "json_validate_failed";
  } catch {
    return false;
  }
}

export async function groqJson<T>(
  system: string,
  user: string,
  opts?: { effort?: "low" | "medium" | "high"; maxTokens?: number; model?: string },
): Promise<T> {
  const apiKey = process.env["GROQ_API_KEY"];
  if (!apiKey) throw new Error("GROQ_API_KEY is not set");
  const model = opts?.model ?? groqModel();
  const reasoning = /gpt-oss|qwen3/i.test(model);

  const buildBody = (jsonMode: boolean) =>
    JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      max_tokens: opts?.maxTokens ?? 3500,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(reasoning ? { reasoning_effort: opts?.effort ?? "low", reasoning_format: "hidden" } : {}),
    });

  const request = async (jsonMode: boolean) => {
    let response: Response | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      response = await fetch(
        `${process.env["GROQ_BASE_URL"] || "https://api.groq.com/openai/v1"}/chat/completions`,
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: buildBody(jsonMode),
        },
      );
      if (response.status !== 429 || attempt === 1) break;
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Math.min(
        20_000,
        Math.max(2_000, (Number.isFinite(retryAfter) ? retryAfter : 6) * 1000),
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
    return response;
  };

  let res = await request(true);
  if (!res) throw new Error(`Groq ${model} request failed: no response`);
  if (!res.ok) {
    let detail = await res.text().catch(() => "");
    if (isJsonValidationFailure(detail)) {
      res = await request(false);
      if (!res) throw new Error(`Groq ${model} JSON recovery request failed: no response`);
      if (!res.ok) detail = await res.text().catch(() => "");
    }
    if (!res.ok) {
      throw new Error(`Groq ${model} request failed (${res.status}): ${detail.slice(0, 500)}`);
    }
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

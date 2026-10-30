export const NEMOTRON_MODEL = "nvidia/nemotron-3.5-super-vl:free";

type OpenRouterOptions = {
  json?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
};

type ChatCompletionResponse = {
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
  provider?: string;
  usage?: {
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

let nextRequestAt = 0;
let requestQueue = Promise.resolve();

async function waitForRequestSlot(): Promise<void> {
  let release!: () => void;
  const previous = requestQueue;
  requestQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    nextRequestAt = Date.now() + 3_200;
  } finally {
    release();
  }
}

export function hasOpenRouterKey(): boolean {
  return Boolean(process.env["OPENROUTER_API_KEY"]);
}

export async function openRouterText(
  system: string,
  user: string,
  opts: OpenRouterOptions = {},
): Promise<string> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const timeoutMs = opts.timeoutMs ?? 120_000;
  const initialMaxTokens = opts.maxTokens ?? 3500;
  const retryMaxTokens = Math.min(24_000, initialMaxTokens * 2);
  let maxTokens = initialMaxTokens;
  let emptyResponseDetail = "no completion choices";

  for (let attempt = 0; attempt < 2; attempt++) {
    // Keep this process below the free-model limit of 20 requests per minute.
    await waitForRequestSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: NEMOTRON_MODEL,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature: opts.json ? 0.2 : 0.4,
          max_tokens: maxTokens,
          reasoning: { enabled: false, exclude: true },
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `OpenRouter ${NEMOTRON_MODEL} request failed (${response.status}): ${responseText.slice(0, 400)}`,
        );
      }

      let payload: ChatCompletionResponse;
      try {
        payload = JSON.parse(responseText) as ChatCompletionResponse;
      } catch {
        throw new Error("OpenRouter returned an invalid chat-completion response");
      }
      const choice = payload.choices?.[0];
      const content = choice?.message?.content;
      const finishReason = choice?.finish_reason;
      if (typeof content === "string" && content.trim() && finishReason !== "length") {
        return content.trim();
      }

      const reasoningTokens = payload.usage?.completion_tokens_details?.reasoning_tokens;
      emptyResponseDetail = [
        `finish_reason=${finishReason ?? "unknown"}`,
        `reasoning_tokens=${reasoningTokens ?? "unknown"}`,
        `completion_tokens=${payload.usage?.completion_tokens ?? "unknown"}`,
        `provider=${payload.provider ?? "unknown"}`,
        `max_tokens=${maxTokens}`,
      ].join(", ");
      if (finishReason === "length" && attempt === 0 && retryMaxTokens > maxTokens) {
        maxTokens = retryMaxTokens;
      } else {
        break;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`OpenRouter ${NEMOTRON_MODEL} request timed out after ${timeoutMs} ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `OpenRouter ${NEMOTRON_MODEL} returned no usable content after retrying length-limited output with reasoning disabled (${emptyResponseDetail})`,
  );
}

export async function openRouterJson<T>(
  system: string,
  user: string,
  opts: Omit<OpenRouterOptions, "json"> = {},
): Promise<T> {
  const content = await openRouterText(system, user, { ...opts, json: true });
  const unfenced = content.replace(/^```(?:json)?\s*|\s*```$/gi, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  const json = start >= 0 && end > start ? unfenced.slice(start, end + 1) : unfenced;
  try {
    return JSON.parse(json) as T;
  } catch {
    throw new Error(`OpenRouter returned malformed JSON: ${json.slice(0, 200)}`);
  }
}

/**
 * Unified Groq service.
 *
 * One shared low-level client (API key, HTTP, retry/backoff, timeout handling,
 * call logging). Task-specific helpers are built on top of it in the
 * *.functions.ts modules, so a retry or rate-limit fix here applies everywhere
 * while each call site still fails independently.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const GROQ_MODEL = "llama-3.3-70b-versatile";
export const GROQ_MODEL_FAST = "llama-3.1-8b-instant";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type GroqResult = {
  content: string;
  toolCalls: ToolCall[];
};

export class GroqError extends Error {
  status: number;
  retryable: boolean;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

function getKey(): string {
  const key = process.env["GROQ_API_KEY"];
  if (!key) {
    throw new GroqError(
      "GROQ_API_KEY is not configured on the server.",
      500,
      false,
    );
  }
  return key;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Low-level call: owns retry/backoff, rate-limit handling and logging. */
export async function groqChat(opts: {
  messages: ChatMessage[];
  task: string;
  userId?: string | null;
  model?: string;
  tools?: ToolSchema[];
  toolChoice?: "auto" | "none";
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
  maxAttempts?: number;
}): Promise<GroqResult> {
  const model = opts.model ?? GROQ_MODEL;
  const maxAttempts = opts.maxAttempts ?? 4;
  const key = getKey();

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages: opts.messages,
          ...(opts.tools ? { tools: opts.tools } : {}),
          ...(opts.tools ? { tool_choice: opts.toolChoice ?? "auto" } : {}),
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 2048,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt < maxAttempts) {
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(20000, 800 * 2 ** (attempt - 1)) + Math.random() * 400;
          await sleep(wait);
          continue;
        }
        throw new GroqError(
          `Groq request failed [${res.status}]: ${body.slice(0, 500)}`,
          res.status,
          retryable,
        );
      }

      const data = (await res.json()) as {
        choices?: { message?: ChatMessage }[];
      };
      const message = data.choices?.[0]?.message;
      void logCall(opts.task, model, true, null, opts.userId ?? null);
      return {
        content: typeof message?.content === "string" ? message.content : "",
        toolCalls: message?.tool_calls ?? [],
      };
    } catch (err) {
      lastError = err;
      const isNetwork = !(err instanceof GroqError);
      if (isNetwork && attempt < maxAttempts) {
        await sleep(Math.min(15000, 700 * 2 ** (attempt - 1)));
        continue;
      }
      break;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : "Unknown Groq failure";
  void logCall(opts.task, model, false, message, opts.userId ?? null);
  if (lastError instanceof GroqError) throw lastError;
  throw new GroqError(message, 502, true);
}

/**
 * JSON-only call with a single repair retry: on invalid JSON the actual parse
 * error is fed back to the model once before the caller is allowed to fail.
 */
export async function groqJson<T>(opts: {
  system: string;
  user: string;
  task: string;
  userId?: string | null;
  model?: string;
  validate: (value: unknown) => T;
  temperature?: number;
  maxTokens?: number;
}): Promise<{ value: T; raw: string }> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];

  let raw = "";
  for (let pass = 0; pass < 2; pass++) {
    const result = await groqChat({
      messages,
      task: opts.task,
      userId: opts.userId,
      model: opts.model,
      json: true,
      temperature: opts.temperature ?? 0.1,
      maxTokens: opts.maxTokens ?? 1600,
    });
    raw = result.content;
    try {
      return { value: opts.validate(JSON.parse(stripFences(raw))), raw };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (pass === 1) {
        throw new Error(`Invalid model output after repair retry: ${detail}`);
      }
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content:
          `That output was rejected with this error: ${detail}\n` +
          `Return ONLY corrected JSON matching the schema. No prose, no markdown fences.`,
      });
    }
  }
  throw new Error("Unreachable");
}

export function stripFences(text: string): string {
  const trimmed = text.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1]! : trimmed;
}

async function logCall(
  task: string,
  model: string,
  ok: boolean,
  detail: string | null,
  userId: string | null,
) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("llm_calls")
      .insert({ task, model, ok, detail, user_id: userId });
  } catch {
    // Accounting must never break a task.
  }
}

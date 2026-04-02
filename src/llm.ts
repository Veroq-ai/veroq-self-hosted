/**
 * Configurable LLM provider — works with any OpenAI-compatible API.
 *
 * Supports: OpenAI, Anthropic (via proxy), Azure OpenAI, local models
 * (Ollama, vLLM, NVIDIA NIM), or any endpoint that speaks the
 * OpenAI chat completions format.
 */

export interface LlmConfig {
  /** Base URL for the LLM API (e.g., "https://api.openai.com/v1", "http://localhost:11434/v1") */
  baseUrl: string;
  /** API key (set to "none" for local models that don't need auth) */
  apiKey: string;
  /** Model name (e.g., "gpt-4o-mini", "llama3", "mistral") */
  model: string;
  /** Max tokens for completion */
  maxTokens?: number;
  /** Temperature (0-1) */
  temperature?: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  content: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const DEFAULT_CONFIG: LlmConfig = {
  baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
  apiKey: process.env.LLM_API_KEY || "",
  model: process.env.LLM_MODEL || "gpt-4o-mini",
  maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "2000"),
  temperature: parseFloat(process.env.LLM_TEMPERATURE || "0"),
};

let _config: LlmConfig = { ...DEFAULT_CONFIG };

export function configureLlm(config: Partial<LlmConfig>): void {
  _config = { ..._config, ...config };
}

export function getLlmConfig(): LlmConfig {
  return { ..._config };
}

export async function chatCompletion(messages: LlmMessage[], config?: Partial<LlmConfig>): Promise<LlmResponse> {
  const c = { ..._config, ...config };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (c.apiKey && c.apiKey !== "none") {
    headers["Authorization"] = `Bearer ${c.apiKey}`;
  }

  const body = {
    model: c.model,
    messages,
    max_tokens: c.maxTokens ?? 2000,
    temperature: c.temperature ?? 0,
  };

  const resp = await fetch(`${c.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`LLM API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json() as any;
  const choice = data.choices?.[0];

  return {
    content: choice?.message?.content || "",
    usage: data.usage,
  };
}

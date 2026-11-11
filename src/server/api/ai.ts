import { NextResponse } from "next/server";
import { authenticatedUser, mutationUser, userHasPermission } from "@/lib/control-plane";
import { aiConfigurationWithKey, deleteAIConfiguration, deleteCustomAIProvider, listAIConfigurations, listCustomAIProviders, saveAIConfiguration, saveCustomAIProvider, setAIConfigurationEnabled } from "@/lib/ai-config";

const presets: Record<string, { name: string; baseUrl: string }> = {
  openai: { name: "OpenAI", baseUrl: "https://api.openai.com/v1" }, anthropic: { name: "Anthropic", baseUrl: "https://api.anthropic.com/v1" },
  gemini: { name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" }, mistral: { name: "Mistral", baseUrl: "https://api.mistral.ai/v1" },
  cohere: { name: "Cohere", baseUrl: "https://api.cohere.com/compatibility/v1" }, perplexity: { name: "Perplexity", baseUrl: "https://api.perplexity.ai" },
  deepinfra: { name: "DeepInfra", baseUrl: "https://api.deepinfra.com/v1/openai" }, ollama: { name: "Ollama", baseUrl: "http://localhost:11434/v1" },
  openrouter: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" }, zai: { name: "Z.AI", baseUrl: "https://api.z.ai/api/paas/v4" }, minimax: { name: "MiniMax", baseUrl: "https://api.minimax.io/v1" },
  deepseek: { name: "DeepSeek", baseUrl: "https://api.deepseek.com" }, groq: { name: "Groq", baseUrl: "https://api.groq.com/openai/v1" },
  xai: { name: "xAI", baseUrl: "https://api.x.ai/v1" }, together: { name: "Together AI", baseUrl: "https://api.together.xyz/v1" },
  fireworks: { name: "Fireworks AI", baseUrl: "https://api.fireworks.ai/inference/v1" }, cerebras: { name: "Cerebras", baseUrl: "https://api.cerebras.ai/v1" },
  sambanova: { name: "SambaNova", baseUrl: "https://api.sambanova.ai/v1" }, siliconflow: { name: "SiliconFlow", baseUrl: "https://api.siliconflow.com/v1" },
  nvidia: { name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1" },
};

function json(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } }); }
function validBaseUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 1000) return false;
  try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.hash; } catch { return false; }
}
function validText(value: unknown, max = 120) { return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max; }

async function providerRequest(config: { provider: string; baseUrl: string; apiKey: string; model: string }, prompt: string) {
  const controller = AbortSignal.timeout(30_000);
  const base = config.baseUrl.replace(/\/+$/, "");
  let response: Response;
  if (config.provider === "anthropic") {
    response = await fetch(`${base}/messages`, { method: "POST", signal: controller, headers: { "content-type": "application/json", "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: config.model, max_tokens: 700, messages: [{ role: "user", content: prompt }] }) });
  } else if (config.provider === "gemini") {
    response = await fetch(`${base}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`, { method: "POST", signal: controller, headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 700, temperature: 0.2 } }) });
  } else {
    response = await fetch(`${base}/chat/completions`, { method: "POST", signal: controller, headers: { "content-type": "application/json", authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, max_tokens: 700, temperature: 0.2, messages: [{ role: "user", content: prompt }] }) });
  }
  const raw = await response.text();
  if (!response.ok) throw new Error(`AI provider returned ${response.status}: ${raw.slice(0, 500).replaceAll(config.apiKey, "[REDACTED]")}`);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error("AI provider returned invalid JSON"); }
  if (config.provider === "anthropic") {
    const content = Array.isArray(body.content) ? body.content as Array<{ text?: unknown }> : [];
    return content.map((item) => typeof item.text === "string" ? item.text : "").join("\n").trim();
  }
  if (config.provider === "gemini") {
    const candidates = Array.isArray(body.candidates) ? body.candidates as Array<{ content?: { parts?: Array<{ text?: unknown }> } }> : [];
    return candidates.flatMap((item) => item.content?.parts ?? []).map((item) => typeof item.text === "string" ? item.text : "").join("\n").trim();
  }
  const choices = Array.isArray(body.choices) ? body.choices as Array<{ message?: { content?: unknown } }> : [];
  const result = choices[0]?.message?.content;
  return typeof result === "string" ? result.trim() : "";
}

async function providerModels(input: { provider: string; baseUrl: string; apiKey: string }) {
  const base = input.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  let url: string;
  if (input.provider === "gemini") {
    url = `${base}/models?key=${encodeURIComponent(input.apiKey)}`;
  } else if (input.provider === "anthropic") {
    url = `${base}/models`;
    headers["x-api-key"] = input.apiKey; headers["anthropic-version"] = "2023-06-01";
  } else {
    url = `${base}/models`; headers.authorization = `Bearer ${input.apiKey}`;
  }
  let response: Response;
  try { response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("Could not reach the provider model catalog. Check the API URL and network access."); }
  const raw = await response.text();
  if (!response.ok) throw new Error(`Model catalog returned ${response.status}: ${raw.slice(0, 300).replaceAll(input.apiKey, "[REDACTED]")}`);
  const body = JSON.parse(raw) as Record<string, unknown>;
  const records = Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : [];
  const models = records.flatMap((record) => {
    if (!record || typeof record !== "object") return [];
    const item = record as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
    return id ? [id.replace(/^models\//, "")] : [];
  });
  return [...new Set(models)].sort((a, b) => a.localeCompare(b)).slice(0, 500);
}

export async function getAISettings(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return json({ error: "Authentication required" }, 401);
  if (new URL(request.url).searchParams.get("available") === "1") {
    return json({ configurations: listAIConfigurations().filter((item) => item.enabled).map(({ id, name, model, provider }) => ({ id, name, model, provider })) });
  }
  if (!userHasPermission(user, "ai.manage")) return json({ error: "Permission denied" }, 403);
  return json({ configurations: listAIConfigurations(), customProviders: listCustomAIProviders(), presets: Object.entries(presets).map(([id, value]) => ({ id, ...value })) });
}

export async function postAISettings(request: Request) {
  const user = mutationUser(request);
  if (!user) return json({ error: "Authentication required" }, 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "Invalid request" }, 400);
  if (body.action !== "analyze" && !userHasPermission(user, "ai.manage")) return json({ error: "Permission denied" }, 403);
  try {
    if (body.action === "save_custom_provider") {
      if (!validText(body.name) || !validBaseUrl(body.baseUrl)) return json({ error: "Enter a provider name and a valid HTTP(S) API URL." }, 400);
      const saved = saveCustomAIProvider({ id: typeof body.id === "string" ? body.id : undefined, name: body.name as string, baseUrl: body.baseUrl });
      return json({ data: saved });
    }
    if (body.action === "save_configuration") {
      if (!validText(body.name) || !validText(body.model) || !validBaseUrl(body.baseUrl) || typeof body.provider !== "string") return json({ error: "Complete the configuration name, API URL, and model." }, 400);
      const custom = typeof body.customProviderId === "string" ? listCustomAIProviders().find((provider) => provider.id === body.customProviderId) : null;
      const customProviders = listCustomAIProviders();
      if (customProviders.length && !custom) return json({ error: "Select one of the configured custom providers." }, 400);
      if (!customProviders.length && !presets[body.provider]) return json({ error: "Select a supported provider preset." }, 400);
      if (typeof body.apiKey !== "string" || body.apiKey.length > 16_000) return json({ error: "API key is invalid." }, 400);
      const data = saveAIConfiguration({ id: typeof body.id === "string" ? body.id : undefined, name: body.name as string, provider: custom ? "custom" : body.provider as string, customProviderId: custom?.id ?? null, baseUrl: body.baseUrl, apiKey: body.apiKey, model: body.model as string, enabled: body.enabled !== false });
      return json({ data });
    }
    if (body.action === "test") {
      if (!validText(body.model) || !validBaseUrl(body.baseUrl) || typeof body.apiKey !== "string" || !body.apiKey || typeof body.provider !== "string") return json({ error: "Complete the API URL, key, provider, and model." }, 400);
      const result = await providerRequest({ provider: body.provider, baseUrl: body.baseUrl, apiKey: body.apiKey, model: body.model as string }, "Reply with the single word OK.");
      return json({ ok: true, message: result.slice(0, 300) });
    }
    if (body.action === "list_models") {
      if (!validBaseUrl(body.baseUrl) || typeof body.apiKey !== "string" || !body.apiKey || typeof body.provider !== "string") return json({ error: "Enter a valid API URL, key, and provider before loading models." }, 400);
      return json({ models: await providerModels({ provider: body.provider, baseUrl: body.baseUrl, apiKey: body.apiKey }) });
    }
    if (body.action === "test_saved") {
      const config = typeof body.id === "string" ? aiConfigurationWithKey(body.id) : null;
      if (!config) return json({ error: "AI configuration not found." }, 404);
      const result = await providerRequest(config, "Reply with the single word OK.");
      return json({ ok: true, message: result.slice(0, 300) });
    }
    if (body.action === "analyze") {
      const configId = typeof body.configurationId === "string" ? body.configurationId : "";
      if (!configId || typeof body.logs !== "string" || body.logs.length === 0) return json({ error: "Select an AI configuration and provide deployment logs." }, 400);
      const config = aiConfigurationWithKey(configId);
      if (!config || !config.enabled) return json({ error: "AI configuration is unavailable or disabled." }, 404);
      const language = body.language === "es" ? "Spanish" : "English";
      const logs = body.logs.slice(-32_000).replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]").replace(/((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]");
      const prompt = `Analyze these Docker Compose deployment logs. Reply in ${language}. Give a concise diagnosis, the most likely cause, evidence from the logs, and safe next steps. Do not repeat credentials or tokens. If evidence is insufficient, say so.\n\n<deployment-logs>\n${logs}\n</deployment-logs>`;
      const analysis = await providerRequest(config, prompt);
      return json({ analysis, configuration: config.name });
    }
    if (body.action === "delete_configuration" && typeof body.id === "string") return json({ ok: deleteAIConfiguration(body.id) });
    if (body.action === "set_enabled" && typeof body.id === "string" && typeof body.enabled === "boolean") return json({ ok: setAIConfigurationEnabled(body.id, body.enabled) });
    if (body.action === "delete_custom_provider" && typeof body.id === "string") return json({ ok: deleteCustomAIProvider(body.id) });
    return json({ error: "Unknown AI settings action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI provider request failed";
    if (message.includes("UNIQUE constraint failed")) return json({ error: "A configuration with that name already exists." }, 409);
    return json({ error: message.slice(0, 700) }, 502);
  }
}

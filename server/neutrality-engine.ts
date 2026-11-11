/**
 * Groq-Powered In-Memory Neutrality Engine
 *
 * Ephemeral AI Pipeline strictly adhering to Harvard Negotiation Project principles:
 * - Separate the people from the problem
 * - Focus on interests, not positions
 * - Invent options for mutual gain
 * - Insist on using objective criteria
 *
 * Zero-Persistence Guarantee:
 * - Prompts and completions are held strictly in memory during the HTTP lifecycle.
 * - Absolutely zero database persistence, zero disk logging, zero telemetry.
 */

export interface NeutralityVariantRequest {
  text: string;
  kind?: string; // problem | position | option | agreement | question | condition
  context?: string;
  apiKey?: string;
  model?: string;
}

export interface NeutralityVariants {
  objective: string;
  interests: string;
  action: string;
  rationale: string;
  model: string;
  simulated?: boolean;
}

const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
const FALLBACK_GROQ_MODELS = ["qwen/qwen3.8-27b", "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"];

const HARVARD_SYSTEM_PROMPT = `You are the Diavanish Neutrality Engine, an expert mediator trained strictly in the Harvard Negotiation Project (Fisher & Ury).
Your role is to translate emotionally charged, accusatory, vague, or adversarial statements into three disciplined, constructive mediation variants.

STRICT OPERATIONAL LAWS:
1. SEPARATE PEOPLE FROM THE PROBLEM: Refuse all ad hominem attacks, character assassinations, mind-reading, and accusations of malicious intent. Re-route language to observable facts, structural constraints, and shared goals.
2. PRESERVE THE CORE ISSUE: Do not minimize legitimate grievances. Preserve the substantive concern while removing toxic framing.
3. OUTPUT STRICT JSON ONLY with exactly this structure:
{
  "objective": "A strictly factual, observable statement stripping all emotional bias and blame.",
  "interests": "A statement focusing on mutual underlying needs, safety, and constructive intentions.",
  "action": "A concrete, voluntary, verifiable next commitment or observable test.",
  "rationale": "A single calm sentence explaining the transformative reframing."
}
4. Never include markdown code fences or explanatory text outside the JSON.`;

/**
 * Call Groq Cloud API in-memory with zero disk persistence
 */
export async function generateNeutralVariants(req: NeutralityVariantRequest): Promise<NeutralityVariants> {
  const apiKey = req.apiKey || process.env.GROQ_API_KEY;
  const requestedModel = req.model || process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;

  // If no Groq API key is configured anywhere, provide high-quality structural mock transformations
  if (!apiKey || apiKey.trim() === "") {
    return generateSimulatedVariants(req.text, req.kind);
  }

  const promptContent = `Original Draft:\n"${req.text}"\n\nCategory Context: ${req.kind || "general conflict statement"}${
    req.context ? `\nAdditional Context: ${req.context}` : ""
  }\n\nTransform this into three calibrated Harvard Negotiation variants:`;

  const modelsToTry = [requestedModel, ...FALLBACK_GROQ_MODELS.filter((m) => m !== requestedModel)];
  let lastError: Error | null = null;

  for (const currentModel of modelsToTry) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [
            { role: "system", content: HARVARD_SYSTEM_PROMPT },
            { role: "user", content: promptContent },
          ],
          temperature: 0.2,
          max_tokens: 800,
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let parsedMessage = `Groq API responded with HTTP ${response.status}`;
        try {
          const errJson = JSON.parse(errorText);
          if (errJson?.error?.message) parsedMessage = errJson.error.message;
        } catch {
          // Keep generic message
        }
        // If model does not exist or access is restricted, try next fallback candidate
        if (response.status === 404 || parsedMessage.includes("does not exist") || parsedMessage.includes("access")) {
          lastError = new Error(parsedMessage);
          continue;
        }
        throw new Error(parsedMessage);
      }

      const data = await response.json();
      let rawText = data?.choices?.[0]?.message?.content || "{}";

      // Clean markdown code blocks if present
      rawText = rawText.trim();
      if (rawText.startsWith("```json")) {
        rawText = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
      } else if (rawText.startsWith("```")) {
        rawText = rawText.replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
      }

      const parsed = JSON.parse(rawText);
      let target = parsed;
      if (Array.isArray(parsed) && parsed.length > 0) {
        target = parsed[0];
      } else if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed.variants) && parsed.variants.length > 0) {
          target = parsed.variants[0];
        } else if (parsed.result && typeof parsed.result === "object") {
          target = parsed.result;
        }
      }

      return {
        objective: target.objective || req.text,
        interests: target.interests || req.text,
        action: target.action || req.text,
        rationale: target.rationale || "Calibrated according to objective criteria and shared interests.",
        model: currentModel,
        simulated: false,
      };
    } catch (err: any) {
      lastError = err;
      if (!err.message?.includes("does not exist") && !err.message?.includes("access")) {
        throw err;
      }
    }
  }

  throw lastError || new Error("Failed to generate neutrality variants across available Groq models.");
}

/**
 * Validates a Groq API Key by testing models endpoint
 */
export async function testGroqConnection(apiKey?: string): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const key = (apiKey || process.env.GROQ_API_KEY || "").trim();
  if (!key) {
    return { ok: false, error: "No Groq API key provided or found in environment." };
  }

  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Invalid key or network failure (HTTP ${res.status}): ${text}` };
    }

    const data = await res.json();
    const modelIds = Array.isArray(data?.data) ? data.data.map((m: any) => m.id) : [];
    return { ok: true, models: modelIds };
  } catch (err: any) {
    return { ok: false, error: err.message || "Failed to reach Groq API" };
  }
}

/**
 * Fallback structural simulations when running in offline or demo mode without a Groq key
 */
function generateSimulatedVariants(text: string, kind?: string): NeutralityVariants {
  const clean = text.replace(/["']/g, "").trim();

  // Basic emotion/blame cleaner
  const objective = clean
    .replace(/\b(deliberately|always|never|completely ignored|refused to|incompetent|sabotaging)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    objective: `Observable criteria: The current process regarding "${objective || clean}" requires documented benchmarks and timeline verification.`,
    interests: `Underlying interest: Both parties share an interest in predictable workflow execution, transparent communication, and reducing operational risk.`,
    action: `Actionable step: Jointly review the protocol for "${objective || clean}" before the next sprint and document agreed acceptance thresholds.`,
    rationale: "Separated personal accountability from structural protocol requirements.",
    model: "simulated (in-memory offline)",
    simulated: true,
  };
}

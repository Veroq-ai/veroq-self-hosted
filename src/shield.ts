/**
 * Shield Engine — extract claims and verify against context or external evidence.
 *
 * Two verification modes:
 * 1. Groundedness — verify claims against provided document context (local, private)
 * 2. Factual — verify claims against VeroQ API or web search (external)
 *
 * Can run both modes simultaneously for maximum coverage.
 */

import { chatCompletion } from "./llm.js";

// ── Types ──

export interface ShieldRequest {
  /** The LLM output text to verify */
  text: string;
  /** Document context to verify against (groundedness mode) */
  context?: string;
  /** Source identifier (e.g., "gpt-5.4", "llama3") */
  source?: string;
  /** Max claims to extract (1-20, default 5) */
  maxClaims?: number;
  /** Verification mode: "groundedness" (local), "factual" (external), "both" */
  mode?: "groundedness" | "factual" | "both";
  /** VeroQ API key for factual verification (only needed in "factual" or "both" mode) */
  veroqApiKey?: string;
  /** VeroQ API base URL override */
  veroqBaseUrl?: string;
}

export interface ClaimResult {
  text: string;
  category: string;
  verdict: "supported" | "contradicted" | "unverifiable";
  confidence: number;
  summary: string;
  evidence: Array<{ source: string; snippet: string; position: string }>;
  correction: string | null;
  mode: "groundedness" | "factual";
}

export interface ShieldResult {
  status: "ok" | "error";
  text: string;
  source: string;
  mode: string;
  claims: ClaimResult[];
  claims_extracted: number;
  claims_supported: number;
  claims_contradicted: number;
  claims_unverifiable: number;
  trust_score: number;
  overall_verdict: string;
  summary: string;
  processing_time_ms: number;
}

// ── Claim Extraction ──

const EXTRACT_PROMPT = `You are a claim extractor. Given text, extract specific verifiable factual claims.

Rules:
- Extract only concrete, verifiable statements (numbers, dates, names, events)
- Skip opinions, predictions, and hedged language ("might", "could", "probably")
- Each claim should be a single, self-contained statement
- Return JSON array of objects with "text" (the claim) and "category" (financial, factual, statistical, temporal)
- Maximum {maxClaims} claims
- If no verifiable claims exist, return an empty array

Return ONLY valid JSON. No markdown, no explanation.`;

export async function extractClaims(text: string, maxClaims: number = 5): Promise<Array<{ text: string; category: string }>> {
  const resp = await chatCompletion([
    { role: "system", content: EXTRACT_PROMPT.replace("{maxClaims}", String(maxClaims)) },
    { role: "user", content: text },
  ]);

  try {
    const cleaned = resp.content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed.slice(0, maxClaims) : [];
  } catch {
    return [];
  }
}

// ── Groundedness Verification (local) ──

const GROUNDEDNESS_PROMPT = `You are a groundedness checker. Given a CLAIM and CONTEXT (retrieved documents), determine if the claim is supported by the context.

Rules:
- "supported" = the context explicitly states or directly implies this claim
- "contradicted" = the context explicitly states something different
- "unverifiable" = the context does not contain enough information to verify this claim
- Provide a brief summary explaining your verdict
- If contradicted, provide the correction based on what the context actually says
- Rate your confidence from 0 to 1

Return JSON:
{
  "verdict": "supported" | "contradicted" | "unverifiable",
  "confidence": 0.0-1.0,
  "summary": "brief explanation",
  "correction": "what the context actually says" or null,
  "evidence_snippet": "relevant quote from context" or null
}

Return ONLY valid JSON.`;

async function verifyGroundedness(claim: string, context: string): Promise<ClaimResult> {
  // Positional context batching: if context is long, split into paragraphs,
  // treat each as a "chunk" with equal score, and reorder so the first and
  // last paragraphs anchor the LLM's attention (Lost-in-the-Middle mitigation).
  let orderedContext = context;
  if (context.length > 4000) {
    const paragraphs = context.split(/\n\n+/).filter(p => p.trim().length > 0);
    if (paragraphs.length >= 3) {
      // Place first paragraph at start, second at end, rest in middle
      const reordered = [paragraphs[0], ...paragraphs.slice(2), paragraphs[1]];
      orderedContext = reordered.join('\n\n');
    }
    // Trim to budget after reordering (not before)
    if (orderedContext.length > 8000) orderedContext = orderedContext.slice(0, 8000);
  }

  const resp = await chatCompletion([
    { role: "system", content: GROUNDEDNESS_PROMPT },
    { role: "user", content: `CLAIM: ${claim}\n\nCONTEXT:\n${orderedContext}` },
  ]);

  try {
    const cleaned = resp.content.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      text: claim,
      category: "groundedness",
      verdict: parsed.verdict || "unverifiable",
      confidence: parsed.confidence || 0,
      summary: parsed.summary || "",
      evidence: parsed.evidence_snippet
        ? [{ source: "provided_context", snippet: parsed.evidence_snippet, position: parsed.verdict === "supported" ? "supports" : parsed.verdict === "contradicted" ? "contradicts" : "neutral" }]
        : [],
      correction: parsed.correction || null,
      mode: "groundedness",
    };
  } catch {
    return {
      text: claim,
      category: "groundedness",
      verdict: "unverifiable",
      confidence: 0,
      summary: "Failed to parse verification result.",
      evidence: [],
      correction: null,
      mode: "groundedness",
    };
  }
}

// ── Factual Verification (external via VeroQ API) ──

async function verifyFactual(
  claim: string,
  apiKey: string,
  baseUrl: string = "https://api.veroq.ai",
): Promise<ClaimResult> {
  try {
    const resp = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/v1/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ claim }),
      signal: AbortSignal.timeout(20000),
    });

    if (!resp.ok) {
      throw new Error(`VeroQ API ${resp.status}`);
    }

    const data = (await resp.json()) as any;
    return {
      text: claim,
      category: data.category || "factual",
      verdict: data.verdict || "unverifiable",
      confidence: data.confidence || 0,
      summary: data.summary || "",
      evidence: (data.evidence_chain || []).slice(0, 3).map((e: any) => ({
        source: e.source || e.url || "unknown",
        snippet: e.snippet || "",
        position: e.position || "neutral",
      })),
      correction: data.verdict === "contradicted" ? data.summary : null,
      mode: "factual",
    };
  } catch (err: any) {
    return {
      text: claim,
      category: "factual",
      verdict: "unverifiable",
      confidence: 0,
      summary: `External verification failed: ${err.message}`,
      evidence: [],
      correction: null,
      mode: "factual",
    };
  }
}

// ── Main Shield Function ──

export async function shield(req: ShieldRequest): Promise<ShieldResult> {
  const startTime = Date.now();
  const mode = req.mode || (req.context ? "both" : "factual");
  const maxClaims = Math.min(Math.max(req.maxClaims || 5, 1), 20);

  // Validate
  if (!req.text || req.text.trim().length < 20) {
    return {
      status: "ok",
      text: req.text || "",
      source: req.source || "unknown",
      mode,
      claims: [],
      claims_extracted: 0,
      claims_supported: 0,
      claims_contradicted: 0,
      claims_unverifiable: 0,
      trust_score: 1.0,
      overall_verdict: "no_claims",
      summary: "Text too short to extract verifiable claims.",
      processing_time_ms: Date.now() - startTime,
    };
  }

  if ((mode === "factual" || mode === "both") && !req.veroqApiKey) {
    // Fall back to groundedness-only if no API key and context is provided
    if (req.context) {
      req.mode = "groundedness";
    } else {
      return {
        status: "error" as any,
        text: req.text,
        source: req.source || "unknown",
        mode,
        claims: [],
        claims_extracted: 0,
        claims_supported: 0,
        claims_contradicted: 0,
        claims_unverifiable: 0,
        trust_score: 0,
        overall_verdict: "error",
        summary: "Factual verification requires a VeroQ API key (set VEROQ_API_KEY env var).",
        processing_time_ms: Date.now() - startTime,
      };
    }
  }

  // Step 1: Extract claims
  const extractedClaims = await extractClaims(req.text, maxClaims);

  if (extractedClaims.length === 0) {
    return {
      status: "ok",
      text: req.text.slice(0, 200),
      source: req.source || "unknown",
      mode,
      claims: [],
      claims_extracted: 0,
      claims_supported: 0,
      claims_contradicted: 0,
      claims_unverifiable: 0,
      trust_score: 1.0,
      overall_verdict: "no_claims",
      summary: "No verifiable factual claims found in the text.",
      processing_time_ms: Date.now() - startTime,
    };
  }

  // Step 2: Verify each claim
  const effectiveMode = req.mode || mode;
  const results: ClaimResult[] = [];

  // Run verification in parallel (batch of 3 to avoid overwhelming the LLM)
  const BATCH_SIZE = 3;
  for (let i = 0; i < extractedClaims.length; i += BATCH_SIZE) {
    const batch = extractedClaims.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.flatMap((claim) => {
        const tasks: Promise<ClaimResult>[] = [];

        if ((effectiveMode === "groundedness" || effectiveMode === "both") && req.context) {
          tasks.push(verifyGroundedness(claim.text, req.context));
        }

        if (effectiveMode === "factual" || effectiveMode === "both") {
          tasks.push(verifyFactual(claim.text, req.veroqApiKey!, req.veroqBaseUrl));
        }

        return tasks;
      }),
    );
    results.push(...batchResults);
  }

  // Step 3: Compute overall stats
  const supported = results.filter((r) => r.verdict === "supported").length;
  const contradicted = results.filter((r) => r.verdict === "contradicted").length;
  const unverifiable = results.filter((r) => r.verdict === "unverifiable").length;
  const totalConfidence =
    results.length > 0 ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length : 0;

  const overallVerdict =
    contradicted > 0
      ? "has_corrections"
      : supported === results.length && results.length > 0
        ? "all_verified"
        : results.length === 0
          ? "no_claims"
          : "partially_verified";

  const corrections = results.filter((r) => r.verdict === "contradicted" && r.correction);
  const summaryParts: string[] = [];
  summaryParts.push(`${extractedClaims.length} claims extracted, ${results.length} checked.`);
  if (supported > 0) summaryParts.push(`${supported} supported.`);
  if (contradicted > 0) summaryParts.push(`${contradicted} contradicted.`);
  if (unverifiable > 0) summaryParts.push(`${unverifiable} unverifiable.`);
  if (corrections.length > 0) {
    summaryParts.push(`Corrections: ${corrections.map((c) => c.correction!.slice(0, 80)).join("; ")}`);
  }

  return {
    status: "ok",
    text: req.text.slice(0, 200) + (req.text.length > 200 ? "..." : ""),
    source: req.source || "unknown",
    mode: effectiveMode,
    claims: results,
    claims_extracted: extractedClaims.length,
    claims_supported: supported,
    claims_contradicted: contradicted,
    claims_unverifiable: unverifiable,
    trust_score: Math.round(totalConfidence * 100) / 100,
    overall_verdict: overallVerdict,
    summary: summaryParts.join(" "),
    processing_time_ms: Date.now() - startTime,
  };
}

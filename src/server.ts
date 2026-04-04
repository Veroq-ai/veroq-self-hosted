/**
 * VeroQ Shield — Self-Hosted Server
 *
 * Runs inside your VPC. Uses your own LLM. Data never leaves your network
 * (unless you opt into external factual verification via VeroQ API).
 *
 * docker run -e LLM_API_KEY=sk-... -e LLM_MODEL=gpt-5.4-mini -p 3000:3000 veroq/shield
 */

import express from "express";
import { shield, type ShieldRequest } from "./shield.js";
import { configureLlm, getLlmConfig } from "./llm.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = parseInt(process.env.PORT || "3000");
const VEROQ_API_KEY = process.env.VEROQ_API_KEY || "";
const VEROQ_BASE_URL = process.env.VEROQ_BASE_URL || "https://api.veroq.ai";

// ── Health ──

app.get("/health", (_req, res) => {
  const llm = getLlmConfig();
  res.json({
    status: "ok",
    version: "1.0.0",
    llm: {
      provider: llm.baseUrl,
      model: llm.model,
    },
    modes: {
      groundedness: true,
      factual: !!VEROQ_API_KEY,
    },
  });
});

// ── Shield — main endpoint ──

app.post("/shield", async (req, res) => {
  try {
    const { text, context, source, max_claims, mode } = req.body || {};

    if (!text || typeof text !== "string") {
      res.status(400).json({ status: "error", message: "text is required (string)." });
      return;
    }

    const request: ShieldRequest = {
      text,
      context: context || undefined,
      source: source || undefined,
      maxClaims: max_claims || 5,
      mode: mode || (context ? "both" : VEROQ_API_KEY ? "factual" : "groundedness"),
      veroqApiKey: VEROQ_API_KEY || undefined,
      veroqBaseUrl: VEROQ_BASE_URL,
    };

    const result = await shield(request);
    res.json(result);
  } catch (err: any) {
    console.error("POST /shield error:", err.message);
    res.status(500).json({ status: "error", message: "Shield verification failed." });
  }
});

// ── Verify — single claim ──

app.post("/verify", async (req, res) => {
  try {
    const { claim, context, mode } = req.body || {};

    if (!claim || typeof claim !== "string") {
      res.status(400).json({ status: "error", message: "claim is required (string)." });
      return;
    }

    // Wrap single claim in shield
    const request: ShieldRequest = {
      text: claim,
      context: context || undefined,
      maxClaims: 1,
      mode: mode || (context ? "groundedness" : VEROQ_API_KEY ? "factual" : "groundedness"),
      veroqApiKey: VEROQ_API_KEY || undefined,
      veroqBaseUrl: VEROQ_BASE_URL,
    };

    const result = await shield(request);

    // Return simplified single-claim response
    const c = result.claims[0];
    res.json({
      status: "ok",
      claim,
      verdict: c?.verdict || "unverifiable",
      confidence: c?.confidence || 0,
      summary: c?.summary || result.summary,
      evidence: c?.evidence || [],
      correction: c?.correction || null,
      mode: c?.mode || result.mode,
      processing_time_ms: result.processing_time_ms,
    });
  } catch (err: any) {
    console.error("POST /verify error:", err.message);
    res.status(500).json({ status: "error", message: "Verification failed." });
  }
});

// ── Extract — just extract claims, no verification ──

app.post("/extract", async (req, res) => {
  try {
    const { text, max_claims } = req.body || {};

    if (!text || typeof text !== "string") {
      res.status(400).json({ status: "error", message: "text is required (string)." });
      return;
    }

    const { extractClaims } = await import("./shield.js");
    const startTime = Date.now();
    const claims = await extractClaims(text, max_claims || 10);

    res.json({
      status: "ok",
      claims,
      count: claims.length,
      processing_time_ms: Date.now() - startTime,
    });
  } catch (err: any) {
    console.error("POST /extract error:", err.message);
    res.status(500).json({ status: "error", message: "Claim extraction failed." });
  }
});

// ── Config — show current LLM config (no secrets) ──

app.get("/config", (_req, res) => {
  const llm = getLlmConfig();
  res.json({
    llm: {
      base_url: llm.baseUrl,
      model: llm.model,
      max_tokens: llm.maxTokens,
      temperature: llm.temperature,
    },
    veroq: {
      api_configured: !!VEROQ_API_KEY,
      base_url: VEROQ_BASE_URL,
    },
    modes: {
      groundedness: "Always available — provide document context with your request",
      factual: VEROQ_API_KEY
        ? "Available — claims verified against live external evidence via VeroQ API"
        : "Not configured — set VEROQ_API_KEY to enable external fact-checking",
    },
  });
});

// ── Start ──

app.listen(PORT, () => {
  const llm = getLlmConfig();
  console.log("");
  console.log("  VeroQ Shield (self-hosted) running on port", PORT);
  console.log("");
  console.log("  LLM:", llm.model, "@", llm.baseUrl);
  console.log("  Groundedness mode: enabled (provide document context)");
  console.log("  Factual mode:", VEROQ_API_KEY ? "enabled (VeroQ API)" : "disabled (set VEROQ_API_KEY)");
  console.log("");
  console.log("  POST /shield   — verify any LLM output");
  console.log("  POST /verify   — verify a single claim");
  console.log("  POST /extract  — extract claims without verifying");
  console.log("  GET  /health   — health check");
  console.log("  GET  /config   — show configuration");
  console.log("");
});

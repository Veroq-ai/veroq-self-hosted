<p align="center">
  <img src="https://veroq.ai/veroq-logo.png" alt="VeroQ" width="80" />
</p>

<h1 align="center">VeroQ Shield (Self-Hosted)</h1>

<p align="center">
  <strong>LLM output verification inside your VPC. Your models. Your data. Nothing leaves your network.</strong>
</p>

<p align="center">
  <a href="https://veroq.ai"><img src="https://img.shields.io/badge/cloud-veroq.ai-blue" alt="Cloud" /></a>
  <a href="https://github.com/veroq-ai/shield"><img src="https://img.shields.io/badge/shield-sdk-brightgreen" alt="Shield SDK" /></a>
  <a href="https://github.com/veroq-ai/veroq-self-hosted/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
</p>

---

Every AI team hits the same wall: your LLM generates confident-sounding text, but you can't ship it without knowing if it's actually correct. Cloud verification APIs solve this — but enterprise teams can't send internal documents, earnings data, or patient records to a third-party service.

VeroQ Shield (Self-Hosted) runs the same verification engine inside your infrastructure. Use your own LLM. Keep your data on-prem. Get the same claim-level verification with zero data exposure.

## How It Works

```
Your LLM output + Your documents (optional)
                |
                v
    ┌───────────────────────┐
    │   VeroQ Shield        │    Runs inside your VPC
    │   (self-hosted)       │    Uses YOUR LLM provider
    │                       │
    │  1. Extract claims    │    "Revenue was $2.4B"
    │  2. Verify each one   │    "Document says $2.1B"
    │  3. Return verdicts   │    verdict: contradicted
    └───────────────────────┘
                |
         ┌──────┴──────┐
         |             |
    Groundedness    Factual (opt-in)
    (local only)    (VeroQ API)
         |             |
    "Does it match  "Is it actually
     your docs?"     true IRL?"
```

## Two Verification Modes

| Mode | What it checks | Where it runs | Data leaves your network? |
|------|---------------|---------------|--------------------------|
| **Groundedness** | Did the LLM stay faithful to your documents? | Your infrastructure | **No** |
| **Factual** | Are the claims actually true in the real world? | VeroQ API (opt-in) | Only the extracted claims |

**Why both matter:** A RAG system can be perfectly grounded — the LLM faithfully cited the document — but the document itself can be wrong. Running both modes catches errors that neither mode catches alone.

**Real example from our tests:**

> "Apple had $124B in Q1 2025 revenue"
>
> - **Groundedness**: Supported (internal analyst note says $124.3B)
> - **Factual**: Contradicted (real-world data shows $144B — the analyst note was outdated)

Without both modes, this error ships to production.

## Quick Start

### Docker

```bash
docker run -p 3000:3000 \
  -e LLM_BASE_URL=https://api.openai.com/v1 \
  -e LLM_API_KEY=sk-... \
  -e LLM_MODEL=gpt-5.4-mini \
  veroq/shield
```

### Docker Compose

```bash
cp .env.example .env
# Edit .env with your LLM provider details
docker compose up
```

### npm

```bash
npm install && npm run build
LLM_API_KEY=sk-... LLM_MODEL=gpt-5.4-mini npm start
```

### Air-Gapped (Ollama)

```bash
# No internet required — runs entirely on your hardware
docker run -p 3000:3000 \
  -e LLM_BASE_URL=http://host.docker.internal:11434/v1 \
  -e LLM_API_KEY=none \
  -e LLM_MODEL=llama3 \
  veroq/shield
```

## Usage

### Groundedness — Verify against your documents

Your RAG pipeline generates a response. Before returning it to the user, pass both the response and the retrieved context to Shield:

```bash
curl -X POST http://localhost:3000/shield \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The company reported $2.4B in Q3 revenue, up 15% year-over-year.",
    "context": "Q3 2024 Earnings: Revenue was $2.1B, representing 12% YoY growth...",
    "mode": "groundedness"
  }'
```

```json
{
  "status": "ok",
  "trust_score": 0.95,
  "claims_extracted": 2,
  "claims_contradicted": 2,
  "overall_verdict": "has_corrections",
  "claims": [
    {
      "text": "The company reported $2.4B in Q3 revenue",
      "verdict": "contradicted",
      "confidence": 1.0,
      "correction": "The company reported $2.1B in Q3 revenue.",
      "evidence": [{"source": "provided_context", "snippet": "Revenue was $2.1B, representing 12% YoY growth."}],
      "mode": "groundedness"
    },
    {
      "text": "up 15% year-over-year",
      "verdict": "contradicted",
      "confidence": 0.9,
      "correction": "Q3 revenue was up 12% year-over-year.",
      "evidence": [{"source": "provided_context", "snippet": "Revenue was $2.1B, representing 12% YoY growth."}],
      "mode": "groundedness"
    }
  ],
  "processing_time_ms": 2442
}
```

Caught both errors. 2.4 seconds. All local.

### Factual — Verify against real-world evidence

When you need to check if claims are actually true (not just grounded in your docs), enable factual mode. This calls the VeroQ API to verify against live web sources, financial data, and public records:

```bash
curl -X POST http://localhost:3000/shield \
  -H "Content-Type: application/json" \
  -d '{
    "text": "NVIDIA reported $22B in Q4 2024 revenue, beating analyst estimates.",
    "mode": "factual"
  }'
```

### Both — Maximum coverage

The most powerful configuration. Run groundedness and factual verification simultaneously:

```bash
curl -X POST http://localhost:3000/shield \
  -H "Content-Type: application/json" \
  -d '{
    "text": "According to our research, Apple had $124B in Q1 2025 revenue.",
    "context": "Internal analyst note: Apple Q1 FY2025 revenue was $124.3B per the 10-Q filing.",
    "mode": "both"
  }'
```

Returns two verdicts per claim — one from your documents, one from the real world. If they disagree, you know something is stale or wrong.

### Single claim verification

```bash
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "claim": "Apple revenue grew 15% in Q1 2025",
    "context": "Apple Q1 2025 earnings: Revenue $124.3B, up 4% YoY..."
  }'
```

### Extract claims only

Pull out the verifiable statements without running verification — useful for building your own verification pipeline:

```bash
curl -X POST http://localhost:3000/extract \
  -H "Content-Type: application/json" \
  -d '{"text": "Tesla delivered 500K vehicles in Q4, beating the 480K estimate."}'
```

## LLM Providers

Works with any OpenAI-compatible API. Use the model you're already paying for:

| Provider | LLM_BASE_URL | Example Model |
|----------|-------------|-----------|
| **OpenAI** | `https://api.openai.com/v1` | `gpt-5.4-mini` |
| **Azure OpenAI** | `https://YOUR.openai.azure.com/...` | `gpt-5.4-mini` |
| **Ollama** (local) | `http://localhost:11434/v1` | `llama3`, `mistral` |
| **vLLM** (local) | `http://localhost:8000/v1` | Any HuggingFace model |
| **NVIDIA NIM** | `https://integrate.api.nvidia.com/v1` | `meta/llama3-70b-instruct` |
| **Together AI** | `https://api.together.xyz/v1` | `meta-llama/Llama-3-70b-chat-hf` |
| **Fireworks** | `https://api.fireworks.ai/inference/v1` | `llama-v3-70b-instruct` |
| **Groq** | `https://api.groq.com/openai/v1` | `llama3-70b-8192` |

For fully air-gapped deployments, use Ollama or vLLM. No internet connection required.

## Security & Compliance

- **Data isolation**: Groundedness mode never sends data outside your network. The LLM calls go to your configured provider — if that's a local Ollama instance, nothing touches the internet.
- **Factual mode is opt-in**: Only extracted claim text (not your documents) is sent to VeroQ API. No context, no metadata, no user information.
- **No persistent storage**: Shield is stateless. No database, no logs of your content, no telemetry. Request in, response out.
- **Compliance ready**: Runs on your already-audited infrastructure with your approved LLM provider. No new vendor to vet — Shield inherits your existing compliance posture.
- **Open source**: Full source code. Audit it, modify it, deploy it however you need.

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /shield` | Verify any LLM output — extract claims + verify each one |
| `POST /verify` | Verify a single claim against context or external evidence |
| `POST /extract` | Extract verifiable claims from text (no verification) |
| `GET /health` | Health check with LLM provider status |
| `GET /config` | Current configuration (no secrets exposed) |

### POST /shield

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | The LLM output to verify |
| `context` | string | No | Document context for groundedness verification |
| `source` | string | No | Source identifier (e.g., "gpt-5.4", "internal-rag") |
| `max_claims` | number | No | Max claims to extract (1-20, default 5) |
| `mode` | string | No | `"groundedness"`, `"factual"`, or `"both"` (auto-detected if omitted) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_BASE_URL` | Yes | `https://api.openai.com/v1` | Your LLM provider's OpenAI-compatible endpoint |
| `LLM_API_KEY` | Yes | — | API key for your LLM (use `none` for local models) |
| `LLM_MODEL` | Yes | `gpt-5.4-mini` | Model for claim extraction and groundedness |
| `LLM_MAX_TOKENS` | No | `2000` | Max tokens per LLM call |
| `LLM_TEMPERATURE` | No | `0` | Temperature (0 = deterministic) |
| `VEROQ_API_KEY` | No | — | Enables factual mode via VeroQ cloud API |
| `VEROQ_BASE_URL` | No | `https://api.veroq.ai` | VeroQ API endpoint |
| `PORT` | No | `3000` | Server port |

## Cloud vs Self-Hosted

| Feature | VeroQ Cloud | VeroQ Self-Hosted |
|---------|-------------|-------------------|
| Groundedness (local docs) | — | Yes |
| Factual (real-world evidence) | Yes | Opt-in via cloud API |
| Both modes | — | Yes |
| Your own LLM | — | Yes |
| Air-gapped deployment | — | Yes |
| Verification receipts | Yes | — |
| 300+ intelligence endpoints | Yes | — |
| Shared receipt cache | Yes | — |
| Zero infrastructure | Yes | — |
| Data stays on-prem | — | Yes |
| **Best for** | Developers, startups | Enterprise, regulated industries |

## Part of VeroQ

Self-hosted Shield is the enterprise deployment option for [VeroQ](https://veroq.ai) — the verified intelligence platform for AI agents.

- **Cloud API**: [veroq.ai](https://veroq.ai) — 300+ endpoints, verification receipts, multi-agent swarm
- **Shield SDK**: `pip install veroq` / `npm install @veroq/sdk` — one function call to verify any LLM
- **MCP Server**: [veroq-mcp](https://github.com/veroq-ai/veroq-mcp) — 62 tools for Claude, Cursor, and MCP clients
- **GitHub**: [github.com/veroq-ai](https://github.com/veroq-ai)

## License

MIT

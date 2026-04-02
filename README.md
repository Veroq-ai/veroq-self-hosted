<p align="center">
  <h1 align="center">VeroQ Shield (Self-Hosted)</h1>
  <p align="center"><strong>Run LLM verification inside your VPC. Your models. Your data. Nothing leaves your network.</strong></p>
</p>

---

VeroQ Shield verifies any LLM output by extracting claims and checking each one. The self-hosted version runs entirely inside your infrastructure using your own LLM provider.

## Two Verification Modes

| Mode | What it checks | Where it runs | Data leaves your network? |
|------|---------------|---------------|--------------------------|
| **Groundedness** | Did the LLM stay faithful to the retrieved documents? | Locally (your LLM) | No |
| **Factual** | Are the claims actually true in the real world? | VeroQ API (opt-in) | Only the claims |

Run both modes together for maximum coverage: groundedness catches RAG hallucinations, factual catches real-world inaccuracies.

## Quick Start

### Docker

```bash
docker run -p 3000:3000 \
  -e LLM_BASE_URL=https://api.openai.com/v1 \
  -e LLM_API_KEY=sk-... \
  -e LLM_MODEL=gpt-4o-mini \
  veroq/shield
```

### Docker Compose

```bash
cp .env.example .env
# Edit .env with your LLM provider details
docker compose up
```

### Local (npm)

```bash
npm install
npm run build
LLM_API_KEY=sk-... npm start
```

## Usage

### Groundedness — Verify against your documents

```bash
curl -X POST http://localhost:3000/shield \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The company reported $2.4B in Q3 revenue, up 15% year-over-year.",
    "context": "Q3 2024 Earnings: Revenue was $2.1B, representing 12% YoY growth...",
    "mode": "groundedness"
  }'
```

Response:
```json
{
  "status": "ok",
  "trust_score": 0.35,
  "claims_extracted": 2,
  "claims_contradicted": 2,
  "claims": [
    {
      "text": "The company reported $2.4B in Q3 revenue",
      "verdict": "contradicted",
      "confidence": 0.9,
      "summary": "The context states Q3 revenue was $2.1B, not $2.4B",
      "correction": "Revenue was $2.1B according to the earnings report",
      "mode": "groundedness"
    },
    {
      "text": "up 15% year-over-year",
      "verdict": "contradicted",
      "confidence": 0.9,
      "summary": "The context states 12% YoY growth, not 15%",
      "correction": "YoY growth was 12% per the earnings report",
      "mode": "groundedness"
    }
  ]
}
```

### Factual — Verify against real-world evidence

```bash
# Requires VEROQ_API_KEY
curl -X POST http://localhost:3000/shield \
  -H "Content-Type: application/json" \
  -d '{
    "text": "NVIDIA reported $22B in Q4 revenue, beating analyst estimates.",
    "mode": "factual"
  }'
```

### Both — Maximum coverage

```bash
curl -X POST http://localhost:3000/shield \
  -H "Content-Type: application/json" \
  -d '{
    "text": "According to our research, NVIDIA reported $22B in Q4 revenue.",
    "context": "Internal research note: NVIDIA Q4 earnings showed revenue of $22.1B...",
    "mode": "both"
  }'
```

### Single claim verification

```bash
curl -X POST http://localhost:3000/verify \
  -H "Content-Type: application/json" \
  -d '{
    "claim": "Apple revenue grew 15% in Q1 2025",
    "context": "Apple Q1 2025 earnings: Revenue $124.3B, up 4% YoY..."
  }'
```

### Extract claims only (no verification)

```bash
curl -X POST http://localhost:3000/extract \
  -H "Content-Type: application/json" \
  -d '{"text": "Tesla delivered 500K vehicles in Q4, beating the 480K estimate."}'
```

## LLM Providers

Works with any OpenAI-compatible API:

| Provider | LLM_BASE_URL | LLM_MODEL |
|----------|-------------|-----------|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |
| Azure OpenAI | `https://YOUR.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT/v1` | `gpt-4o-mini` |
| Ollama (local) | `http://localhost:11434/v1` | `llama3` |
| vLLM | `http://localhost:8000/v1` | `your-model` |
| NVIDIA NIM | `https://integrate.api.nvidia.com/v1` | `meta/llama3-70b-instruct` |
| Together AI | `https://api.together.xyz/v1` | `meta-llama/Llama-3-70b-chat-hf` |
| Fireworks | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/llama-v3-70b-instruct` |
| Groq | `https://api.groq.com/openai/v1` | `llama3-70b-8192` |

For fully air-gapped deployments, use Ollama or vLLM with a local model. No internet required.

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/shield` | POST | Verify any LLM output (extract claims + verify) |
| `/verify` | POST | Verify a single claim |
| `/extract` | POST | Extract claims without verifying |
| `/health` | GET | Health check + LLM provider status |
| `/config` | GET | Show current configuration (no secrets) |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_BASE_URL` | Yes | `https://api.openai.com/v1` | OpenAI-compatible API base URL |
| `LLM_API_KEY` | Yes | — | API key for your LLM provider |
| `LLM_MODEL` | Yes | `gpt-4o-mini` | Model to use for claim extraction + groundedness |
| `LLM_MAX_TOKENS` | No | `2000` | Max tokens per LLM call |
| `LLM_TEMPERATURE` | No | `0` | Temperature for LLM calls |
| `VEROQ_API_KEY` | No | — | Enables factual verification via VeroQ API |
| `VEROQ_BASE_URL` | No | `https://api.veroq.ai` | VeroQ API base URL |
| `PORT` | No | `3000` | Server port |

## Part of VeroQ

Self-hosted Shield is the enterprise deployment option for [VeroQ](https://veroq.ai). For the cloud API with 300+ endpoints, verification receipts, and the full verified intelligence platform:

- **Cloud API**: [veroq.ai](https://veroq.ai)
- **Shield (cloud)**: `pip install veroq` / `npm install @veroq/sdk`
- **GitHub**: [github.com/veroq-ai](https://github.com/veroq-ai)

## License

MIT

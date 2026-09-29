# Integration contracts — Fixtech Demo v1.8

## Local AI provider (Demo v1.8.4)

The supported Demo adapter is Ollama on loopback, default model `gemma3:4b`; configure `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434`, and `OLLAMA_MODEL=gemma3:4b`. Install/pull the model separately. The app rejects non-loopback hosts and the provider factory refuses `AI_PROVIDER=ollama` when `NODE_ENV=production`. Send only user-consented symptom text and selected images; best-effort redact email/phone/common address labels, but this is not guaranteed PII removal. Validate structured JSON. A deterministic post-check replaces recommendations matching known risky hardware-opening/cleaning or destructive-software patterns with a safe fallback; this narrow pattern check is not comprehensive safety moderation. Timeout, unavailable model, invalid response or revoked consent leaves the Job as Draft and returns a recoverable error. Unit tests use deterministic doubles. Local text and image transport/schema smoke tests with synthetic/local project data passed on 2026-09-25; the image case had a factual error, so those tests do not certify model quality. Use synthetic data only and do not include personal data in images. This local model, redaction and pattern guard are explicitly not production security/privacy controls; production requires a separately reviewed provider, privacy/DPA assessment, threat model, safety evaluation and human escalation policy.

## Curated price references (Demo v1.8.4)

The Demo does not claim real-time market access. `MARKET_PRICE_PROVIDER=curated_demo` uses manually reviewed public example service fees with source URLs and review date in `src/integrations/demo-price-reference.js`. The current indicative references are 300–2,500 THB for remote software support and 500–800 THB for hardware service examples; these ranges span different service tiers/providers and are not like-for-like quotes. Return `CURATED_PUBLIC_EXAMPLES`; display that it is indicative and not live. Do not call these Fixtech quotes or assert statistical representativeness. Missing mapping returns `ESTIMATE_UNAVAILABLE`. Pricing formula remains separate, deterministic, server-side and versioned in PostgreSQL. A future real service must pass permitted-source, freshness and data-quality gates.

## Safe implementation order

Keep Ollama and curated reference providers behind server-side interfaces, with deterministic test doubles, timeout/error normalization and contract tests. Persist provider/model and reference provenance. AI calls run outside DB transactions; persist results with version data and prevent stale responses from overwriting a newer analysis.

## Other boundaries

- File storage is private and access-controlled; do not expose storage keys as public URLs.
- Chat and notifications are in-app only; no SMS/email or realtime socket.
- Payment flow is simulation-only; do not collect card/bank credentials or call a payment gateway.
- Dispute resolution is performed by Admin; AI cannot decide outcomes.

See [SRS §13.3](software-requirements-v1.md), [API contracts](mvp-demo-design-v1.md), and [operations](operations.md) for the normative requirements.

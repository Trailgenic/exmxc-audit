# exmxc-audit

`exmxc-audit` is the evidence-collection and diagnostic module for exmxc Entity Clarity research. exmxc studies AI power, institutional perception, and capital allocation. This repository supports the Perception pillar; it does not define the institution.

## Current contract

`GET /api/audit?url=https://example.com` returns four separate layers:

1. **Collector delivery** — the requested/final URL, redirect chain, HTTP or network outcome, content type, and relevant response directives.
2. **Declared access** — a provider-by-purpose interpretation of the observed robots document for training, search, user-requested retrieval, and other named uses.
3. **Entity Clarity v2 review** — an experimental nine-check template. A single website fetch does not complete this review, so the automated response returns an unassessed score.
4. **Model representation** — explicitly `not_tested` unless a separately governed model-answer test has been attached.

The earlier EEI v2.1 structural score remains in `legacy_diagnostic` for migration and comparison. It is labeled as a website-structure proxy. It does not establish model comprehension, trust, citation, recommendation, or corporate intent.

## Evidence semantics

Collection and interpretation are deliberately separate:

- A timeout is `timeout`.
- A DNS failure is `dns_error`.
- A delivered non-HTML resource is `unsupported_content` and remains unscored.
- HTTP 401/403 is `access_restricted` delivery.
- HTTP 404/410 is `not_found`.
- HTTP 429 is `rate_limited`.
- HTTP 5xx is `server_error`.
- None of those outcomes automatically becomes intentional AI blocking or an Entity Clarity score of zero.

Declared access posture is `permissive`, `selective`, `restrictive`, or `unknown`. It summarizes the observed provider-purpose robots matrix for compatibility; the matrix is the authoritative output. Corporate strategy requires additional evidence.

Missing and unavailable evidence remains unknown. It is never silently converted into a zero score.

## Entity Clarity v2 pilot checks

The experimental reviewed assessment contains nine checks across three dimensions:

- Identity: entity/domain resolution, institutional scope, and entity relationships.
- Consistency: cross-surface claims, canonical/structured-data agreement, and official-record agreement.
- Evidence: claim traceability, source provenance, and appropriate independent corroboration.

Each applicable check is 0, 1, or 2 and requires evidence. A comparable pilot score is calculated only when all nine checks are assessed. The score is a transparent review convention, not a probability of model behavior. No High/Medium/Low bands are assigned during calibration.

## Collection controls

The static collector:

- Accepts public HTTPS targets on the standard port.
- Rejects credentials, IP literals, local/reserved host suffixes, non-public DNS answers, and mixed public/private DNS answers.
- Revalidates each redirect and uses the restricted DNS lookup on each request.
- Limits redirects, response size, and request time.
- Uses an identified exmxc collector user agent.

The prior rendered probe is disabled. A browser claiming to be GPTBot, ClaudeBot, or Googlebot does not verify genuine provider behavior. Rendered collection can return only after network isolation and policy controls are implemented and reviewed.

## Batch behavior

`GET /api/batch-run?dataset=core-web&start=0&limit=25` processes a bounded window of at most 50 URLs and returns the same evidence/result contract as the single audit. It reports completed observations, request errors, assessed/unassessed reviews, delivery outcomes, declared-access postures, and separately labeled legacy scores.

GET is read-only. Drift persistence requires an explicit `POST` with `persist=true`, and persistence is awaited so a response cannot imply that an unfinished write succeeded.

## Local verification

```bash
npm install
npm test
npm run test:mcp-reference
```

The integrity tests use local fixtures. They do not crawl third-party sites or write production data. They cover target validation, unsafe redirects, robots rule precedence, provider-purpose separation, `noindex`, failure semantics, review completeness, single/batch consistency, and the repaired multi-surface import.

## Historical boundary

Published ECI/ECC snapshots and PDFs belong to their original methodology. This repository does not rewrite those observations. Entity Clarity v2 should be introduced as a new version with an explicit bridge panel so collector or methodology changes cannot appear as company movement.

The canonical public data/query layer is maintained in `Trailgenic/exmxc-workers`.

To calculate a reviewed pilot assessment, copy `docs/entity-clarity-v2-review-template.json`, complete reviewer provenance and all nine checks with evidence, then run:

```bash
npm run assess:v2 -- path/to/completed-review.json
```

## Stewardship

exmxc was founded by Mike Ye. Human judgment governs methodology, review, and publication. AI supports collection, testing, and structured analysis.

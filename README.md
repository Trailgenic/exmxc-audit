# exmxc-audit

`exmxc-audit` is the evidence-collection and diagnostic module for exmxc Entity Clarity research. exmxc studies AI power, institutional perception, and capital allocation. This repository supports the Perception pillar; it does not define the institution.

## Current contract

`GET /api/audit?url=https://example.com` returns four separate layers:

1. **Collector delivery** — the requested/final URL, redirect chain, HTTP or network outcome, content type, and relevant response directives.
2. **Declared access** — a provider-by-purpose interpretation of the observed robots document for training, search, user-requested retrieval, and other named uses.
3. **Automated Entity Clarity v2.1** — a deterministic five-dimension structural score computed from successfully delivered homepage evidence.
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

When collection fails, unavailable page evidence remains unknown and never becomes a zero score. Once usable HTML is delivered, absence of a published structural signal is an observed absence and can contribute zero points.

## Automated Entity Clarity v2.1

The experimental score uses five deterministic dimensions:

- Identity resolution — title, primary heading, named entity schema, and a discoverable About/company surface.
- Entity consistency — same-origin canonical, Open Graph URL, schema identifier, and visible/structured name agreement.
- Relationship clarity — explicit external identity references, organizational relationships, and recognized identity-profile links.
- Evidence traceability — institutional description plus About, contact, and standards/governance/newsroom links.
- Machine legibility — language declaration, canonical, valid JSON-LD, Open Graph identity, and indexability.

Every signal returns its points and observed evidence. Successfully delivered static HTML receives a complete automated measurement; missing signals score zero because their absence was observed. Failed, restricted, timed-out, or unsupported collection remains unassessable and receives no score. No human review is required. No High/Medium/Low bands are assigned during calibration.

## Collection controls

The static collector:

- Accepts public HTTPS targets on the standard port.
- Rejects credentials, IP literals, local/reserved host suffixes, non-public DNS answers, and mixed public/private DNS answers.
- Revalidates each redirect and uses the restricted DNS lookup on each request.
- Limits redirects, response size, and request time.
- Uses an identified exmxc collector user agent.

The prior rendered probe is disabled. A browser claiming to be GPTBot, ClaudeBot, or Googlebot does not verify genuine provider behavior. Rendered collection can return only after network isolation and policy controls are implemented and reviewed.

## Batch behavior

`GET /api/batch-run?dataset=core-web&start=0&limit=25` processes a bounded window of at most 50 URLs and returns the same evidence/result contract as the single audit. It reports completed observations, request errors, scored/unassessable entities, delivery outcomes, declared-access postures, average automated Entity Clarity, and separately labeled legacy scores.

GET is read-only. Drift persistence requires an explicit `POST` with `persist=true`, and persistence is awaited so a response cannot imply that an unfinished write succeeded.

## Local verification

```bash
npm install
npm test
npm run test:mcp-reference
```

The integrity tests use local fixtures. They do not crawl third-party sites or write production data. They cover target validation, unsafe redirects, robots rule precedence, provider-purpose separation, `noindex`, failure semantics, automated score evidence, single/batch consistency, and the repaired multi-surface import.

## Historical boundary

Published ECI/ECC snapshots and PDFs belong to their original methodology. This repository does not rewrite those observations. Entity Clarity v2 should be introduced as a new version with an explicit bridge panel so collector or methodology changes cannot appear as company movement.

The canonical public data/query layer is maintained in `Trailgenic/exmxc-workers`.

## Stewardship

exmxc was founded by Mike Ye. Human judgment governs methodology and publication; production entity scoring is automated and evidence-backed.

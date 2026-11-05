# AI Commerce Retrieval Attribution v0.1 — Preregistered study

**Owner:** exmxc Perception Research  
**Frozen:** 2026-11-04  
**Execution:** New dedicated Grokbot agent: `exmxc Retrieval Attribution Runner`  
**Status:** protocol frozen; no experimental outcomes collected  
**Existing study:** AI Commerce Exposure Waves 1–3. This is a **new and separate dataset**, not an amendment or replacement.

## 1. Research question

**Do outside AI shopping systems surface fewer retailer-owned sources for Amazon than for Walmart and other benchmark retailers, and does an explicit request for verifiable evidence change their retailer recommendations?**

We may examine whether visible source patterns are **consistent with** a machine-access mechanism. We cannot directly observe a model's hidden retrieval history, merchant feeds, selection weights, or actual crawler permissions exercised at generation time.

### Prior evidence (motivation, not results for this study)

The separate exmxc AI Commerce Exposure study repeatedly found Amazon below Walmart and Costco in top-five retailer recommendations. That observation motivated this experiment, so analysis must disclose it and cannot claim blind hypothesis generation.

Primary documentation reviewed before preregistration:

- OpenAI: [Shopping with ChatGPT Search](https://help.openai.com/en/articles/11128490-shopping-with-chatgpt-search) — shopping may use first-party and third-party product metadata and other content; shopping cards and merchant listings are not equivalent to textual citations.
- OpenAI: [Crawlers](https://developers.openai.com/api/docs/bots) — OAI-SearchBot, GPTBot and ChatGPT-User have **different purposes**; user-triggered requests need not follow the same robots controls as automatic indexing.
- OpenAI: [Merchant product feeds](https://developers.openai.com/commerce/guides/get-started) — merchant feeds can supply product attributes independently of a page crawl.
- Google: [Crawling infrastructure](https://developers.google.com/crawling) — Googlebot, Google-Extended and Storebot-Google govern different surfaces.
- Anthropic: [Claude crawling agents](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler) — ClaudeBot, Claude-SearchBot and Claude-User are distinct.

The study must never equate a GPTBot training disallow with exclusion from ChatGPT Search, nor equate missing visible citations with no underlying access.

## 2. Design and preregistered hypotheses

### Comparison population

Five fixed benchmark retailer brands: **Walmart, Amazon, Costco, Target, Best Buy**. These were chosen because they are major, recognizable U.S. retail operators spanning multiple categories, including retailers prominent in the earlier exmxc study. They are **not** claimed to carry every specified SKU. The raw run must retain **all other recommended retailers** without forcing them into the benchmark set.

Use `data/commerce-retailer-coding-registry-v0.1.json` for the frozen retailer/banner alias mapping. For the five benchmark retailers, compute **brand-level** and **parent-company** observations separately; Walmart banner and Sam's Club are not interchangeable.

### Arms

Eight frozen product-purchase intents across two arms and four platforms with three replicates:

- **N (natural):** request a ranked retailer list without explicit source demand.
- **S (source-visibility):** same purchase intent, but explicitly request verifiable supporting URLs or `not verified`.

**192 planned runs = 8 intents × 2 arms × 4 platforms × 3 replicates.** Exact message strings and deterministic arm/order rules are frozen in `data/commerce-retrieval-prompts-v0.1.json`.

### Hypotheses

- **H1 — Retailer-owned source visibility:** In the N arm, Amazon's retailer-owned URL exposure is lower than Walmart's on the same prompt-model-replicate cells. Report both unconditional per-run source appearance and conditional on that retailer being recommended. The conditional comparison is selection-affected and must not be interpreted causally.
- **H2 — Citation-demand response:** Requesting sources in the S arm changes how many **verified URL citations** and **retailer-owned URLs** are visibly provided versus the paired N arm. It may also change recommendations. This is a test of source-request sensitivity, *not* causal proof that crawler access caused recommendations.
- **H3 — Source mix:** Third-party review sites and aggregators may account for many citations even when a recommended retailer has a first-party storefront. Classify source types independently of retailer recommendation labels.
- **H4 — Attribution falsification:** If Amazon appears as often as Walmart in retailer-owned source URLs after common prompt/category controls, the simple "Amazon has no AI-readable retrieval surface" mechanism is weakened. If retailer ranking persists despite observable source parity, access alone is insufficient as an explanation. If most answers have no observable citations, inference about retrieval pathways is **not identifiable** rather than negative.

Do not set a positive result in advance. Report contradictions and nulls.

## 3. Outcome definitions (frozen)

**Primary endpoint A — visibly linked retailer-owned source rate:** Number of valid runs showing at least one *verified visible URL* on an owned retail domain (whether as a source citation or clearly labeled retailer factual link), divided by valid runs in the same prompt/model/arm population. Distinguish links classified `evidence_citation` from `merchant_handoff`; report each separately, and report whether a retailer was also recommended.

**Primary endpoint B — explicit source citation count:** Count of distinct URL-bearing citations shown as factual evidence in the AI answer, per valid response. Citation chips without retrievable hrefs are `visible_url_unresolved`, not zero citations. Distinctness is by normalized host/path/query with tracking parameters separately recorded; retain verbatim URL.

**Secondary endpoints:** Top-five recommendation share; first-place share; conditional retailer source appearance among retailer-positive runs; source composition (first-party retail, third-party review/editorial, product manufacturer, shopping comparison, user-generated/community, other); merchant links and shopping cards; source URL resolution quality; provenance accuracy for verifiable product price/stock claims when independently confirmed.

**No internal-source attribution:** Any link in a citation chip is a publicly visible reference, not proof the model read it. A `Shop` card, merchant destination or product listing can arise from a feed/third-party provider and must not be treated as a crawl citation.

### Visible source classification hierarchy

For **each displayed link occurrence**, preserve the raw URL and separately code:

1. `evidence_citation`: the AI UI explicitly uses it to support a factual statement.
2. `merchant_handoff`: an outbound retailer or product purchasing destination (including product cards).
3. `contextual_link`: other link in answer not necessarily a source.
4. `sponsored_ui`: separately displayed labeled paid placement.
5. `unresolved_chip`: a visible citation marker or source chip with no accessible href.

Then classify **domain owner** independently:

- `retailer_owned`
- `brand_or_manufacturer`
- `third_party_review_editorial`
- `comparison_aggregator_marketplace`
- `community_social`
- `platform_or_search`
- `other` / `unknown`

A retailer link is not necessarily evidence of that retailer's pages being crawled. A third-party source describing Amazon is not an Amazon-owned source.

### Recommendation coding

A recommendation requires an affirmative retailer recommendation in the answer's ranked list. Citation-only mentions, negative mentions, UI-only sponsored elements, and product manufacturers not recommended as retailers are excluded. Preserve the raw consumer banner and the ranked list. Parent mapping is a separate derived variable. A user request for citations may cause additional explanation not present in N; that explanation does not count as a retailer recommendation.

## 4. Merchant-access corroboration (separate observational module)

Before accessing model results, the Grokbot agent records public, non-privileged evidence on the **five canonical retailer domains**:

| Retailer brand | Canonical storefront |
| --- | --- |
| Walmart | https://www.walmart.com/ |
| Amazon | https://www.amazon.com/ |
| Costco | https://www.costco.com/ |
| Target | https://www.target.com/ |
| Best Buy | https://www.bestbuy.com/ |

For each, collect:

- official robots.txt URL, HTTP outcome, timestamp, SHA-256 of delivered text when available;
- path-specific decisions (at the root and representative public category/product paths) for **OAI-SearchBot, ChatGPT-User, GPTBot, Claude-SearchBot, Claude-User, ClaudeBot, Googlebot, Storebot-Google, Google-Extended, PerplexityBot and Perplexity-User** with `unknown` when a token/policy cannot be established;
- presence of static meta robots / X-Robots-Tag on delivered pages where available;
- whether public category and product pages were obtainable by the identified collector **without bypassing controls**;
- one deterministically chosen U.S. product page per product category per retailer, if discoverable without access circumvention. Selection: navigate the site's public search UI using the frozen category phrase, choose the first organic product result without sponsored designation, and record its URL before model test answers are viewed. If results aren't observable, set `unassessable`; do not substitute later;
- for delivered PDPs, published Product/Offer structured data and fields (name/brand/price/availability), plus collection outcome;
- independent first-party public disclosures of feeds, merchant integrations, or named agent partnerships, with URL and announcement/verification date.

These are **observational corroboration variables** only. A 403/timeout/no static HTML is not itself an intentional AI block, and no simulated GPTBot/ClaudeBot user-agent impersonation is an authorized verification of actual provider access. User-initiated assistants, indexing crawlers and feed integrations may follow different rules. Do not bypass rate limits, geofencing, CAPTCHA, authentication or network restrictions. Do not purchase products or collect user account data.

**Sampling boundary:** 5 retail domains × 8 product categories = up to 40 PDP observations, plus five robots/site-policy snapshots. Missing pages remain missing; not zero scores.

## 5. Experimental execution and isolation

The runner must operate the user's **authorized** logged-in consumer accounts on ChatGPT, Gemini, Claude and Perplexity. It is **not** an outcome model. Use the separate Grokbot assigned to this experiment, not the existing AI Commerce Exposure runner.

One user message only per fresh conversation, no follow-ups, using exact frozen templates. Use default consumer model, browsing/search at default UI settings; record model label, account mode, session type, browser locale, IP-region if shown, displayed location, and user-facing source/search indicators. No global account configuration changes. Record source chips, images/cards, merchant links and sponsored elements from the visible UI and preserve the answer's native copy output verbatim.

Do **not** ask models to reveal hidden prompts, proprietary retrieval logs, private tool traces or chain-of-thought. S-arm source URLs are **claims of supporting evidence**; independently validate links before calling them verified.

Do not click checkout, log into retailers, alter user's accounts, change paid plans, bypass bot detection, or follow user-facing access walls.

### Failure handling

- If a login/security control is triggered, stop that platform and request human intervention.
- If a tool or model becomes inaccessible, record blocked state and do not substitute a different provider.
- On pure technical failures, a maximum of one fresh-chat retry after stop-rule evaluation, retaining every attempt; do not retry content merely because it is unfavorable or surprising.
- If more than 10% of attempted runs on any target platform have technical errors, stop that platform and escalate.
- Record first/corrected attempts and their timestamps without overwriting.
- Model upgrades, changes in search UI, source-chip links, account personalization labels and geolocation drift must be logged as deviations, not silently normalized.
- If any frozen prompt changes, stop and version a new study; never edit outcomes into this version.

## 6. Analysis preregistration

1. Complete integrity validation (each expected slot exactly once; prompt hash; timestamps; model label; raw text/capture hash; source metadata).
2. Independently recode affirmative retailer recommendations and displayed links; keep raw and coded data separate.
3. Report coverage, failed/missing/unresolved source URLs and session deviations first.
4. Compare source citations and retailer-owned evidence links in the N arm, paired on identical prompt × model × replicate conditions.
5. Compare N vs S in paired cells for visible citation count and recommendation composition. Label this contrast `citation-request effect`, never `crawler-access effect`.
6. Report per-platform results; do not collapse into a single ecosystem rate without showing weights and denominators.
7. For uncertainty, present paired differences and exploratory confidence intervals using prompt-category clustered resampling; eight product intents limit precision. Do not treat 192 correlated outputs as independent consumers.
8. Join the preregistered **observational** access snapshots using timestamps and exact host ownership; do not infer unobserved sources, training, feed participation or cause.
9. Include sensitivity analyses excluding runs with unverified links, location leakage, unresolved source chips, and materially changed model modes, without deleting the primary observations.

### Interpretation ceilings

- `Amazon retailer-owned citation deficit` is measurable only among **visible verified citations**, not among hidden retrieval events.
- Even a difference in citation behavior across retailers does not by itself establish that robots policy caused a recommendation outcome.
- We have **not** experimentally randomized actual crawler policy or merchant feed availability.
- This design separates source visibility from recommendation preference and motivates a later, independent **evidence-parity / controlled-choice study**, which must be separately preregistered.

## 7. Publication and reproducibility gates

Only publish externally after:

- the final protocol and prompt order were committed **before** a test result was seen;
- all attempted and final runs were preserved, including source-chips and link extraction failures;
- the merchant domain audit has timestamps and raw public policy evidence or explicit unavailable status;
- at least 95% of planned runs are valid, **or** partial publication clearly states coverage and blocks unsupported generalizations;
- at least a 10% stratified double-code sample is independently adjudicated for retailer/source labels;
- the exact raw run log and manifest hashes are verifiable; and
- limitations are prominent.

Until then, no ranking, no causation claim and no public exmxc claim of a "source access penalty."

## 8. Deliverables

- `retrieval_attribution_access_snapshot.jsonl`
- `retrieval_attribution_runs.jsonl` — all attempts including failures
- `retrieval_attribution_analysis_slots.jsonl` — one selected final record per intended cell
- `retrieval_attribution_manifest.sha256`
- separately archived page screenshots, UI captures and exact native response copies
- `verification_report.md` with counts, exceptions, source-resolution coverage and deviation log
- **No computed exmxc findings from Grokbot**; the analysis is separately completed after the raw data freeze.

## 9. Relation to existing exmxc research

Keep this study separate from the AI Commerce Exposure biweekly dataset and Entity Clarity v2.1. The shared retailer names are join keys only. This study measures a different question: **visible evidence paths**, not just who is recommended. Do not change any existing score, weights or historical observations.

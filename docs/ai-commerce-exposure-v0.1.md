# AI Commerce Exposure v0.1

**Status:** experimental research specification  
**Snapshot date:** 2026-10-07  
**Publication status:** unpublished  
**Owner:** exmxc Perception research

## Research question

As product discovery shifts toward AI systems, which retailer characteristics are associated with appearing in an AI-generated consideration set, and which characteristics are associated with ultimately capturing the transaction?

The working hypothesis is:

> External AI recommendation share is jointly related to machine access, product legibility, commerce integration, third-party authority, retailer scale, and consumer value proposition. Transaction capture is a separate outcome influenced by habit, fulfillment, price, trust, membership, and owned-platform effects.

This is a hypothesis to test, not a causal claim.

## Why this is separate from Entity Clarity

Automated Entity Clarity v2.1 remains unchanged.

Entity Clarity v2.1 measures structural identity clarity in delivered static homepage HTML. It does **not** measure AI recommendation, trust, citation, product eligibility, shopping rank, traffic, or transaction capture.

The current audit already separates:

1. collector delivery;
2. declared provider-purpose access;
3. Entity Clarity v2.1; and
4. model representation.

AI Commerce Exposure builds beside those layers. It must not be folded into the Entity Clarity score.

A retailer can be unassessable by the static homepage collector and still be recommended by an AI shopping system through product feeds, search indexes, third-party sources, partnerships, or other retrieval paths. That is a valid observation rather than an audit failure.

## Measurement stack

### A. External AI access

Measure what outside systems are explicitly permitted to retrieve or use.

Evidence may include:

- collector delivery outcome;
- robots.txt provider-purpose rules;
- search-specific crawlers;
- shopping-specific crawlers;
- user-requested retrieval controls;
- documented access restrictions; and
- verified first-party policy or platform documentation.

The existing provider-purpose matrix is the starting point. Shopping-specific controls belong here.

**Boundary:** declared robots policy is not equivalent to actual model behavior, corporate intent, or complete agent accessibility. User-triggered agents and direct catalog integrations can operate under different controls.

### B. Entity clarity

Reuse the existing Automated Entity Clarity v2.1 result as a separate observed variable.

Do not alter its weights, dimensions, score meaning, or failure semantics for this project.

### C. Product legibility

Measure a frozen sample of product detail pages or catalog records, not the retailer homepage.

Candidate observable fields:

- Product or Offer structured data;
- stable product identifier;
- SKU;
- GTIN/UPC/MPN when applicable;
- product title;
- brand;
- description;
- image;
- price and currency;
- availability / inventory status;
- seller;
- rating and review count;
- shipping information;
- returns information;
- canonical URL;
- indexability;
- static vs client-rendered availability of core facts; and
- discoverable product or merchant feeds where publicly verifiable.

A future deterministic product-legibility module should report field-level evidence. No composite score is authorized in v0.1.

### D. Agentic commerce integration

Record independently verifiable integrations with external AI commerce systems.

Examples of eligible evidence:

- documented ChatGPT commerce integration or merchant feed;
- Gemini / Google Shopping / UCP integration;
- Microsoft Copilot commerce integration;
- Meta or other agentic shopping integration;
- first-party app exposed inside an AI platform;
- account linking;
- loyalty linking;
- cart handoff;
- checkout integration; and
- documented protocol support such as ACP or UCP.

A partnership announcement is evidence of an integration only to the extent that the announced capability is specific and verifiable.

### E. Recommendation presence

This is the outcome variable and must be measured independently. It may never be inferred from access, Entity Clarity, product markup, or partnerships.

For each frozen prompt-model run, record:

- model and version when available;
- date/time;
- geography / locale;
- logged-in or stateless condition;
- prompt ID;
- retailer mentions;
- mention order;
- recommendation language;
- merchant or product links;
- cited sources when exposed; and
- whether the response refused, searched, browsed, or returned no retailer.

Primary metrics:

- **Recommendation Share:** valid runs mentioning retailer / all valid runs for which retailer is category-eligible.
- **First-Position Share:** valid runs placing retailer first / category-eligible valid runs.
- **Linked Merchant Share:** valid runs linking to retailer / category-eligible valid runs.

Prompts and eligibility rules must be frozen before data collection. Prompt wording cannot be changed after observing retailer outcomes.

### F. Transaction accessibility

Measure whether an AI-assisted shopper can proceed from recommendation toward purchase.

Classify observed transaction path, without ranking it:

- no direct handoff observed;
- product-page handoff;
- prefilled cart / basket handoff;
- account or loyalty-linked handoff;
- external checkout handoff; or
- native / agentic checkout.

Transaction accessibility is not the same as actual transaction capture.

### G. Owned AI commerce capability

Measure retailer-controlled AI shopping capability separately from external openness.

Candidate observations:

- owned shopping assistant;
- personalized recommendation agent;
- conversational product discovery;
- shopping-list or basket construction;
- owned agentic checkout / delegated purchase;
- adoption or usage disclosures; and
- disclosed conversion or order-value effects.

This axis prevents a strategically closed retailer with a strong first-party AI system from being mislabeled "AI unready."

## Strategic architecture map

Two independent strategic axes should be preserved:

- **External AI distribution openness**
- **Owned AI commerce capability**

Working quadrant labels:

- **Federated commerce:** high external openness, high owned capability.
- **Walled intelligence:** low external openness, high owned capability.
- **Open dependency:** high external openness, low owned capability.
- **Closed / absent:** low external openness, low owned capability.

Retailers must not be assigned to a quadrant until the required evidence has been collected.

## Population

The first benchmark population is the **2026 NRF Top 30 U.S. retailers**, ranked by 2025 U.S. retail sales.

Reasons:

- independent sample frame established before outcome collection;
- includes Walmart, Amazon, Costco, Target, Aldi, Best Buy, BJ's, and Dick's;
- retailer scale can be retained as a control variable; and
- avoids selecting only retailers already known to perform well or poorly in AI recommendations.

The frozen population lives in `data/commerce-retail-2026-top30.json`.

### Surface selection rule

NRF ranks companies, but some companies operate multiple consumer banners. Do not automatically substitute a corporate homepage or a single banner.

Before collection, create a separate versioned surface registry. Each company must be classified as one of:

- single primary U.S. consumer commerce surface;
- multiple banners with an explicit sampling rule;
- service / telecom commerce surface;
- store-led retailer with limited online transaction capability; or
- not comparable for a particular measurement layer.

Any exclusion must be made before observing recommendation outcomes and must be retained in the dataset.

## Product sampling

For product-legibility measurement, use category-stratified sampling rather than cherry-picked PDPs.

Minimum proposed protocol per eligible retailer:

- 5 product detail pages;
- sampled across at least 3 major categories when the retailer is multi-category;
- at least 1 first-party/private-label product when applicable;
- no manual substitution after a page is found to have weak markup unless the URL is invalid or the product is unavailable under the prespecified rule.

The exact sampling method and random seed must be frozen before collection.

## Recommendation experiment

The recommendation experiment should be preregistered in the repository before runs begin.

At minimum it should freeze:

- prompt set;
- category eligibility matrix;
- participating models;
- geographic condition;
- session state;
- browsing/search permission;
- run count;
- retry rule;
- invalid-run rule; and
- output coding schema.

The experiment should include both generic retailer-discovery prompts and product-specific prompts. Local inventory or membership questions should be separated from national recommendation prompts because location and membership can dominate the answer.

Do not reuse published third-party recommendation rankings as exmxc observations. They are external evidence and comparison data only.

### Wave 1 execution harness

Wave 1 uses Grok bot as the browser/execution harness to operate the researcher's authorized consumer accounts for ChatGPT, Perplexity, Gemini, and Claude.

Grok is deliberately **not** a target model in Wave 1. Separating runner from target prevents the execution agent from also generating one of the measured recommendation outcomes. A Grok consumer-interface test can be added later as a separately collected wave using the same frozen prompt set.

The frozen Wave 1 artifacts are:

- `data/commerce-recommendation-prompts-v0.1.json`
- `docs/grok-commerce-runner-v0.1.md`
- `data/commerce-recommendation-run-schema-v0.1.json`

Wave 1 consists of 13 prompts × 4 target platforms × 3 replicates = **156 expected valid responses**. Every run uses a fresh conversation, a single exact prompt, no follow-up, the ordinary default consumer model presented by the account, and the platform's default search/browsing behavior. Raw answers are preserved verbatim before coding.

The runner must not bypass CAPTCHAs, anti-bot controls, rate limits, or access restrictions. Authentication or security interruptions are recorded as missing/blocked observations rather than worked around.

## Analysis plan

Do not publish a composite "AI Commerce Readiness" score in v0.1.

First publish the raw vector and test relationships among the layers.

Initial analysis:

1. report coverage and missingness for every variable;
2. compare recommendation share with declared access, product legibility, and verified integrations;
3. control for retailer scale using 2025 U.S. retail sales or NRF rank;
4. stratify where necessary by retailer category / eligibility;
5. report Spearman rank relationships for exploratory monotonic association;
6. use simple model-based analysis only if sample size and outcome variation support it;
7. preserve null and contradictory findings.

No observed association should be described as causal without an identification strategy.

## Amazon / Walmart working hypothesis

The project should test, not assume, a strategic distinction:

- one architecture may prefer to keep discovery and customer intelligence inside an owned commerce system while restricting some external agents;
- another may accept third-party AI as the discovery layer while competing to become the transaction and fulfillment endpoint.

This creates a measurable separation between **discovery control** and **transaction capture**.

An external-AI recommendation deficit would not, by itself, imply weak AI capability or weak commerce economics. Conversely, strong recommendation visibility would not prove transaction capture.

## Source discipline

External sources motivate the experiment but do not determine exmxc results.

Primary reference classes for v0.1:

- NRF 2026 Top 100 Retailers: population and 2025 U.S. retail-sales controls.
- Google crawler documentation: meaning of Storebot-Google and other declared crawl controls.
- OpenAI commerce documentation: direct merchant feeds, catalog metadata, merchant selection, and agentic commerce mechanics.
- Retailer and platform first-party disclosures: documented integrations and owned AI capabilities.
- NIQ / other consumer research: market-adoption context.
- Independent recommendation studies: external comparison only.

## Release discipline

A release is publishable only when:

- population is frozen;
- surface registry is frozen;
- every measurement includes provenance and collection date;
- missing and unassessable values remain explicit;
- recommendation runs are independently executed and preserved;
- no recommendation result is backfilled from structural proxies;
- Entity Clarity v2.1 remains untouched;
- raw evidence can be inspected; and
- methodology version and snapshot date are immutable.

Until then, AI Commerce Exposure is an experimental research program, not a production score.

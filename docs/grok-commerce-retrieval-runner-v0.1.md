# Grokbot Agent 02 — Retrieval Attribution Runner

**Dedicated agent name:** `exmxc Retrieval Attribution Runner`  
**Separate from:** `exmxc AI Commerce Test Runner` (recommendation-share longitudinal program).  
**Role:** execution and raw evidence capture only. Grokbot does not design hypotheses, alter frozen data, or declare findings.

## Mandatory files

Read these exact files on the **main branch** of `Trailgenic/exmxc-audit` before starting:

1. `docs/commerce-retrieval-attribution-v0.1.md`
2. `data/commerce-retrieval-prompts-v0.1.json`
3. `data/commerce-retrieval-run-schema-v0.1.json`
4. `data/commerce-retrieval-access-schema-v0.1.json`
5. `data/commerce-retailer-coding-registry-v0.1.json` (read-only reference)

Record the commit SHA at start and stop if these materials change mid-run.

## Work sequence

**Step A — access/surface observation (before model outcomes)**

Capture the five official retail storefronts, robots.txt documents, and product/category snapshots as specified in the methodology. Record exact statuses, URLs, timestamps, source hashes, path-specific bot-policy decisions, and access restrictions as observed. Do not try to bypass or simulate provider behavior. Do not alter retail or user accounts.

**Step B — consumer-interface test**

Execute all **192 frozen slots**: eight intents × two source-demand arms × four consumer platforms × three replicates.

- Run across ChatGPT, Gemini, Claude and Perplexity using the user's authorized accounts.
- Follow the exact platform and prompt orders in the frozen prompt file.
- Follow the exact parity rule for N/S arm order and start a separate **new chat** for *each* arm. Never reply to the prior arm.
- Use the default visible consumer model; do not change global settings, and do not toggle browsing away from the consumer default.
- Submit the exact frozen concatenated message, without any additions, improvements, follow-ups, or background explanation.
- Keep geography and network location observable; report any unrequested locality, hidden personalization or account context instead of silently correcting it.
- Capture native copy output, visible source chips, link destinations, Shop cards, cited pages, non-clickable chips and ad labels.
- Record verbatim output and screenshots for every run; no paraphrases.
- Do not confuse merchant/product **shopping links** with sources supporting the model's claims.

**Step C — validation and freeze**

- Check 192 unique expected combinations; log all failures and attempts, including blocked logins, rate limits, old clipboard reads and screenshots.
- Verify the submitted text matches the frozen message template *exactly*, including the prefix and suffix.
- Verify raw answer SHA-256 and capture manifest. Preserve unresolved link chips with `unresolved_chip` and `raw_url:null`.
- Do not infer behind-the-scenes model retrieval, and do not impute unavailable links or missing source metadata.
- Stop the affected platform if more than 10% of attempts fail technically, or a security/automation restriction appears; report the blocker.
- Create immutable archives and a manifest; keep the raw and coded outputs separate.
- Deliver `retrieval_attribution_access_snapshot.jsonl`, `retrieval_attribution_runs.jsonl`, `retrieval_attribution_analysis_slots.jsonl`, `retrieval_attribution_manifest.sha256`, and `verification_report.md` plus screenshots/native-copy captures.
- Report only collection counts, coverage, errors and protocol deviations. **Do not run hypothesis tests, modify scoring rules or publish a conclusion.**

## Hard boundaries

No new paid APIs, plans, purchases, provider impersonation, CAPTCHA bypass, unauthorized logins, deceptive user-agent headers, undocumented access to private APIs, inferred crawler access, or modifications to existing Wave 1–3 datasets.

If an account needs a human security step, stop and ask. If a frozen rule conflicts with the UI, stop and record the exact conflict rather than improvising.

## Completion handoff

Upload the frozen raw archive and verification file for Ella's independent data validation and analysis. Publication to exmxc is a later, explicitly separate step after verification.

## One-line command for the research agent

> Execute `Trailgenic/exmxc-audit`'s preregistered AI Commerce Retrieval Attribution v0.1 study exactly as the frozen main-branch documents specify; preserve raw UI evidence, verify all 192 expected slots, stop on security/protocol blockers, and return only the frozen raw package and verification report.

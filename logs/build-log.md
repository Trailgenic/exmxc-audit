# exmxc-audit — Build Log

This document records major architectural and methodological milestones in the
development of **exmxc-audit**, the Entity Engineering Index (EEI) diagnostic
module developed by exmxc.ai.

Entries are intentionally concise.
Internal implementation details are omitted by design.

---

## 2025-12-19 — EEI v5.2 (AI Realism Mode)

**Change**
- Introduced EEI v5.2 scoring under *AI Realism Mode*
- Migrated primary crawl logic to rendered (Playwright-based) visibility
- Normalized scoring to reflect AI accessibility and reconstruction cost

**Rationale**
- Static HTML and single-surface crawls overstated AI comprehension
- Modern AI systems operate on rendered DOMs and respect access constraints
- Scores must reflect what AI systems can *actually see*

**Impact**
- Major brands behind WAFs or bot challenges score lower
- Schema-light but lattice-strong entities score more accurately
- EEI now measures legibility, not reputation

---

## 2025-12-18 — Internal UX Diagnostic Layer

**Change**
- Built internal single-URL diagnostic UI
- Exposed Tier 1 / Tier 2 / Tier 3 scoring
- Enabled 13-signal breakdown for internal analysis only

**Rationale**
- Needed transparent debugging for EEI weighting and crawl behavior
- Prevented misinterpretation of composite scores
- Established internal validation loop before public exposure

**Impact**
- Faster iteration on signal weighting
- Clear attribution of score movement
- Enabled cross-entity comparison under identical conditions

---

## 2025-12-17 — Tiered Scoring Model Formalized

**Change**
- Formalized Tier 1 (Comprehension), Tier 2 (Structure), Tier 3 (Hygiene)
- Mapped 13 signals into tiered aggregation

**Rationale**
- Composite scores alone obscure failure modes
- Tier separation reflects how AI systems prioritize signals

**Impact**
- Tier-only public reporting made possible
- Internal diagnostics aligned with AI inference order

---


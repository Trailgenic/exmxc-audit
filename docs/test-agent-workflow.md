# exmxc Test-Agent Workflow

**Status:** operating workflow  
**Effective:** 2026-10-07

## Purpose

Use human + ChatGPT research design and Grokbot browser agents as separate layers so exmxc can run repeatable, auditable experiments across external AI systems.

## Roles

### Mike + Ella — research design and interpretation

Own:

- research question;
- hypothesis;
- population and eligibility;
- prompt design;
- preregistration;
- coding rules;
- metrics;
- versioning;
- integrity review;
- analysis;
- interpretation;
- publication; and
- decisions about protocol changes.

Do not change frozen methodology after viewing outcomes unless a new version/wave is explicitly created.

### Grokbot — test execution agent

Owns:

- opening authorized consumer accounts and interfaces;
- executing the frozen run plan exactly;
- isolating sessions;
- preserving verbatim responses;
- capturing timestamps, visible model state, links, screenshots, and errors;
- stopping on security/access/protocol conflicts rather than improvising; and
- freezing and hashing the raw evidence package.

Grokbot does not choose the hypothesis, alter prompts, interpret results, or calculate the publication conclusion during collection.

## Standard sequence

1. **Question** — identify a falsifiable research question.
2. **Design** — define population, prompts, controls, metrics, and failure rules.
3. **Preregister** — commit the frozen protocol before outcome collection.
4. **Execute** — Grokbot runs the test against authorized external interfaces.
5. **Freeze** — preserve raw captures, attempts, deviations, and hashes.
6. **Validate** — verify completeness and protocol adherence.
7. **Code** — mechanically transform raw responses under frozen rules.
8. **Analyze** — calculate metrics and sensitivity checks.
9. **Publish** — release the finding with methodology and interpretation boundaries.
10. **Repeat** — append new waves without rewriting history.

## Longitudinal experiments

For recurring tests:

- keep the baseline prompt set frozen;
- use a fixed cadence;
- append each wave;
- record visible model/version changes;
- preserve platform-specific deviations;
- never backfill old waves using new coding rules without versioning;
- publish both level and change metrics; and
- treat platform/model changes as part of the observed environment, not noise to hide.

## AI Commerce Exposure implementation

AI Commerce Exposure is the first production use of this workflow.

- Wave 1 baseline: 2026-10-07
- Cadence: every two weeks
- Execution agent: dedicated Grokbot AI Commerce Test Runner
- Target systems: ChatGPT, Perplexity, Gemini, Claude
- Baseline valid analysis runs: 156
- Longitudinal dataset: `data/ai-commerce-longitudinal.json`

## Principle

**Design and execution should be separable.**

The research layer decides what would constitute evidence before the test agent sees the outcomes. The execution layer gathers that evidence without rewriting the question. This separation is what turns browser automation into research infrastructure rather than anecdotal prompting.

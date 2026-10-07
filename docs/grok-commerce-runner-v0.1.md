# Grok Runner Protocol — AI Commerce Recommendation Wave 1

**Protocol:** commerce-recommendation-runner/0.1  
**Snapshot date:** 2026-10-07  
**Status:** frozen for Wave 1 after merge of the research PR  
**Runner:** Grok bot  
**Models under test:** ChatGPT, Perplexity, Gemini, Claude

## Role separation

Grok bot is the browser/execution harness for Wave 1. It is **not** a model under test in this wave.

This prevents the execution agent from also scoring its own native recommendation behavior. Grok can be added later as a separately collected Wave 2 model using a consumer-facing Grok session and the same frozen prompts.

The runner must not summarize, rewrite, clean up, or infer missing content from a tested model. Preserve the tested model's response verbatim.

## Account use

Use the researcher's existing authorized accounts and ordinary consumer interfaces.

Do not:

- create new accounts;
- change subscription tiers;
- alter global personalization or memory settings;
- bypass CAPTCHAs, anti-bot controls, rate limits, or access restrictions;
- use hidden APIs or developer endpoints as substitutes for the consumer interface; or
- continue if a platform explicitly blocks automation.

If a login expires, authentication requires a human approval, or a security control appears, stop that platform and mark the run `human_action_required`.

## Session isolation

Each prompt-model-replicate combination gets a new conversation with no preceding messages.

At the beginning of every run, submit one single message composed exactly as:

> Assume I am in the continental United States. Ignore my current location and any saved preferences or prior conversations. [PROMPT TEXT] Recommend up to five retailers, ranked, with one short reason for each. Do not ask me a follow-up question.

Do not add or remove words.

Use a temporary/private chat mode when the platform exposes one directly in the normal UI without changing account-wide settings. Otherwise use a fresh ordinary conversation. Record the session mode actually used.

Do not send a follow-up if the model asks a question. Record `clarification_required`.

## Model and search behavior

Use the ordinary default consumer model presented to the account at run time. Do not manually switch to a faster, deeper, legacy, or premium model unless the platform requires an explicit model selection before chat can begin.

Record the visible model label exactly as shown.

Leave web/search/browsing behavior at the platform's default for that model and prompt. Do not manually turn browsing on or off. Record whether the answer visibly searched/browsed when the UI exposes that state.

This design measures the recommendation surface a normal logged-in consumer is likely to encounter, not an API benchmark.

## Run count and ordering

The frozen prompt file is:

`data/commerce-recommendation-prompts-v0.1.json`

Run all 13 prompts on all 4 target platforms for 3 replicates: **156 expected valid responses**.

Follow the platform and prompt order specified in that file. A fresh chat prevents carryover; the rotated ordering spreads time-of-day and platform drift.

## Capture requirements

For every run, save:

- run ID;
- UTC timestamp;
- platform;
- visible model label;
- replicate number;
- prompt ID;
- exact submitted message;
- session mode;
- account state: logged in;
- visible personalization/memory state if shown without opening settings;
- visible browse/search state;
- exact raw answer;
- retailer names in order of first appearance;
- merchant/product links;
- citations/sources exposed by the UI;
- separately labeled sponsored or promoted items, if any;
- whether a sponsored item was excluded from the organic recommendation coding;
- clarification request;
- refusal;
- error / rate limit / CAPTCHA / human-action requirement; and
- screenshot or page capture reference when available.

A sponsored item is **not** an organic recommendation unless the model itself also names that retailer in its answer.

## Coding rules

Coding is mechanical and occurs after raw capture.

### Organic retailer mention

Count a retailer when it appears in the model-generated answer as a place to buy the requested goods or services.

Do not count:

- a retailer named only in a citation title;
- a retailer visible only in a sponsored card;
- a retailer mentioned only as a negative example;
- a marketplace seller that is not itself the merchant recommendation; or
- a retailer introduced by the runner.

### Rank

Use explicit numbering/ranking if present. Otherwise use order of first positive recommendation.

### Merchant link

Record a merchant link only when the response or shopping UI directly links to that retailer or one of its product pages. Citation links to news or reviews are not merchant links.

### Parent/banner preservation

Preserve the exact consumer banner named by the model. Parent-company rollups happen later and must never replace the raw banner-level observation.

## Invalid-run rules

Mark a run invalid rather than retrying silently when:

- the wrong prompt was submitted;
- the conversation contained prior messages;
- the runner added follow-up content;
- a response was truncated before retailer recommendations were visible;
- the visible model changed mid-run;
- the platform returned a technical error before an answer; or
- authentication/security controls prevented normal completion.

One retry is allowed for a pure transient technical failure. Record both the failed attempt and retry. Do not retry a valid but surprising answer.

## Stop conditions

Stop the affected platform and report rather than improvising if:

- the UI materially changes;
- the account loses access to the intended default consumer model;
- automation is blocked;
- more than 10% of attempted runs on that platform fail technically; or
- the platform begins injecting prior-chat context despite fresh sessions.

## Output format

Write one JSON object per run using the schema in:

`data/commerce-recommendation-run-schema-v0.1.json`

Do not calculate recommendation shares inside the runner. Analysis occurs only after the raw run log is complete and frozen.

## Integrity rule

The prompt file, run protocol, and coding rules are frozen **before** viewing Wave 1 outcomes.

If a protocol defect is discovered after outcomes begin, stop collection, version the protocol, and begin a new wave. Never edit the frozen prompt set in place.

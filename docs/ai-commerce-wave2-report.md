# AI Commerce Exposure — Wave 2 (November 3–4, 2026)

**Status:** repeat-wave descriptive result; mechanical ranked-list coding from the uploaded `wave2_runs.xlsx`.  
**Protocol:** `commerce-recommendation-runner/0.1` frozen at commit `63ef358`.  
**Sampling:** 13 prompts × four consumer AI systems × three replicates = 156 final slots.  
**Observed:** 155 valid ranked answers; one Gemini refusal (W2-R3-P12-Gemini).  
**Original attempt:** October 21 partial abandoned; all November 3–4 final runs were restarted from scratch.

## Main result: Amazon's recommendation deficit persists

Eight frozen prompts (P01, P02, P04, P05, P07, P08, P09, P10) made Amazon, Walmart, Costco and Target simultaneously category-eligible. Each has **96** comparable runs per wave.

| Retailer | Wave 1 | Wave 2 | Change |
| --- | ---: | ---: | ---: |
| Walmart banner | 67/96 = **69.8%** | 69/96 = **71.9%** | +2.1 percentage points |
| Costco | 59/96 = **61.5%** | 59/96 = **61.5%** | 0.0 pp |
| Target | 49/96 = **51.0%** | 44/96 = **45.8%** | −5.2 pp |
| Amazon | 36/96 = **37.5%** | 31/96 = **32.3%** | −5.2 pp |

The **Walmart-parent** rollup (which includes Sam's Club only under the frozen alias map) is 70/96 = 72.9% in Wave 2, versus 69/96 = 71.9% in Wave 1. Keep this distinct from Walmart-banner values.

These are within-study descriptive observations, not estimates of a national consumer preference distribution. There are only two time points, several model/interface changes, and repeated prompts across correlated systems. No significance or causal inference is claimed.

## Amazon: not a binary disappearance

In the common-eight-prompt comparison Amazon was recommended **31/96** times and was never ranked first. Among those 31 appearances it was ranked:

- #2 twice (both Gemini responses to the college-laptop prompt P05);
- #3 fourteen times;
- #4 nine times; and
- #5 six times.

Mean position when recommended improved from Wave 1's 4.33 to Wave 2's **3.61** on the common prompt set, even as recommendation frequency declined. That difference matters: a single "AI visibility" number cannot describe every aspect of the recommendation surface.

Across Amazon's whole preregistered eligible set, it appeared in **32/119 valid runs = 26.9%**; the denominator is 119 rather than 120 because the sole Gemini refusal was on an Amazon-eligible prompt (P12). The Wave 1 equivalent was 36/120 = 30.0%.

Amazon across Wave 2 valid eligible prompts:

| Platform | Recommended | Eligible | Share |
| --- | ---: | ---: | ---: |
| Claude | 15 | 30 | 50.0% |
| Gemini | 8 | 29 | 27.6% |
| ChatGPT | 5 | 30 | 16.7% |
| Perplexity | 4 | 30 | 13.3% |

Compared with Wave 1, Perplexity rose from 1/30 to 4/30, but remains the lowest of these platform-specific rates in Wave 2. This remains a small, highly prompt-conditional sample.

## Stronger persistent category signals

The #1 retailer in Wave 2 was Walmart for the general-merchandise prompt P01 in **12/12** runs and the household/personal-care prompt P07 in **12/12** runs. Home Depot remained #1 for home-improvement P06 in **12/12** runs. Costco led the warehouse-club prompt P03 in **12/12** runs. Best Buy led the phone-and-wireless-plan P11 prompt in **12/12** runs.

Those repeated category preferences help explain why narrow retailer specialties can outperform a broad marketplace in AI-generated consideration sets.

## How the published numerator was coded

Grokbot's supplied `wave2_summary.pdf` provides **raw alias mentions**. Those counts include mentions in free text and can include brand names, negative comparisons, and source-link text. They are **not** preregistered Recommendation Share values.

For this release, the exmxc analysis extracted the first numbered recommended-retailer list from each of the 155 valid responses; it coded the retailer named in the heading of each ranked entry, preserved the ranking position, and matched frozen retailer aliases. Source/citation-only mentions and explanatory references were not counted as recommendation hits. All 155 valid answers contained an extractable first ranked list (2 to 5 entries). Individual coded row data is retained as a separate artifact with a SHA-256 listed in the summary.

**Qualification:** This is a reproducible automated ranked-heading extraction, not an independent full human recode of all 155 responses. For a formal paper, a second blind coder should adjudicate ambiguous multi-banner and retailer-vs-brand cases.

## Comparability and protocol deviations

This is a real second observational snapshot, but **not a clean 14-day controlled interval**. Wave 1 was October 7. Wave 2 was intended for October 21, partially attempted, then restarted and completed November 3–4.

- Gemini used **Gemini Auto**, while the Wave 1 session used Flash. The underlying model may vary.
- ChatGPT's visible composer indicated **Think**; Perplexity did not show a specific model identifier. Claude showed Opus 5.5 Medium.
- The runner switched to its own network after the researcher's computer disconnected. Some later responses contained Colorado-localized source material despite the national U.S. prompt.
- Six executions were out of planned order because authentication interruptions required holds.
- One Gemini refusal was recorded, not overwritten.
- Direct citation hrefs were unavailable for some platform captures; this does not affect the ranked-name coding.

Therefore changes across Wave 1 and Wave 2 may reflect interface/model/geographic changes in addition to actual recommendation behavior. The persistent Amazon-vs-Walmart/Costco gap is more robust than small percentage-point movements in either direction.

## Next wave: separate recurrence from within-period replication

The user reports Grokbot has already begun a third wave while Wave 2 just closed. The data should be retained, but if Wave 3 is collected immediately after November 4 it is best labeled an **within-period replication** (robustness sample) rather than a new biweekly longitudinal interval. Keep its true collection timestamps; do not backdate or reassign the results.

The original biweekly calendar can resume with a subsequent properly spaced observation while continuing to store all collected waves. This distinction is important for future longitudinal analysis.

## Provenance

- Wave 2 uploaded workbook SHA-256: `ff029e35ea488970d7ce6597b9c4de2c9905160b16ffc3ed3b1ab5f4b67e2cac`
- Wave 2 uploaded summary PDF SHA-256: `539924ccd437ee46bfa414950e3537ec27e16deb672c4ffdd57597bc7585c15c`
- Wave 2 code-derived row record SHA-256: `2c60c296ffa49aa23836a20552629c7960aaf7a6e50a2297dff334e5504a8fd3`

The raw screenshot and copy-file archive described by Grokbot was not included in the two attachments under review, so its independent manifest/hash verification is not claimed here.

## Research boundary

These findings concern the tested consumer AI interfaces, prompts and conditions. They do not measure actual retailer conversions or transactions and do not establish that any retailer's robots policy caused a lower recommendation share.

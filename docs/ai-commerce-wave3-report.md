# AI Commerce Exposure — Wave 3 (November 4, 2026)

**Collection status:** 156/156 valid final analysis runs; 159 total attempts, including three retained blocked or technical attempts.  
**Protocol:** Frozen Wave 1 runner and eligibility rules, commit `63ef358`.  
**Timing:** Within-period replication of Wave 2, **not** a biweekly observation.

## Finding

On the same eight prompts where Walmart, Costco, Target and Amazon were all eligible (96 comparable prompt × system × replicate observations per retailer), **Amazon remained substantially underrecommended**. It appeared in 27 of 96 top-five ranked lists (28.1%), compared with 68/96 (70.8%) for Walmart banner, 61/96 (63.5%) for Costco and 48/96 (50.0%) for Target.

| Retailer | Wave 1 | Wave 2 | Wave 3 |
| --- | ---: | ---: | ---: |
| Walmart banner | 67/96 = 69.8% | 69/96 = 71.9% | **68/96 = 70.8%** |
| Costco | 59/96 = 61.5% | 59/96 = 61.5% | **61/96 = 63.5%** |
| Target | 49/96 = 51.0% | 44/96 = 45.8% | **48/96 = 50.0%** |
| Amazon | 36/96 = 37.5% | 31/96 = 32.3% | **27/96 = 28.1%** |

The counts are descriptive outcomes conditional on our prompts, consumer-interface sessions and browser conditions. They are not population-level customer choices.

## Amazon's rank position

Amazon ranked first **zero times** in Wave 3. Among its 27 common-prompt recommendations it ranked #2 twice, #3 twelve times, #4 eight times and #5 five times. Both #2 placements occurred in Gemini's college-laptop prompt (P05). Mean rank conditional on being recommended was **3.59**, similar to 3.61 in Wave 2 and better than Wave 1's 4.33. Thus frequency fell while conditional rank remained broadly comparable to Wave 2.

Across all frozen Amazon-eligible prompt categories the Wave 3 rate was **27/120 = 22.5%**; Wave 2 had **32/119 = 26.9%** (one Gemini refusal) and Wave 1 had 36/120 = 30.0%.

## Amazon by platform

| System | Wave 3 positive ranked appearances | Category-eligible runs | Recommendation Share |
| --- | ---: | ---: | ---: |
| Claude | 13 | 30 | 43.3% |
| Gemini | 7 | 30 | 23.3% |
| ChatGPT | 5 | 30 | 16.7% |
| Perplexity | 2 | 30 | 6.7% |

These descriptive rates cannot establish which retrieval mechanism or model policy drove individual recommendations.

## Repeated category leaders

Several #1 choices were particularly consistent across Wave 3's 12 runs per prompt: Walmart (P01 general merchandise, 12/12; P07 household/personal care, 12/12), Costco (P03 warehouse club, 12/12; P04 OLED TV, 12/12), Home Depot (P06 DIY home improvement, 12/12), Best Buy (P05 laptop, 10/12; P11 phone plus wireless plan, 11/12), and AutoZone (P12 auto parts, 11/12).

## Verification and reproducibility

The uploaded `wave3_runs.xlsx` contains 159 attempt rows, 156 marked as final/valid; 39 valid runs per platform. **Every one of the 156 raw-answer SHA-256 checks matched** the workbook's verbatim answer content. Submitted prompts matched Wave 2's frozen prompt strings in every corresponding final run. All 156 final responses yielded first ranked lists with two to five retailer entries.

We separately coded the **ranked retailer headings**. Grokbot's PDF keyword-mention totals are intentionally **not used as Recommendation Share numerators**: they count free-text mentions and sometimes brand names in explanations or citations. We use the same `ranked_headings_first_list_v0.1` style as Wave 2, preserving raw ranked labels and applying the frozen category eligibility and parent/banner distinction. Walmart parent includes Sam's Club, but Walmart banner does not.

Source SHA-256 values:
- `wave3_runs.xlsx`: `474f97f7569d4e2736e5bff9964a168d7d0ed2a2337ddd436a2f0db6003a9bc1`
- `wave3_summary.pdf`: `1da68c9bb0f44a8da199300c9e03a9049bfa5ffae0fa24a28aacfd40e7ba0ee5`
- Derived coded-runs JSON: `bb2c816116c004ddb675a8a491e391345ed79b3461fe8539cb733da7f572be09` (locally produced alongside this analysis)

The separate Grokbot raw ZIP archive and `MANIFEST.sha256` mentioned in the PDF were not among these attachments; their integrity is not independently verified here.

## Deviations and caution

The frozen prompt text was preserved, but the operating environment was not perfectly fixed. All Gemini runs used **Auto**, and the model underlying Auto can change. The whole Wave 3 ran over the runner's own network, producing some Colorado/Utah-localized sources. Gemini usage limits required holds and make-up runs; two technical failures received approved fresh-session retries, with originals retained. Four final runs were out of order. Some ChatGPT answers contained unlabeled Shop product cards; one Perplexity source had an ad-related query parameter without a displayed Sponsored label. These were **not** substituted for ranked recommendations. Some Claude clipboard text included otherwise invisible preambles, and Gemini's searched/browsed flags were inconsistent with visible source chips.

Most importantly, Wave 2 ran November 3–4 and Wave 3 ran November 4. The latter tests **short-horizon reproducibility**, not a new two-week time trend. Observed changes can reflect stochastic response variation, model routing, source selection or environment. Any claim that Amazon's external crawler restrictions caused the ranking difference remains a hypothesis, not a finding.

## Research program

Preserve each dated wave and its collection conditions in the longitudinal index; distinguish within-period replications from spaced longitudinal waves. Future causal-mechanism work should independently measure external machine access, first-party catalog readability, third-party citations, owned AI shopping capabilities, and prompts matched by product/consumer preference.

**Resources:** [Wave 1](https://www.exmxc.ai/signal-briefs/ai-commerce-exposure-wave-1-amazon-recommendation-deficit) · [Wave 2](https://www.exmxc.ai/signal-briefs/ai-commerce-exposure-wave-2-amazon-gap-persists) · [Wave 3 data](https://github.com/Trailgenic/exmxc-audit/blob/main/data/ai-commerce-wave3-summary.json) · [Longitudinal index](https://github.com/Trailgenic/exmxc-audit/blob/main/data/ai-commerce-longitudinal.json).

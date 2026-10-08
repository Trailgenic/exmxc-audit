# AI Commerce Exposure — Wave 1

**Snapshot:** October 7, 2026  
**Status:** first longitudinal baseline  
**Experiment:** 13 frozen shopping prompts × 4 consumer AI systems × 3 replicates  
**Valid analysis runs:** 156 / 156

## Finding

Amazon, the second-largest U.S. retailer in the frozen NRF benchmark population, showed a pronounced recommendation deficit across the first exmxc AI Commerce Exposure wave.

Across Amazon's 120 preregistered category-eligible runs, Amazon appeared in 36 top-five recommendation lists (**30.0% Recommendation Share**). It was ranked first **0 times** and second **0 times**. When Amazon was recommended, its mean position was **4.33**: 6 appearances at #3, 12 at #4, and 18 at #5.

The result varied substantially by AI system:

| Platform | Amazon Recommendation Share |
| --- | ---: |
| Claude | 53.3% (16/30) |
| Gemini | 40.0% (12/30) |
| ChatGPT | 23.3% (7/30) |
| Perplexity | 3.3% (1/30) |

The Perplexity observation is especially notable: Amazon appeared once in 30 eligible runs, at #5.

## Apples-to-apples comparison

Eight frozen prompts made Walmart, Amazon, Costco, and Target simultaneously eligible: P01, P02, P04, P05, P07, P08, P09, and P10. That produces 96 identical prompt × platform × replicate observations for each retailer.

| Retailer | Recommendation Share | #1 Share | Mean rank when recommended |
| --- | ---: | ---: | ---: |
| Walmart banner | **69.8%** | **28.1%** | 2.55 |
| Costco | **61.5%** | **19.8%** | 2.10 |
| Target | **51.0%** | **14.6%** | 2.59 |
| Amazon | **37.5%** | **0.0%** | **4.33** |

The frozen parent-company rollup counts Sam's Club under Walmart. On that basis, Walmart parent Recommendation Share is **71.9%** in the common eight-prompt comparison. exmxc preserves both banner-level and parent-level views so longitudinal definitions remain stable.

## Category convergence

The four systems often converged strongly on category leaders. Across the 12 observations per prompt:

- P01 everyday household/general merchandise: Walmart #1 in **12/12**.
- P03 warehouse club: Costco **9/12**, Sam's Club 3/12.
- P04 OLED television: Costco **12/12**.
- P05 college laptop: Best Buy **8/12**, Costco 4/12.
- P06 home improvement: Home Depot **12/12**.
- P07 household/personal care: Walmart **12/12**.
- P08 family apparel: Target **9/12**, Old Navy 3/12.
- P11 phone + wireless plan: Best Buy **10/12**, T-Mobile 2/12.
- P12 auto parts: AutoZone **7/12**, O'Reilly 5/12.

Amazon did not win a prompt category in Wave 1.

## What the result does — and does not — establish

Wave 1 establishes an observed recommendation gap. It does **not** establish its cause.

Amazon has publicly taken a relatively restrictive posture toward outside AI shopping agents. Reporting has documented restrictions involving systems from OpenAI, Google, Perplexity, and others, while Walmart and other retailers have pursued external AI-commerce integrations. That makes machine accessibility a credible mechanism to test.

But the raw answers also repeatedly frame Amazon's strengths and weaknesses in conventional consumer terms. Amazon is often praised for selection, delivery speed, raw price, and Subscribe & Save, while some answers qualify it on third-party seller risk, warranty/support, returns, variable product quality, or lack of physical service. Recommendation outcomes may therefore reflect several mechanisms at once.

The next analytical layers are intentionally separate:

1. external AI access;
2. Entity Clarity v2.1;
3. product legibility;
4. agentic-commerce integrations;
5. recommendation presence;
6. transaction accessibility; and
7. owned AI-commerce capability.

The project will test whether changes in these layers predict changes in recommendation share over time.

## Sensitivity check

Wave 1 contains a documented Gemini protocol deviation: after Gemini fell back to Flash-Lite because of a usage limit, the researcher approved one manual switch back to the previously used Flash model for the remaining R3 Gemini observations.

Excluding Gemini entirely leaves 72 common-prompt observations per retailer. Amazon Recommendation Share remains **33.3%**, versus Walmart banner **77.8%**, Costco **61.1%**, and Target **51.4%**. The core Amazon finding therefore does not depend on the Gemini deviation.

## Research integrity

The experiment was preregistered before collection. The prompt set, retailer eligibility, aliases, runner protocol, and run schema were frozen at commit `63ef358555c02db6f46d6f7325a6e0e29e63cca5`.

Grok bot acted only as the execution harness. It used authorized consumer accounts for ChatGPT, Perplexity, Gemini, and Claude. Each analysis run used a fresh conversation, one exact frozen prompt, and no follow-up.

The frozen raw run log contains 167 attempts and 156 final analysis runs. All 156 analysis runs have nonempty copy-button captures. Raw log SHA-256:

`c54c7687b19188e5aa389953a397944f817521ed6f1f0f9055eb74e5067a4a92`

The two archived raw packages are independently hashed in the published summary dataset.

## Longitudinal design

Wave 1 is the baseline, not the endpoint.

exmxc will repeat the same frozen recommendation experiment every two weeks. Each wave will preserve the existing prompt set and coding rules unless a versioned protocol change is required. New waves will be appended rather than overwriting prior observations.

The longitudinal series is designed to measure:

- retailer Recommendation Share over time;
- first-position share;
- rank distribution;
- platform-level divergence;
- category-level changes;
- effects around documented access-policy or commerce-integration changes; and
- whether discovery visibility begins to separate from transaction capture.

This creates a new observable: **AI Commerce Exposure** — the degree to which an economic entity is surfaced into the consideration set created by consumer AI systems.

## External context

NIQ reported on September 24, 2026 that 51% of U.S. consumers had used at least one AI-powered shopping tool in the prior month, the first time its tracker crossed 50%. NIQ also emphasized product content quality, digital discoverability, and structured product information as increasingly important to sales performance.

Separately, UBS testing reported by Barron's and MarketWatch found Walmart and Costco among the retailers most frequently recommended by AI shopping systems and noted Amazon's weaker-than-expected presence. Wave 1 independently reproduces the broad Amazon/Walmart direction using exmxc's preregistered methodology.

## Interpretation boundary

AI recommendation systems are dynamic and personalized. This dataset measures the tested consumer interfaces, accounts, prompts, model states, and collection windows. It should not be interpreted as a universal ranking of retailers, a measure of retailer quality, or proof that any one access policy caused a recommendation outcome.

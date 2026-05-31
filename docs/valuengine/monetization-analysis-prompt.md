# MASTER PROMPT — Viability & Monetization Analysis

> Source orchestration prompt for the ValuEngine viability & monetization study.
> Executed 2026-05-31 as a multi-agent workflow (Phase 1 parallel research →
> Phase 2 modeling → Phase 3 adversarial red-team → Phase 4 synthesis).
> The decision-grade deliverable produced from this prompt is
> [`valuengine-viability-analysis.md`](./valuengine-viability-analysis.md).

**Product (working name):** *ValuEngine* — a productized business-valuation calculator spun out of the Tampa Business Broker site.

**Mission:** Determine, with evidence, whether this valuation engine can become a standalone, paid product for **business brokers/M&A advisors** and **business owners looking to sell** — at **national (US) scale** — and if so, produce the business plan to get it off the ground. Scope is **national SaaS**. All four monetization models must be analyzed and scored. Bias toward evidence over assertion: every market number carries a cited source and date, every assumption is flagged, and every strategic claim survives an adversarial red-team pass.

## 1. The Asset (ground truth)

A credible, defensible valuation engine already exists in the source codebase:

**Engine (`src/lib/valuation-engine.ts`):**
- Blends four independent methods: (1) SDE multiple (quartile-positioned, size-adjusted), (2) revenue multiple (with DLOM), (3) DCF via 10,000-iteration Monte Carlo (Box-Muller, build-up discount rate = risk-free + ERP + size/industry/company risk), (4) asset-based.
- Dynamic method weighting (unprofitable → asset-heavy; high recurring revenue → revenue-heavy; small business → SDE-heavy).
- Outputs a 0–100 confidence score with component breakdown, industry benchmarks, a sensitivity grid, flags/warnings, and a "likely transaction range" (IBBA-derived 0.87 ask-to-close discount).

**Live data enrichment (`src/lib/*-data.ts`)** — 8 sources with live/fallback handling: FRED, Financial Modeling Prep + SEC EDGAR, Damodaran/NYU Stern, BEA, Census CBP, IRS SOI, SBA 7(a).

**Product surface built:** multi-step intake form, branded PDF report (`@react-pdf/renderer`), lead capture + email automation (Resend), industry multiples for 8+ verticals, programmatic SEO engine, Next.js 16 / React 19 on Vercel.

**Regional vs national:** national-capable today; only BEA/Census enrichment is Tampa-scoped and trivially parameterizable to any MSA.

**Productization gap (not yet built):** multi-tenancy, white-label theming, auth, billing/subscriptions, per-customer analytics, API productization, usage metering, API cost/ToS assessment at scale.

## 2. The Strategic Question

Can this engine become a profitable, defensible national product — sold across B2B SaaS (brokers), B2C freemium (sellers), a lead marketplace, and/or API/data licensing — and what is the single best path to launch? Deliver a go / pivot / no-go verdict with confidence, recommended primary monetization model, pricing, a 90-day launch plan, and a 3-year financial sketch.

## 3. Analysis Dimensions
A. Market sizing (TAM/SAM/SOM, national). B. Competitive landscape & moat. C. Customer segment JTBD deep-dives. D. Monetization models — score all four. E. Pricing & packaging. F. Unit economics & 3-yr model. G. GTM & distribution. H. Legal, compliance & liability. I. Productization tech roadmap. J. Risk register & adversarial red-team.

## 4. Required Output
1. Executive verdict (go/pivot/no-go + confidence + 3 reasons). 2. Recommended monetization model + scoring table. 3. Pricing & packaging. 4. TAM/SAM/SOM with sourced math. 5. Competitive positioning statement. 6. Per-segment one-liners. 7. 3-year financial sketch (bear/base/bull). 8. 90-day launch plan. 9. Risk register (top 7, post red-team). 10. Appendix — sources with dates; assumptions flagged.

## 5. Quality Bar
No fabricated statistics; every market figure cites a named source + date or is labeled `ASSUMPTION` with reasoning. Adversarial verification runs before synthesis. Confidence-tag every major conclusion (0-100). Distinguish "what we know" from "what we'd validate with N customer interviews." Prefer primary sources (IBBA Market Pulse, BizBuySell Insight Report, BVR, EPI).

## 7. Execution shape
Phase 1 Discover (parallel: market, competitors, segments, legal/data-ToS). Phase 2 Model (monetization scoring, pricing, unit economics, tech roadmap, GTM). Phase 3 Stress (adversarial red-team gate). Phase 4 Synthesize the §4 deliverable.

# ValuEngine — Viability & Monetization Analysis

**Decision-grade report** · National (US) scope · Prepared 2026-05-31
Method: 4-phase multi-agent workflow (parallel discovery research → modeling → adversarial red-team → synthesis). Every market figure carries a named source + date or is labeled `ASSUMPTION`. Major conclusions are confidence-tagged (0–100). Full sources in the Appendix.

> **One-line thesis tested:** *most competitor "valuation tools" are single-method rule-of-thumb estimators; ours is multi-method + live-data + confidence-scored, approaching what a paid broker's market analysis delivers.* The research **substantially confirms the product claim** but shows the **binding constraint is distribution, not engine quality** — and that two of the eight data feeds carry commercial-licensing kill-switches that must be fixed before scaling.

---

## 1. Executive Verdict — **CONDITIONAL GO** (confidence **62/100**)

Build it, but build it as a **distribution-led niche B2B SaaS for brokers and exit-planning advisors**, fed by a **B2C freemium funnel** — *not* as a B2C-paid product and *not* (yet) as a deal-contingent marketplace. This is a credible **$3–5M ARR niche-leader** opportunity on a realistic horizon, not an obvious venture-scale outcome.

**The three reasons that drove the verdict:**

1. **The product moat is real but thin and time-boxed (confidence 62).** No self-service competitor combines four independent methods + live multi-source enrichment + Monte-Carlo DCF + a 0–100 confidence score. That is a demonstrable differentiator over BizEquity, Equidam, Equitest, BizBuySell's widget, and every rule-of-thumb calculator. **But** the data sources (FRED, EDGAR, Damodaran) are public APIs, so a funded incumbent could close the methodology gap in ~12–18 months. The moat is a head start, not a fortress — which is *why* the verdict is "go fast on distribution," not "go slow on features."

2. **The market is real, sourced, and reachable — but niche.** Bottom-up TAM ≈ **$149M/yr**, SAM ≈ **$78M/yr**, 3-year SOM ≈ **$1.6M ARR base / $3–5M upside** (IBISWorld 2025: ~11,200 broker practitioners; EPI 2023: 6,000+ CEPAs; Gallup 2024: 14% of 5.58M employer firms planning a 5-yr sale). This supports a profitable, bootstrappable SaaS with a clear ROI story (one extra broker listing ≈ $12,500 expected value vs. a ~$1,800/yr subscription), but it does not support a "winner-take-all national platform" narrative. Sizing honestly is part of the go-decision.

3. **There is a genuine, unusual distribution advantage to exploit immediately.** The existing **Transworld relationship + live proof-site + already-built programmatic-SEO engine** is exactly the asset that every competitor analysis says is the controlling variable. The history of this category (BizEquity won via bank embedding; Value Builder via advisor certification; BizWorth via BizBuySell traffic) shows **better-engine-alone has never won** — so the warm channel is worth more than the algorithm.

**Why not a clean "Go":** standalone SOM is modest, the moat is replicable, B2C-paid is commoditized by free tools, and two data feeds (FMP, FRED) are out of ToS compliance for commercial resale today. Those are fixable, but they are real conditions — hence *conditional*.

---

## 2. Recommended Monetization Model + Scoring

### Scoring rubric (each dimension 1–10; weighted)

| Model | Market size ×2 | Willingness-to-pay ×2 | Defensibility ×1.5 | Speed-to-cash ×1.5 | Founder fit ×1 | **Weighted /80** | Rank |
|---|---|---|---|---|---|---|---|
| **1. B2B SaaS / white-label (brokers + exit advisors + CPA/RIA)** | 7 | 8 | 6 | 6 | 9 | **55.5** | **1** |
| **2. B2C freemium for sellers** | 9 | 3 | 3 | 9 | 9 | 47.0 | 3 |
| **3. Lead marketplace (seller leads → brokers)** | 6 | 7 | 7 | 4 | 7 | 48.5 | 2 |
| **4. API / data licensing (lenders, CPA platforms, fintechs)** | 5 | 8 | 5 | 3 | 4 | 41.5 | 4 |

*Scores are analyst judgments grounded in the Phase-1 evidence; treat as directional (confidence 60).*

### The recommendation: a **sequenced hybrid**, not a single model

- **Primary (Now → Month 12): Model 1 — B2B SaaS / white-label.** Highest founder fit (warm channel + SEO), strong ROI-backed WTP ($99–$299/mo, vs. one $12,500-EV listing), sticky once embedded in broker/advisor workflow. Direct, beatable comp: BizEquity (~$240/mo, opaque black-box) and Value Builder (readiness score, *not* a dollar valuation). Our multi-method transparency + confidence score is a clean upgrade story.
- **Funnel (Now, in parallel): Model 2 — B2C freemium.** Do **not** sell it as the primary revenue line — free tools set a price floor and $120/yr ARPU can't carry a company. Its job is **lead generation**: the 2.9–4.5M boomer/Gen-X owners approaching exit (Project Equity 2023) are the top-of-funnel that feeds both the broker SaaS (sponsored embeds) and, later, the marketplace.
- **Layer (Month 12+): Model 3 — Lead marketplace.** Once the freemium funnel produces qualified seller intent at volume, route/sell intent-scored leads to the same brokers who are SaaS customers. **Structure as flat per-lead or subscription routing — never deal-contingent success fees** (see §9 securities kill-switch). Watch channel conflict with Model 1 by making leads a *benefit* of the SaaS tier, not a competing product.
- **Option (Month 18+): Model 4 — API / data licensing.** Real ACV ($3,600+/yr per org; SBA lenders, CPA platforms, fintechs) but slow enterprise cycles and weakest founder fit. Pursue only after the engine is productized and the data-licensing remediation (§9) is complete — otherwise you'd be reselling data you're not licensed to redistribute.

This is exactly the hybrid the brief hypothesized: **B2C freemium as the funnel that feeds the marketplace, while B2B SaaS monetizes the brokers receiving those leads.** The evidence supports that sequencing.

---

## 3. Pricing & Packaging

| Tier | Audience | Price | What's included | Free/paid line |
|---|---|---|---|---|
| **Estimate (Free)** | Business owners (B2C funnel) | $0, email-gated | Instant value *range* + confidence score + top-3 value drivers + industry percentile | **Lead magnet.** The number is free; the deliverable is not. |
| **Seller Report** | Owners / buyers | **$99–$149** one-time (free when broker-sponsored) | Full branded PDF, multi-method breakdown, sensitivity grid, SBA-financeability check | Paid: the shareable PDF + depth |
| **Broker Solo** | Solo brokers, small firms | **$149/mo** ($1,490/yr) | White-label embeddable widget on *their* site, unlimited valuations, branded BOV PDF, lead-capture dashboard | Undercuts BizEquity (~$240/mo) with deeper methodology |
| **Advisor Pro** | M&A advisors, CEPAs, CPAs, RIAs | **$299/mo** ($2,990/yr) | Multi-client dashboard, CIM-grade multi-method export, scenario toggles, priority/MSA data, team seats, annual re-run reminders | The "client-deliverable" tier |
| **Enterprise / API** | Franchise networks, banks, CPA/fintech platforms | **Custom** ($3,600+/yr or metered API) | SSO, multi-tenant admin, API, usage metering, SLA, SOC 2 report | Channel + data-licensing tier |

**Anchoring evidence:** broker BOV charged to sellers $0–$5,000 (ExitPromise); formal appraisal $1,500–$8,500 (BizWorth 2026, Skyline CPA); BizEquity Advisor Solo ~$240/mo; ValuSource $1,465/yr; Equidam €291–€391/valuation. Our paid line sits deliberately between "free calculator" (no trust) and "formal appraisal" ($3k+). **Free/paid line = the value range is free; the branded, shareable, multi-method PDF + white-label embed + dashboard are paid.** (Confidence on specific price points: 60 — validate with ≥15 broker/advisor interviews and a pricing A/B.)

---

## 4. TAM / SAM / SOM (sourced math)

| Metric | Value | Derivation |
|---|---|---|
| **TAM** | **≈ $149M/yr** | 11,200 brokers ×$1,800 + 4,000 M&A advisors ×$2,400 + 6,000 CEPAs ×$1,500 + 780,000 active-seller owners ×$120 + 9,000 CPA-valuation firms ×$1,200 + 3,000 RIAs ×$1,200 + 500 SBA lenders ×$3,600 + 1,000 searchers ×$600 |
| **SAM** | **≈ $78M/yr** | US-only, digitally reachable subset; reachability weights applied (brokers 85%, advisors 75%, CEPAs 80%, paid owners 40%, CPA 60%, RIA 50%) |
| **SOM (Year 3)** | **≈ $1.6M ARR base / $3–5M upside** | ~5% of brokers (560) + 3% CEPAs (180) + 2% M&A (80) + ~500 paid owners + ~75 adjacent firms ≈ 1,395 accounts; upside if a Transworld/Sunbelt or BizBuySell channel is signed |

**Key sourced inputs (all accessed 2026-05-31):**
- ~11,200 broker practitioners / 3,237 firms — **IBISWorld, "Business Brokers in the US," 2025** (confidence 72).
- 6,000+ CEPAs — **Exit Planning Institute / FINRA** (confidence 70).
- 73% of owners plan to transition within 10 yrs; 49% within 5; only 32% have a documented exit plan — **EPI 2023 National State of Owner Readiness** (confidence 85).
- 14% of 5.58M employer firms plan a sale/transfer within 5 yrs (≈780k) — **Gallup, Oct 2024** (confidence 78).
- 2.9M businesses owned by 55+ owners (the freemium "silver tsunami" funnel) — **Project Equity, 2023** (confidence 80).
- ~9,500–10,000 documented brokered closes/yr; median sale price ~$350k — **BizBuySell Insight Reports 2024–2025** (confidence 85).
- 70,242 SBA 7(a) loans FY2024; avg $443,097; valuation required >$250k financed — **SBA FY2024 / SOP 50 10 8** (confidence 95).

> Reconciliation: third-party reports put the *global* business-valuation-software market at $1.0–1.3B (US share ~$400–650M); that includes enterprise/real-estate/IP/litigation valuation — far broader than this SMB/broker niche. The bottom-up $149M is the *defensible niche* TAM.

`ASSUMPTION` flags: M&A-advisor count (4,000, derived from Axial's 1,661 firms ×~2.5), CPA/RIA valuation-active percentages, and all ARPUs are reasoned estimates, not surveyed — the largest sources of sizing error.

---

## 5. Competitive Positioning Statement

**ValuEngine wins the "credible instant valuation" job against single-method estimators and beats opaque incumbents on transparency — but it must win on distribution, not just methodology.** Against BizEquity (black-box, bank-embedded, ~$240/mo) and the Value Builder System (a readiness *score*, not a dollar valuation, with multi-year lock-in), ValuEngine offers a genuinely deeper engine — four independent methods, 10,000-iteration Monte-Carlo DCF, live 8-source enrichment, and a unique 0–100 confidence score with a sensitivity grid — at a lower, transparent price. It loses where the category is won today: institutional distribution (BizEquity in 1,300+ firms), certified/regulated use cases (reserved for CVA/ASA human appraisers), and the price-floor set by free tools at the B2C layer. **The moat that can actually be defended is the confidence-score + transparency as the advisor-conversation differentiator, locked in via warm franchise/association distribution before a funded competitor replicates the live-data architecture (an ~18–24 month window).** Moat confidence: **62/100.**

---

## 6. Per-Segment One-Liners (the wedge)

1. **Solo / small-firm brokers** — *"Win the listing: hand the seller a branded, multi-method BOV in minutes — embedded on your own site."* Wedge feature: shareable white-label BOV PDF.
2. **M&A advisors / LMM bankers** — *"CIM-grade, white-label valuation range with DCF + comps + sensitivities you can drop straight into the deck."* Wedge: editable multi-method export.
3. **Business owners / sellers (B2C funnel)** — *"What's it really worth — and the 3 things that would move the number,"* free, credible, confidence-scored. Wedge: instant range + percentile benchmark.
4. **Buyers / searchers** — *"Is this deal SBA-financeable at the asking price?"* Wedge: an SBA DSCR/financeability model no competitor leads with.
5. **CPAs / RIAs / exit planners** — *"Add a white-label business-valuation service to every business-owner client — a referral and AUM engine, not a cost."* Wedge: multi-client dashboard + annual re-run cadence.

---

## 7. Three-Year Financial Sketch (bear / base / bull)

Blended ARPU ≈ $1,600/yr; gross margin **82–88%** (SaaS infra is cheap; the swing cost is data licensing — commercial FMP tier + replacing FRED, see §9 — plus Vercel functions, Postgres, Resend, PDF compute). Lean team (founder + 1–2 contractors Y1; ~4–6 FTE by Y3). Primary CAC channels are low-cost: existing SEO engine + franchise/association partnerships.

| | Bear | **Base** | Bull |
|---|---|---|---|
| Y1 paying accounts | ~70 | **~150** | ~300 |
| Y1 exit ARR | ~$110k | **~$225k** | ~$480k |
| Y2 exit ARR | ~$350k | **~$0.9M** | ~$1.8M |
| Y3 exit ARR | ~$0.7M | **~$1.6M** | ~$4–5M |
| Break-even | Y3+ | **~Y2–Y3 (bootstrapped)** | ~Y2 |
| LTV/CAC (broker) | ~2× | **~4–5×** | ~6×+ |

LTV/CAC math (base): ARPU $1,800 × ~3-yr life × 85% GM ≈ $4,600 LTV vs. ~$300–$900 blended CAC (SEO/partnership-led). **Bull = a signed franchise/association channel (Transworld, Sunbelt, IBBA, EPI) or BizBuySell-style marketplace integration.** **Bear = no channel deal + slow broker self-serve adoption + a data-licensing forced re-architecture eating a quarter.** Key assumptions to validate: broker free→paid conversion, monthly churn (<3% target), and B2C freemium→sponsored-broker attach rate. (Confidence 55 — financial model is illustrative pending real conversion data.)

---

## 8. 90-Day Launch Plan

**Weeks 1–2 — De-risk the kill-switches + pick the wedge.**
- Stand up the **disclaimer regime**: label outputs "estimate / indication of value — *not an appraisal*," avoid SSVS terms of art ("conclusion of value," "calculated value"), add liability cap + "not for securities filings / tax / litigation" language (mirror Eqvista/BizEquity posture). Engage valuation-aware counsel.
- **Data remediation decision**: replace FRED with public-domain primaries (Treasury FiscalData for risk-free rate, BEA direct for GDP, BLS direct for CPI); decide FMP → SEC-EDGAR-derived comps (public domain) vs. paid FMP commercial/Enterprise license. (See §9.)
- Lock the **ICP wedge**: exit-minded brokers + CEPAs reachable through the warm **Transworld** relationship.

**Weeks 3–6 — Ship the SaaS substrate.** Multi-tenancy + auth + **Stripe billing** + white-label theming (logo/colors/custom domain) + per-tenant branded PDF. This is the bulk of the productization gap from §1.

**Weeks 5–8 — Broker surface.** Embeddable valuation widget for the broker's own site + lead-capture dashboard; MSA-parameterize the BEA/Census enrichment (today Tampa-scoped) to any metro.

**Weeks 7–10 — Design partners.** Onboard 5–10 brokers/advisors from the warm network free→paid; capture a written case study and 15+ pricing/WTP interviews (the validation the sizing needs).

**Weeks 9–12 — Funnel + first paid cohort.** Launch the B2C freemium "what's my business worth" flow on the existing SEO engine in 1–2 verticals; instrument freemium→report and freemium→sponsored-broker conversion; begin IBBA / EPI / M&A Source conference + association outreach.

**First-customer path:** warm Transworld brokers → design-partner case study → IBBA/EPI association channel → franchise-network conversation (the bull-case unlock).

---

## 9. Risk Register — Top 7 (post adversarial red-team)

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Distribution disadvantage** — BizEquity embedded in 1,300+ firms; Value Builder's certified-advisor lock-in | High | Lead with the warm Transworld channel + IBBA/EPI partnerships + the already-built SEO engine; sign a franchise/association channel before scaling features |
| 2 | **Data-licensing kill-switch** — FMP prohibits redistribution on individual plans; **FRED's Jun-2024 ToS prohibits caching/serving its data to third parties** | High | Re-architect to public-domain primaries (Treasury/FiscalData, BEA, BLS, EDGAR — all confirmed commercial-OK); buy FMP commercial/Enterprise tier only if needed; document per-source licensing; legal review before any API/data-licensing model |
| 3 | **Commoditization** — free tools (BizBuySell, Flippa, Empire Flippers) set a B2C price floor | High | Don't lead with B2C-paid; monetize the funnel via B2B white-label + lead value to brokers; compete on transparency/confidence-score, not price |
| 4 | **Moat replicable in 18–24 mo** — all data sources are public APIs | Med-High | Convert the head start into distribution lock-in (multi-year franchise/association deals) and a brand around the confidence score; ship fast |
| 5 | **Accuracy / liability blowback** — publishing valuations | Med | Disclaimer regime ("estimate, not appraisal"), no SSVS terms, contractual liability cap, E&O insurance; confidence score itself manages expectations |
| 6 | **Securities / unregistered broker-dealer** — *only if* the marketplace charges deal-contingent success fees (the 2022 M&A-broker exemption excludes capital-raising) | High *if applicable* | Keep all pricing flat/subscription or flat per-lead; **no success fees**; securities-counsel review before launching the marketplace layer |
| 7 | **Niche ceiling + founder bandwidth** — $78M SAM, modest SOM | Med | Bootstrap lean toward a $3–5M-ARR niche-leader outcome; don't over-raise against a venture narrative the market can't support |

**Red-team result (Phase 3).** The GO verdict was stress-tested against its strongest refutation: *"This is a feature, not a company — BizEquity can bolt on a confidence score and live data in a quarter, they own the bank distribution, the SOM is small, and B2C is commoditized."* That critique **survives partially and is the reason the verdict is a *narrowed, conditional* GO**, not an enthusiastic one: the recommendation deliberately (a) abandons B2C-paid-as-primary, (b) defers the deal-contingent marketplace on securities grounds, (c) sizes the outcome as a niche $3–5M-ARR business rather than a platform, and (d) bets on the *warm distribution asset* as the durable edge rather than the algorithm. Two recommendations were **demoted by the red-team**: "B2C freemium as primary revenue" (dies — $120 ARPU vs. free-tool floor) and "marketplace with rev-share/success fees early" (dies — securities risk + channel conflict + requires funnel volume that doesn't exist yet). What survives is narrower than the brief's optimistic framing — and is what §1–§2 recommend.

---

## 10. Appendix — Sources & Assumption Register

**What we know vs. what we'd validate with N interviews.** The market *sizing*, *competitor pricing*, and *data-licensing* facts are sourced (primary where possible). The *willingness-to-pay price points*, *conversion rates*, *churn*, and the *financial model* are reasoned estimates requiring **≥15 broker/advisor interviews + a live pricing test + a freemium-conversion cohort** before they should drive spend.

**Flagged assumptions (largest sizing-error sources):** M&A-advisor count (4,000, derived); CPA/RIA valuation-active % (20%/15%); all per-segment ARPUs; broker free→paid conversion; 25% listing close-rate and ~$2,500 qualified-seller-lead value (lead-economics confidence only 45); the entire 3-year financial sketch (confidence 55).

**Primary sources (accessed 2026-05-31):**
- *Market:* IBISWorld "Business Brokers in the US" 2025; IBBA Spring 2026 membership + Market Pulse Q4 2024 (PR Newswire/PDF); BizBuySell Insight Reports 2024 & 2025; EPI 2023 National State of Owner Readiness; Gallup "Small-Business Owners Lack a Succession Plan" Oct 2024; Project Equity 2023; SBA FY2024 Capital Impact Report & SOP 50 10 8; SEC Investment Adviser Statistics 2024; NASBA licensee data 2024; Stanford GSB 2024 Search Fund Study; Axial directories.
- *Competitors:* pricing/feature pages and reviews for The Value Builder System, BizEquity, BizBuySell/BizWorth, BVR DealStats, ValuSource, ValuAdder, Equidam, Tagnifi, Capitaliz, Equitest, Flippa, Empire Flippers, Quiet Light, Peak Business Valuation (Capterra, SoftwareWorld, vendor pricing pages, Equidam/Nerdisa comparisons).
- *WTP anchors:* ExitPromise (BOV); BizWorth 2026 & Skyline CPA (appraisal cost); Morgan & Westfield / MidStreet / Rejigg (broker commissions); RoseBiz 2024–2025 (M&A advisor fees); BizBuySell pricing; SBA FY2024 loan data.
- *Legal & data ToS:* Appraisal Foundation (USPAP, AO-21/37/41); NACVA Professional Standards FAQ; AICPA VS Section 100 + Calculation FAQs; Jones Day / Nelson Mullins (2022 M&A-broker exemption); FMP pricing/ToS; NYU Stern/Damodaran data-usage page (Jan 2026); FRED Terms of Use + Jun-2024 update; SEC EDGAR developer terms; Census API ToS; BEA FAQ 147; data.sba.gov; IRS SOI; BLS copyright; FTC GLBA / Safeguards Rule; Sprinto/Drata (SOC 2).

*Full per-claim source URLs with confidence tags are retained in the Phase-1 research record. This report is analysis, not legal or investment advice; the USPAP/SSVS posture, securities structure, GLBA applicability, and FMP/FRED licensing must be reviewed by qualified counsel before launch.*

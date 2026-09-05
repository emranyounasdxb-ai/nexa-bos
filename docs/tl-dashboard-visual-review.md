# TL dashboard visual review

Status: implementation preview. Final visual approval and design lock remain with OWNER.

## Design tokens

| Element | Token |
| --- | --- |
| Body | 14px, line-height 1.5 |
| Section headings | 16px, weight 600 |
| Internal-review KPI values | 36px desktop, 32px mobile; tabular numerals |
| Supporting values | 18–20px |
| Labels and secondary context | 12px |
| Form controls and primary actions | Existing shared 32px controls |
| Section gap | 16px desktop, 12px mobile |
| Panel padding | 16–18px desktop, 14px mobile |
| Panel radius | 10px; subtle 1px border |
| Main text | Existing AMAFH `#1e1e1e` |
| Secondary text | Existing AMAFH `#5f5b6b` |
| Primary accent | Existing AMAFH purple `#6f0d83` |
| Background / surface | Existing `#f6f7fa` / `#ffffff` |
| Supporting chart colors | Existing blue, emerald, amber and muted gray |

Tokens are scoped to `tl-dashboard.module.css`; shared sidebar, breadcrumbs and other dashboards retain their existing design.

## Layout and data presentation

- Review: four internal-review KPIs, compact bank-status strip, queue and activity columns on desktop; one column on mobile.
- Team Performance: one member row combines targets, progress and operational results. A 20% result fills 20% of a fixed 0–100% track. Overachievement retains its uncapped percentage and an above-target label.
- Staff achievement is the existing API's average across assigned target percentages. Mixed units never produce combined monetary/count totals. Missing values remain separate from zero.
- Analytics: six-month Created/Submitted trend; complete stage names and Workflow context; compact product/outcome/delay distributions. Single-category data uses a proportion strip instead of a donut.
- Trend covers six months; product/outcome mix covers cases created in the selected period; stage/internal review distributions cover all cases in scope; delays cover active cases.
- Drill-down links reuse existing scoped TL queues and preserve period and own/team/combined selection. No unsupported stage/product filters are invented.
- Personal panels show separate target items with their unit/milestone and read-only attendance. No attendance record means “Not recorded”; a recorded zero stays zero.
- “Case age” is elapsed time since Application creation. It is not presented as time waiting for TL review.

## Visual approval evidence

Inspect populated and empty states at 1440×900 and 390×844, all four tabs, keyboard disclosure states, fixed-track percentage accuracy and horizontal overflow. Screenshots are review artifacts outside Git; final delivery reports their exact location and observed validation results.

Design lock is deliberately pending OWNER's final visual approval.

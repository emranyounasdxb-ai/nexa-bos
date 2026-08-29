# Task 10 — Targets and KPI Engine

Targets are independently assigned at Employee, Team, and Office levels. Team and office targets are not sums of lower-level targets. Actuals come from Application milestone events using Task 8 event-time attribution.

## Periods

The stored record is monthly. Results can be aggregated for Monthly, QTD, Half-Year, and YTD by summing monthly targets and actuals in that window. Duplicate quarterly/year records are not stored.

## Product measurement

Measurement is stored on each target (`count` or `amount`). When omitted, the product's explicit `targetMeasurement` setting is used. Seeded Personal Finance defaults to Amount and Credit Card to Count. Future products are configurable independently of Application field-validation flags such as `requestedAmountRequired`. Currency is AED. Missing monetary values are not fabricated.

## Milestones

Each target uses one of Submitted, Approved, Booked, or Funded. Application Created is not used. Historical credit follows the owner/org at the milestone timestamp.

## Results

Each result includes Target (configured and effective), Actual, Achievement % (`Actual / Target × 100`), and Gap (`Target − Actual`). Target `0` yields `achievementPct: null` rather than Infinity/NaN. Gap is negative when actual exceeds target (`exceeded: true`).

Daily required run-rate is remaining effective target ÷ remaining company working days (Task 9 working days, Official Holidays excluded). Empty working-day configuration or zero remaining days yields `dailyRequiredRunRate: null`.

Proration is explicit (`prorate` yes/no). Yes uses elapsed ÷ month company working days for the current month. No uses the full configured value.

## Bank-specific targets

An overall product target (`bankId` null) can be accompanied by optional bank-specific rows. Overall actuals are the product total. Bank actuals are filtered to that bank. Bank actuals are not added into the overall actual.

## Uniqueness and employment

One active target per level + entity + month + product + milestone + bank (including overall). Inactive, Resigned, and Terminated employees cannot receive new targets. Historical rows remain.

## Edit, lock, reopen

Edits require a mandatory reason and append immutable history (old/new values, actor, timestamp). Closed months can be locked (`Targets.Edit`). Locked months cannot be edited until `Targets.ReopenPeriod` reopens them with a reason and audit.

## Permissions and scope

User-type permissions only: `Targets.View`, `Targets.Create`, `Targets.Edit`, `Targets.Activate`, `Targets.Deactivate`, `Targets.ReopenPeriod`. OWNER has all. Lists, detail, actuals, filters, dashboard summary, and Employee Performance Profile use reporting / organizational scope. Client-supplied entity IDs are not trusted.

## KPI scorecards

A scorecard is a named set of metrics with weight % and direction (higher is better / lower is better). Drafts may be incomplete. Activation requires weights totaling exactly 100%. Metrics are existing NEXA BOS measures only (milestones, target achievement, conversions, optional attendance score). Attendance never mutates Submitted/Approved/Booked/Funded/PF/CC values; it contributes only its own weighted component when configured.

Employee KPI results expose metric, actual, baseline, achievement, weight, weighted contribution, and final score.

## Profile and dashboard

Employee Performance Profile includes `targetsKpi` when the actor has `Targets.View`. Dashboard includes `targetsSummary` without changing Task 8 KPI cards. Task 9 attendance reporting is unchanged.

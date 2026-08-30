# Finance / Commission / Incentive / Clawback

Task 11 adds effective-dated commission and incentive configuration, immutable Finance
components, monthly recipient payouts, carry-forward, and the Draft → Review → Finalized
workflow.

## Locked calculation policy

- Monetary arithmetic uses `Decimal`, two currency decimal places, and `ROUND_HALF_UP`.
- Each Application + Recipient + Component amount is rounded and persisted before payout totals
  are aggregated.
- Booked commission uses `booked_amount`; Funded commission uses `funded_amount`.
  Requested and approved amounts are never commission bases.
- A Percentage Split pool is rounded first, then allocated by Largest Remainder. Exact remainder
  ties use configured recipient `sort_order`, and allocations reconcile to the cent.
- Slab calculations use one matching slab and are never progressive.
- Negative payout results produce zero payable and a traceable recipient-level carry-forward.

## Recipient attribution

Commission recipient sources are only `CASE_OWNER` and `REPORTING_MANAGER` with an explicit
hierarchy level. Resolution uses effective-dated owner and reporting history at the Booked or
Funded event timestamp. The generated component stores the resolved user and attribution,
organization, reporting-chain, rule, and calculation evidence. Current labels, User Type,
Designation, Team Leader, or present-day organization fields are not attribution sources.

Generation pre-validates every eligible component. A missing or ambiguous required historical
recipient blocks the whole period; no partial period, component, payout, transition, or audit row
is committed. Generation must be run again after source history is corrected.

## Integrity and workflow

- Migration `0012_finance_commission` creates the Task 11 schema and permissions.
- Forward-only `0013_finance_index_cleanup` removes four single-column indexes whose foreign-key
  lookups remain covered by non-partial, non-expression unique B-tree indexes with the same
  leading column. No unique constraint or Finance invariant is removed.
- Rule versions are immutable configuration snapshots. Activation rejects overlapping active
  Bank + Product + milestone date ranges.
- Finance components and period transitions reject ORM update/delete operations.
- Finalized periods reject adjustments and clawbacks. Reopen requires permission and a reason,
  returns the period to Review, and never regenerates it.
- Clawbacks are negative current-period components linked to the original commission and
  Application; the historical component is unchanged.

## Authorization and exports

All `/api/v1/finance` routes require a session and their specific Finance permission. State
changes retain the shared session-bound CSRF check. Reporting visibility is derived from the
authenticated user's server-side User Type; client IDs or query parameters cannot broaden it.
Adjustments and clawbacks validate both frozen attribution and object scope. Payout drill-down
filters each Application at its event-time owner/office scope.

Excel, PDF, and Print are the only formats. They share the scoped statement payload. Excel cells
are formula-injection safe and Print output HTML-escapes dynamic values. CSV is not supported.

## API surface

- `/api/v1/finance/options`
- `/api/v1/finance/commission-rules` and rule activation/deactivation
- `/api/v1/finance/incentive-plans` and plan activation/deactivation
- `/api/v1/finance/periods` with generate, review, finalize, and reopen actions
- period adjustments and clawbacks
- `/api/v1/finance/statements`
- payout component drill-down
- `/api/v1/finance/export`

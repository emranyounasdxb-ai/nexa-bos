# Employment contract register

The contract register stores employment-contract metadata in PostgreSQL and signed evidence under
`FILE_STORAGE_DIR/contract-attachments`. It does not draft legal terms, calculate payroll, generate
templates, or provide digital signatures.

## Lifecycle

HR prepares a Draft, uploads a signed PDF/JPEG/PNG/WebP attachment of at most 10 MB, and submits it
for approval. Only an explicitly permitted OWNER can activate a pending contract, and neither the
employee nor the creator may approve it. Activating a renewal atomically supersedes the previous
active record. Draft and pending records may be returned, rejected, or cancelled with audited
comments; active and historical records cannot be edited.

Displayed `Expiring Soon` and `Expired` values are derived from the active contract's end date in
the Asia/Dubai business calendar. The stored lifecycle remains Active until a later controlled
workflow changes it. The reminder API returns active contracts at the 90, 60, 30, and 7-day
milestones.

## Authorization and evidence

`Contracts.ViewOwn` permits an employee to view and download only their own unexpired active
contract. `Contracts.View` is the separate company register permission. Manager relationships do
not imply either permission. Create, Edit, Approve, Return/Reject, Cancel, History, and Settings are
independent User Type permissions enforced by the API. Own-contract views and all attachment
downloads are audited.

Attachments use generated storage keys, content validation, immutable versions, and an audited
replacement reason. PostgreSQL contains metadata only; file bytes never enter the database or Git.

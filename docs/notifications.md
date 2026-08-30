# Alerts and notifications

Task 12 provides in-app notifications inside the existing NEXA BOS modular monolith. It does not add email, SMS, WhatsApp, push infrastructure, Redis, workers, queues, or external delivery providers.

## Notification center

Users with `Notifications.View` can open `/notifications`, see only deliveries addressed to their user account, review category, severity, timestamp, and safe contextual links, and mark one or all notifications as read. Notifications cannot be deleted.

Critical and Urgent notifications can optionally require acknowledgement. Read and acknowledgement are independent persisted states. Acknowledgement records the recipient, actor, and timestamp and writes an immutable audit event.

## Rules and deterministic events

Authorized administrators can manage rules for existing state transitions:

- Operations: Application stage changed
- Performance: Target status changed
- Finance: Payout period status changed
- Attendance / Holiday: Attendance record corrected
- Security / Admin: User account status changed

Rule categories are derived from the selected source event. Rules support affected user, reporting manager, selected User Type, Office, Team, and Company recipient targets. Recipient resolution is performed server-side against active users, active User Types, `Notifications.View`, and the rule creator's current visibility scope.

Each notification uses the authoritative source event identity plus rule identity for deterministic duplicate suppression. There is no time window, cooldown, or retry interval. Source-module changes and notification delivery participate in the same database transaction.

Task 9 holiday reminders remain persisted by the Attendance module. The existing automatic 0–7 day reminder and urgent reminder endpoints also materialize matching Notification Center deliveries with holiday identity-based duplicate suppression. Dismissing an Attendance reminder marks the corresponding Notification Center delivery read. An Urgent holiday reminder supersedes an unread automatic delivery without deleting history.

## Urgent sends

Users with `Notifications.SendUrgent` can send Urgent in-app notifications through `/notifications/manage`. The API resolves the requested target type within the sender's server-derived visibility scope and rejects hidden or manipulated target identifiers. Only active users with active User Types and `Notifications.View` receive deliveries.

## Authorization and audit

Permissions are assigned only through the existing User Type permission architecture:

- `Notifications.View`
- `Notifications.ManageRules`
- `Notifications.SendUrgent`
- `Notifications.ViewAudit`

The API enforces authentication, exact permissions, CSRF on changes, server-derived scope, and delivery ownership. Contextual links are restricted to approved internal route prefixes and never grant destination access; each destination API remains authoritative.

Rule creation, edits, activation/deactivation, urgent sends, and acknowledgements are audited. Audit visibility uses the requesting user's server-derived User Directory scope.

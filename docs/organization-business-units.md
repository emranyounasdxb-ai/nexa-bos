# Organization masters and retained deletion evidence

The single-company organization path is Office → Department → Business Unit → Team →
Employee. Business Units reuse `Departments.Manage`; this release does not assign new
permissions or change existing User Types. New Teams require an explicit Business Unit
whose Office and Department match. Existing Team/employee Business Unit columns remain
NULL on upgrade: the migration neither creates masters nor guesses mappings.

## Permanent deletion boundary

Deletion is not an assignable permission. Both preview and execution require the active
OWNER identity recorded in the OWNER singleton. Execution additionally requires a
nonblank reason and exact uppercase `DELETE`. Existing deactivation remains available
under its existing permissions.

Initial creation/rename audit and a master's own name history are evidence, not usage.
Every other current or historical reference blocks deletion, including foreign keys,
assignment history, leader history, case/operational references and exact IDs inside JSON
snapshots. Dependencies are checked again during the deleting transaction. NOWAIT writer
locks protect snapshot-only references as well as relational references; concurrent
activity refuses deletion instead of retrying or ignoring dependencies.

Migration `0027_org_business_units` replaces name-history cascade foreign keys with
nullable RESTRICT live links and permanent non-null original IDs. A successful deletion
atomically inserts `organization_master_deletions` with the original ID, type, code,
name, full row snapshot, full name history, reason, actor and deletion timestamp, detaches
the live history links, writes the deletion audit event, and deletes only the unused
master. Existing creation/name timestamps remain in both retained history and snapshot.
Any failure rolls back the entire transaction.

Database triggers prohibit deletion of name history, prohibit changes to detached name
history, and prohibit update/deletion of deletion snapshots. Team-leader history has a
RESTRICT foreign key and remains a usage blocker. There is no history/audit deletion API,
no cascade cleanup, no manual production SQL, and no destructive downgrade.

## UI and compatibility

Organization tabs are Offices, Departments, Business Units, Teams, Designations. Existing
AMAFH drawers, URL tabs, scoped hierarchy, status workflows and responsive layouts are
retained. The delete dialog shows immutable code/name and dependencies, traps focus and
requires reason plus typed confirmation. Cancel/Escape returns focus to the invoking
control; after removal, focus returns to the selected Organization tab.

Business Unit is available in employee organization editing and transfer assignments.
Old transfer snapshots missing the new nullable key remain readable without rewriting
their history. Existing HR free-text Business Unit data is not inferred into master IDs.

All migrations, fixtures and mutation regressions must run only on an explicitly
configured disposable PostgreSQL database after the existing identity guard passes.
This task does not authorize canonical/VPS data changes or deployment.

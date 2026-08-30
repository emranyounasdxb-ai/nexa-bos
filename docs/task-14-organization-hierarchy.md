# Task 14 — Organization hierarchy

The Organization Hierarchy page at `/organization/hierarchy` visualizes the current authoritative `User.reporting_manager_id` relationships. It does not infer reporting links from User Type, Designation, Team, Department, Office, or job-title text.

## Views and context

- Company, Office, Department, and Team filters narrow the employee population while retaining authorized ancestor context.
- Employee-code and name search operates only on the server-authorized population and can locate/highlight a selected node.
- Employee context includes current organization assignments, reporting manager, authorized upward chain, and authorized direct reports.
- The default view includes Active, Probation, and Notice Period employees. Resigned, Terminated, and Inactive employees are available through the explicit historical-status filter; no point-in-time reconstruction is provided.
- Saved reporting-manager, Office, Department, Team, Designation, User Type, and Employment Status changes appear on ordinary API re-fetch or page refresh.

## Authorization and integrity

`Users.View` governs the feature. The API derives Company, Office, Team/Reporting-Hierarchy, or Own visibility from the authenticated user's existing directory scope. Hidden users, ancestors, subordinates, search results, filter options, and profile context are never added to complete the diagram.

Existing user create, edit, and rehire workflows remain authoritative for reporting-manager mutations. Their centralized validation rejects self-reporting, circular reporting chains, inactive or ineligible managers, and managers outside the caller's scope before persistence or audit changes.

## Non-goals

Task 14 does not add hierarchy editing, drag-and-drop mutations, historical as-of charts, hierarchy tables, graph libraries, background polling, WebSockets, Redis, workers, graph databases, or new permissions.

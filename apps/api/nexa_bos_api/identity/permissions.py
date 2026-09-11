from __future__ import annotations

USERS_VIEW = "Users.View"
USERS_CREATE = "Users.Create"
USERS_EDIT = "Users.Edit"
USERS_ACTIVATE = "Users.Activate"
USERS_DEACTIVATE = "Users.Deactivate"
USERS_TERMINATE_SESSIONS = "Users.TerminateSessions"
USERS_UNLOCK = "Users.Unlock"
USERS_ASSIGN_USER_TYPE = "Users.AssignUserType"
USERS_GENERATE_SETUP_LINK = "Users.GenerateSetupLink"
USERS_GENERATE_RESET_LINK = "Users.GenerateResetLink"
USERS_VIEW_AUDIT = "Users.ViewAudit"
USER_PROFILES_BASIC_VIEW = "UserProfiles.Basic.View"
USER_PROFILES_BASIC_UPDATE = "UserProfiles.Basic.Update"
USER_PROFILES_HR_VIEW = "UserProfiles.HR.View"
USER_PROFILES_HR_UPDATE = "UserProfiles.HR.Update"
USER_PROFILES_PRO_VIEW = "UserProfiles.PRO.View"
USER_PROFILES_PRO_UPDATE = "UserProfiles.PRO.Update"
USER_DOCUMENTS_UPLOAD = "UserDocuments.Upload"
USER_DOCUMENTS_REPLACE = "UserDocuments.Replace"
USER_DOCUMENTS_VIEW = "UserDocuments.View"
USER_DOCUMENTS_DOWNLOAD = "UserDocuments.Download"
USER_DOCUMENTS_DELETE = "UserDocuments.Delete"
USER_DOCUMENTS_HISTORY = "UserDocuments.History"
USER_DOCUMENTS_PURGE = "UserDocuments.Purge"
LEAVE_VIEW = "Leave.View"
LEAVE_REQUEST = "Leave.Request"
LEAVE_CREATE_FOR_EMPLOYEE = "Leave.CreateForEmployee"
LEAVE_EDIT = "Leave.Edit"
LEAVE_APPROVE_MANAGER = "Leave.ApproveManager"
LEAVE_APPROVE_HR = "Leave.ApproveHR"
LEAVE_RETURN_REJECT = "Leave.ReturnReject"
LEAVE_CANCEL = "Leave.Cancel"
LEAVE_HISTORY = "Leave.History"
LEAVE_SETTINGS = "Leave.Settings"
LEAVE_OVERRIDE = "Leave.Override"
CONTRACTS_VIEW_OWN = "Contracts.ViewOwn"
CONTRACTS_VIEW = "Contracts.View"
CONTRACTS_CREATE = "Contracts.Create"
CONTRACTS_EDIT = "Contracts.Edit"
CONTRACTS_APPROVE = "Contracts.Approve"
CONTRACTS_RETURN_REJECT = "Contracts.ReturnReject"
CONTRACTS_CANCEL = "Contracts.Cancel"
CONTRACTS_HISTORY = "Contracts.History"
CONTRACTS_SETTINGS = "Contracts.Settings"
USER_TYPES_VIEW = "UserTypes.View"
TRANSFERS_VIEW_OWN = "Transfers.ViewOwn"
TRANSFERS_VIEW = "Transfers.View"
TRANSFERS_CREATE = "Transfers.Create"
TRANSFERS_RECOMMEND = "Transfers.Recommend"
TRANSFERS_EDIT = "Transfers.Edit"
TRANSFERS_REVIEW = "Transfers.Review"
TRANSFERS_APPROVE = "Transfers.Approve"
TRANSFERS_RETURN_REJECT = "Transfers.ReturnReject"
TRANSFERS_CANCEL = "Transfers.Cancel"
TRANSFERS_HISTORY = "Transfers.History"
USER_TYPES_CREATE = "UserTypes.Create"
USER_TYPES_EDIT = "UserTypes.Edit"
USER_TYPES_ACTIVATE = "UserTypes.Activate"
USER_TYPES_DEACTIVATE = "UserTypes.Deactivate"
USER_TYPES_ASSIGN_PERMISSIONS = "UserTypes.AssignPermissions"
USER_TYPES_ASSIGN_SCOPE = "UserTypes.AssignScope"
SECURITY_MANAGE_SETTINGS = "Security.ManageSettings"
OFFICES_MANAGE = "Offices.Manage"
DEPARTMENTS_MANAGE = "Departments.Manage"
DESIGNATIONS_MANAGE = "Designations.Manage"
TEAMS_MANAGE = "Teams.Manage"
CUSTOMERS_VIEW = "Customers.View"
CUSTOMERS_CREATE = "Customers.Create"
CUSTOMERS_EDIT = "Customers.Edit"
CUSTOMERS_ACTIVATE = "Customers.Activate"
CUSTOMERS_DEACTIVATE = "Customers.Deactivate"
CUSTOMERS_MERGE = "Customers.Merge"
BANKS_CREATE = "Banks.Create"
BANKS_EDIT = "Banks.Edit"
BANKS_ACTIVATE = "Banks.Activate"
BANKS_DEACTIVATE = "Banks.Deactivate"
PRODUCTS_CREATE = "Products.Create"
PRODUCTS_EDIT = "Products.Edit"
PRODUCTS_ACTIVATE = "Products.Activate"
PRODUCTS_DEACTIVATE = "Products.Deactivate"
BANK_PRODUCTS_CREATE = "BankProducts.Create"
BANK_PRODUCTS_EDIT = "BankProducts.Edit"
BANK_PRODUCTS_ACTIVATE = "BankProducts.Activate"
BANK_PRODUCTS_DEACTIVATE = "BankProducts.Deactivate"
PRODUCT_VARIANTS_CREATE = "ProductVariants.Create"
PRODUCT_VARIANTS_EDIT = "ProductVariants.Edit"
PRODUCT_VARIANTS_ACTIVATE = "ProductVariants.Activate"
PRODUCT_VARIANTS_DEACTIVATE = "ProductVariants.Deactivate"
APPLICATIONS_VIEW = "Applications.View"
APPLICATIONS_CREATE = "Applications.Create"
APPLICATIONS_EDIT = "Applications.Edit"
APPLICATIONS_SUBMIT = "Applications.Submit"
APPLICATIONS_CORRECT_SUBMITTED = "Applications.CorrectSubmittedData"
APPLICATIONS_UPDATE_STAGE = "Applications.UpdateStage"
APPLICATIONS_CORRECT_STAGE = "Applications.CorrectStage"
APPLICATIONS_REASSIGN_CASE_OWNER = "Applications.ReassignCaseOwner"
APPLICATIONS_SET_OUTCOME = "Applications.SetOutcome"
APPLICATIONS_MARK_DELAY = "Applications.MarkDelay"
APPLICATIONS_CORRECT_DELAY = "Applications.CorrectDelay"
WORKFLOW_STAGES_CREATE = "WorkflowStages.Create"
WORKFLOW_STAGES_EDIT = "WorkflowStages.Edit"
WORKFLOW_STAGES_ACTIVATE = "WorkflowStages.Activate"
WORKFLOW_STAGES_DEACTIVATE = "WorkflowStages.Deactivate"
WORKFLOW_STAGES_CONFIGURE_TRANSITIONS = "WorkflowStages.ConfigureTransitions"
WORKFLOWS_MIGRATE_APPLICATION = "Workflows.MigrateApplication"
DASHBOARD_VIEW = "Dashboard.View"
REPORTS_VIEW = "Reports.View"
REPORTS_EXPORT_EXCEL = "Reports.ExportExcel"
REPORTS_EXPORT_PDF = "Reports.ExportPDF"
REPORTS_PRINT = "Reports.Print"
ATTENDANCE_VIEW = "Attendance.View"
ATTENDANCE_MANAGE = "Attendance.Manage"
ATTENDANCE_MANAGE_OFFICE = "Attendance.ManageOffice"
ATTENDANCE_CORRECT = "Attendance.Correct"
ATTENDANCE_REPORTS = "Attendance.Reports"
NOTIFICATIONS_VIEW = "Notifications.View"
NOTIFICATIONS_MANAGE_RULES = "Notifications.ManageRules"
NOTIFICATIONS_SEND_URGENT = "Notifications.SendUrgent"
NOTIFICATIONS_VIEW_AUDIT = "Notifications.ViewAudit"
TARGETS_VIEW = "Targets.View"
TARGETS_CREATE = "Targets.Create"
TARGETS_EDIT = "Targets.Edit"
TARGETS_ACTIVATE = "Targets.Activate"
TARGETS_DEACTIVATE = "Targets.Deactivate"
TARGETS_REOPEN_PERIOD = "Targets.ReopenPeriod"
FINANCE_VIEW = "Finance.View"
FINANCE_GENERATE_PAYOUT = "Finance.GeneratePayout"
FINANCE_EDIT_ADJUSTMENT = "Finance.EditAdjustment"
FINANCE_REVIEW = "Finance.Review"
FINANCE_FINALIZE = "Finance.Finalize"
FINANCE_REOPEN_PERIOD = "Finance.ReopenPeriod"
FINANCE_VIEW_COMMISSION_RULES = "Finance.ViewCommissionRules"
FINANCE_MANAGE_COMMISSION_RULES = "Finance.ManageCommissionRules"
ASSETS_VIEW = "Assets.View"
ASSETS_MANAGE_MASTER = "Assets.ManageMaster"
ASSETS_MANAGE_STOCK = "Assets.ManageStock"
ASSETS_ALLOCATE = "Assets.Allocate"
ASSETS_TRANSFER = "Assets.Transfer"
ASSETS_RETURN = "Assets.Return"
ASSETS_MANAGE_STATUS = "Assets.ManageStatus"
ASSETS_VIEW_AUDIT = "Assets.ViewAudit"

PERMISSION_CATALOG: tuple[tuple[str, str], ...] = (
    (USERS_VIEW, "View users within assigned visibility scope"),
    (USERS_CREATE, "Create users"),
    (USERS_EDIT, "Edit user profiles, including employee code"),
    (USERS_ACTIVATE, "Activate users"),
    (USERS_DEACTIVATE, "Deactivate users and terminate their session"),
    (USERS_TERMINATE_SESSIONS, "Terminate user sessions without changing the account"),
    (USERS_UNLOCK, "Manually unlock locked accounts"),
    (USERS_ASSIGN_USER_TYPE, "Assign a non-OWNER user type"),
    (USERS_GENERATE_SETUP_LINK, "Generate one-time password setup links"),
    (USERS_GENERATE_RESET_LINK, "Generate one-time password reset links"),
    (USERS_VIEW_AUDIT, "View user-management audit history"),
    (USER_PROFILES_BASIC_VIEW, "View employee Basic profile data within User scope"),
    (USER_PROFILES_BASIC_UPDATE, "Update employee Basic profile data within User scope"),
    (USER_PROFILES_HR_VIEW, "View sensitive HR profile data within User scope"),
    (USER_PROFILES_HR_UPDATE, "Update sensitive HR profile data within User scope"),
    (USER_PROFILES_PRO_VIEW, "View PRO and document metadata within User scope"),
    (USER_PROFILES_PRO_UPDATE, "Update PRO and document metadata within User scope"),
    (USER_DOCUMENTS_UPLOAD, "Upload private employee documents within User scope"),
    (USER_DOCUMENTS_REPLACE, "Replace private employee documents with version history"),
    (USER_DOCUMENTS_VIEW, "View private employee document attachments"),
    (USER_DOCUMENTS_DOWNLOAD, "Download private employee document attachments"),
    (USER_DOCUMENTS_DELETE, "Inactivate current employee document records"),
    (USER_DOCUMENTS_HISTORY, "View immutable employee document version history"),
    (USER_DOCUMENTS_PURGE, "Permanently purge employee document versions and files"),
    (LEAVE_VIEW, "View leave records within approved own or reporting-manager scope"),
    (LEAVE_REQUEST, "Create and edit own draft or returned leave requests"),
    (LEAVE_CREATE_FOR_EMPLOYEE, "Create leave requests for an employee in User scope"),
    (LEAVE_EDIT, "Edit employee draft or returned leave requests in User scope"),
    (LEAVE_APPROVE_MANAGER, "Approve assigned direct-report leave as reporting manager"),
    (LEAVE_APPROVE_HR, "Complete HR approval for leave requests"),
    (LEAVE_RETURN_REJECT, "Return or reject leave requests with a reason"),
    (LEAVE_CANCEL, "Request or approve leave cancellation"),
    (LEAVE_HISTORY, "View immutable leave history within approved scope"),
    (LEAVE_SETTINGS, "Configure leave types, entitlements, and balance adjustments"),
    (LEAVE_OVERRIDE, "Override leave controls with an audited mandatory reason"),
    (CONTRACTS_VIEW_OWN, "View and download the authenticated employee's active contract"),
    (CONTRACTS_VIEW, "View the company employment-contract register"),
    (CONTRACTS_CREATE, "Prepare employment contracts and renewals"),
    (CONTRACTS_EDIT, "Edit draft employment contracts"),
    (CONTRACTS_APPROVE, "Approve and activate employment contracts"),
    (CONTRACTS_RETURN_REJECT, "Return or reject pending employment contracts with a comment"),
    (CONTRACTS_CANCEL, "Cancel draft or pending employment contracts with a reason"),
    (CONTRACTS_HISTORY, "View immutable employment-contract history"),
    (CONTRACTS_SETTINGS, "Configure employment contract types"),
    (USER_TYPES_VIEW, "View user types and their permissions"),
    (USER_TYPES_CREATE, "Create custom user types"),
    (USER_TYPES_EDIT, "Edit custom user type name and description"),
    (USER_TYPES_ACTIVATE, "Activate user types"),
    (USER_TYPES_DEACTIVATE, "Deactivate user types"),
    (USER_TYPES_ASSIGN_PERMISSIONS, "Assign permissions to user types"),
    (
        USER_TYPES_ASSIGN_SCOPE,
        "Assign user-directory, customer, application, and reporting scopes to user types",
    ),
    (SECURITY_MANAGE_SETTINGS, "Configure setup-link expiry, lock duration, and session timeouts"),
    (OFFICES_MANAGE, "Create and maintain offices"),
    (DEPARTMENTS_MANAGE, "Create and maintain departments"),
    (DESIGNATIONS_MANAGE, "Create and maintain designations"),
    (TEAMS_MANAGE, "Create and maintain teams"),
    (CUSTOMERS_VIEW, "View customers within assigned customer visibility scope"),
    (CUSTOMERS_CREATE, "Create customers"),
    (CUSTOMERS_EDIT, "Edit customer profiles and identifiers"),
    (CUSTOMERS_ACTIVATE, "Activate customers"),
    (CUSTOMERS_DEACTIVATE, "Deactivate customers"),
    (CUSTOMERS_MERGE, "Merge customers into a primary record"),
    (BANKS_CREATE, "Create banks"),
    (BANKS_EDIT, "Edit bank names"),
    (BANKS_ACTIVATE, "Activate banks"),
    (BANKS_DEACTIVATE, "Deactivate banks"),
    (PRODUCTS_CREATE, "Create products"),
    (PRODUCTS_EDIT, "Edit product names"),
    (PRODUCTS_ACTIVATE, "Activate products"),
    (PRODUCTS_DEACTIVATE, "Deactivate products"),
    (BANK_PRODUCTS_CREATE, "Create bank-product mappings"),
    (BANK_PRODUCTS_EDIT, "Edit bank-product mappings"),
    (BANK_PRODUCTS_ACTIVATE, "Activate bank-product mappings"),
    (BANK_PRODUCTS_DEACTIVATE, "Deactivate bank-product mappings"),
    (PRODUCT_VARIANTS_CREATE, "Create product variants for valid bank-product mappings"),
    (PRODUCT_VARIANTS_EDIT, "Edit product variant names and descriptions"),
    (PRODUCT_VARIANTS_ACTIVATE, "Activate product variants"),
    (PRODUCT_VARIANTS_DEACTIVATE, "Deactivate product variants"),
    (APPLICATIONS_VIEW, "View applications within assigned application visibility scope"),
    (APPLICATIONS_CREATE, "Create applications"),
    (APPLICATIONS_EDIT, "Edit allowed application fields"),
    (APPLICATIONS_SUBMIT, "Submit applications by recording a Bank File / Case Number"),
    (APPLICATIONS_CORRECT_SUBMITTED, "Correct locked submitted application data with a reason"),
    (APPLICATIONS_UPDATE_STAGE, "Move an application to an allowed workflow stage"),
    (APPLICATIONS_CORRECT_STAGE, "Correct stage history without deleting original events"),
    (APPLICATIONS_REASSIGN_CASE_OWNER, "Reassign Case Owner and preserve ownership history"),
    (APPLICATIONS_SET_OUTCOME, "Set Final Rejected, Cancelled, or Withdrawn terminal outcomes"),
    (APPLICATIONS_MARK_DELAY, "Manually mark an application delay against the current stage"),
    (APPLICATIONS_CORRECT_DELAY, "Correct or cancel a delay without editing the original event"),
    (WORKFLOW_STAGES_CREATE, "Create workflow stages for a Bank and Product"),
    (WORKFLOW_STAGES_EDIT, "Edit workflow stage names and order"),
    (WORKFLOW_STAGES_ACTIVATE, "Activate workflow stages"),
    (WORKFLOW_STAGES_DEACTIVATE, "Deactivate workflow stages"),
    (WORKFLOW_STAGES_CONFIGURE_TRANSITIONS, "Configure allowed stage transitions"),
    (WORKFLOWS_MIGRATE_APPLICATION, "Manually migrate an application to a new workflow version"),
    (DASHBOARD_VIEW, "View the Performance / MIS dashboard within assigned reporting scope"),
    (REPORTS_VIEW, "View reports, rankings, comparisons, and employee performance profiles"),
    (REPORTS_EXPORT_EXCEL, "Export reports to Excel"),
    (REPORTS_EXPORT_PDF, "Export reports to PDF"),
    (REPORTS_PRINT, "Print reports"),
    (
        ATTENDANCE_VIEW,
        "View attendance, schedules, holidays, and in-app holiday reminders in scope",
    ),
    (
        ATTENDANCE_MANAGE,
        "Record attendance and configure schedules, holidays, leave types, and impact rules",
    ),
    (
        ATTENDANCE_MANAGE_OFFICE,
        "Record attendance only for employees within the assigned office visibility scope",
    ),
    (
        ATTENDANCE_CORRECT,
        "Correct attendance records with a mandatory reason and immutable history",
    ),
    (ATTENDANCE_REPORTS, "View attendance reports and attendance score summaries"),
    (NOTIFICATIONS_VIEW, "View and acknowledge own in-app notifications"),
    (
        NOTIFICATIONS_MANAGE_RULES,
        "Create and maintain notification rules within visibility scope",
    ),
    (NOTIFICATIONS_SEND_URGENT, "Send urgent in-app notifications"),
    (
        NOTIFICATIONS_VIEW_AUDIT,
        "View notification administration and acknowledgement audit in scope",
    ),
    (TARGETS_VIEW, "View targets, KPI scorecards, and target results in reporting scope"),
    (TARGETS_CREATE, "Create targets and KPI scorecards"),
    (TARGETS_EDIT, "Edit targets and KPI scorecards, and lock target periods"),
    (TARGETS_ACTIVATE, "Activate targets and KPI scorecards"),
    (TARGETS_DEACTIVATE, "Deactivate targets and KPI scorecards"),
    (TARGETS_REOPEN_PERIOD, "Reopen a locked target period with a mandatory reason"),
    (FINANCE_VIEW, "View Finance payout periods, statements, and drill-down in reporting scope"),
    (FINANCE_GENERATE_PAYOUT, "Generate monthly Finance payout periods"),
    (FINANCE_EDIT_ADJUSTMENT, "Create audited Finance adjustments and clawbacks"),
    (FINANCE_REVIEW, "Move a Finance payout period to Review"),
    (FINANCE_FINALIZE, "Finalize and lock a reviewed Finance payout period"),
    (FINANCE_REOPEN_PERIOD, "Reopen a finalized Finance payout period with a reason"),
    (FINANCE_VIEW_COMMISSION_RULES, "View commission and incentive configuration versions"),
    (FINANCE_MANAGE_COMMISSION_RULES, "Create and activate Finance configuration versions"),
    (ASSETS_VIEW, "View authorized Asset data"),
    (ASSETS_MANAGE_MASTER, "Manage Asset categories and master details within scope"),
    (ASSETS_MANAGE_STOCK, "Create and maintain authorized Asset stock and condition metadata"),
    (ASSETS_ALLOCATE, "Allocate Assets to eligible employees"),
    (ASSETS_TRANSFER, "Transfer Asset employee or Office custody within scope"),
    (ASSETS_RETURN, "Process explicit Asset returns"),
    (ASSETS_MANAGE_STATUS, "Manage audited Lost, Damaged, Repair, and Retired status"),
    (ASSETS_VIEW_AUDIT, "View authorized Asset history and audit"),
)

PERMISSION_CATALOG += (
    (TRANSFERS_VIEW_OWN, "View own employee transfer status"),
    (TRANSFERS_VIEW, "View employee transfers within directory scope"),
    (TRANSFERS_CREATE, "Initiate employee transfers within scope"),
    (TRANSFERS_RECOMMEND, "Recommend transfers for directly assigned employees"),
    (TRANSFERS_EDIT, "Correct unapproved transfer drafts"),
    (TRANSFERS_REVIEW, "Review submitted employee transfers"),
    (TRANSFERS_APPROVE, "Approve and apply employee transfers"),
    (TRANSFERS_RETURN_REJECT, "Return or reject unapproved transfers with a comment"),
    (TRANSFERS_CANCEL, "Cancel employee transfers with a reason"),
    (TRANSFERS_HISTORY, "View immutable employee transfer history"),
)

SYSTEM_TRANSFER_PERMISSION_DEFAULTS = {
    **{code: (TRANSFERS_VIEW_OWN,) for code in ("SE", "OM", "ITM", "AUDITOR")},
    **{
        code: (TRANSFERS_VIEW_OWN, TRANSFERS_RECOMMEND, TRANSFERS_HISTORY)
        for code in ("GM", "BDM", "SM", "COD", "TL")
    },
    "HR": (
        TRANSFERS_VIEW_OWN,
        TRANSFERS_VIEW,
        TRANSFERS_CREATE,
        TRANSFERS_EDIT,
        TRANSFERS_REVIEW,
        TRANSFERS_RETURN_REJECT,
        TRANSFERS_CANCEL,
        TRANSFERS_HISTORY,
    ),
}

EXIT_PERMISSIONS = (
    "Exits.ViewOwn",
    "Exits.View",
    "Exits.Request",
    "Exits.Create",
    "Exits.Edit",
    "Exits.Progress",
    "Exits.Assign",
    "Exits.Clearance",
    "Exits.Approve",
    "Exits.ReturnReject",
    "Exits.Cancel",
    "Exits.History",
)
PERMISSION_CATALOG += tuple(
    (code, code.replace("Exits.", "Employee exit: ")) for code in EXIT_PERMISSIONS
)
SYSTEM_EXIT_PERMISSION_DEFAULTS = {
    **{
        code: ("Exits.ViewOwn", "Exits.Request", "Exits.Clearance")
        for code in ("GM", "BDM", "SM", "COD", "TL", "SE", "OM", "ITM", "FIN", "AUDITOR")
    },
    "HR": tuple(code for code in EXIT_PERMISSIONS if code != "Exits.Approve"),
}

APPROVAL_PERMISSIONS = ("Approvals.View", "Approvals.Decide")
PERMISSION_CATALOG += tuple(
    (code, code.replace("Approvals.", "Approval Centre: ")) for code in APPROVAL_PERMISSIONS
)
SYSTEM_APPROVAL_PERMISSION_DEFAULTS = {
    code: APPROVAL_PERMISSIONS for code in ("HR", "GM", "BDM", "SM", "COD", "TL")
}

ALL_PERMISSION_CODES: tuple[str, ...] = tuple(code for code, _ in PERMISSION_CATALOG)

SYSTEM_PROFILE_PERMISSION_DEFAULTS: dict[str, tuple[str, ...]] = {
    "HR": (
        USER_PROFILES_BASIC_VIEW,
        USER_PROFILES_HR_VIEW,
        USER_PROFILES_HR_UPDATE,
    ),
    "PRO": (
        USER_PROFILES_BASIC_VIEW,
        USER_PROFILES_PRO_VIEW,
        USER_PROFILES_PRO_UPDATE,
        USER_DOCUMENTS_UPLOAD,
        USER_DOCUMENTS_REPLACE,
        USER_DOCUMENTS_VIEW,
        USER_DOCUMENTS_DOWNLOAD,
        USER_DOCUMENTS_DELETE,
        USER_DOCUMENTS_HISTORY,
    ),
}

_LEAVE_EMPLOYEE_DEFAULTS = (LEAVE_VIEW, LEAVE_REQUEST, LEAVE_CANCEL, LEAVE_HISTORY)
_LEAVE_MANAGER_DEFAULTS = _LEAVE_EMPLOYEE_DEFAULTS + (
    LEAVE_APPROVE_MANAGER,
    LEAVE_RETURN_REJECT,
)
SYSTEM_LEAVE_PERMISSION_DEFAULTS: dict[str, tuple[str, ...]] = {
    "GM": _LEAVE_MANAGER_DEFAULTS,
    "BDM": _LEAVE_MANAGER_DEFAULTS,
    "SM": _LEAVE_MANAGER_DEFAULTS,
    "COD": _LEAVE_MANAGER_DEFAULTS,
    "TL": _LEAVE_MANAGER_DEFAULTS,
    "SE": _LEAVE_EMPLOYEE_DEFAULTS,
    "OM": _LEAVE_EMPLOYEE_DEFAULTS,
    "ITM": _LEAVE_EMPLOYEE_DEFAULTS,
    "AUDITOR": _LEAVE_EMPLOYEE_DEFAULTS,
    "HR": (
        LEAVE_VIEW,
        LEAVE_CREATE_FOR_EMPLOYEE,
        LEAVE_EDIT,
        LEAVE_APPROVE_HR,
        LEAVE_RETURN_REJECT,
        LEAVE_CANCEL,
        LEAVE_HISTORY,
        LEAVE_SETTINGS,
    ),
}

_CONTRACT_EMPLOYEE_DEFAULTS = (CONTRACTS_VIEW_OWN,)
SYSTEM_CONTRACT_PERMISSION_DEFAULTS: dict[str, tuple[str, ...]] = {
    "GM": _CONTRACT_EMPLOYEE_DEFAULTS,
    "BDM": _CONTRACT_EMPLOYEE_DEFAULTS,
    "SM": _CONTRACT_EMPLOYEE_DEFAULTS,
    "COD": _CONTRACT_EMPLOYEE_DEFAULTS,
    "TL": _CONTRACT_EMPLOYEE_DEFAULTS,
    "SE": _CONTRACT_EMPLOYEE_DEFAULTS,
    "OM": _CONTRACT_EMPLOYEE_DEFAULTS,
    "ITM": _CONTRACT_EMPLOYEE_DEFAULTS,
    "AUDITOR": _CONTRACT_EMPLOYEE_DEFAULTS,
    "HR": (
        CONTRACTS_VIEW_OWN,
        CONTRACTS_VIEW,
        CONTRACTS_CREATE,
        CONTRACTS_EDIT,
        CONTRACTS_RETURN_REJECT,
        CONTRACTS_CANCEL,
        CONTRACTS_HISTORY,
        CONTRACTS_SETTINGS,
    ),
}

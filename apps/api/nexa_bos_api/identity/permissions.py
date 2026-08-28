from __future__ import annotations

USERS_VIEW = "Users.View"
USERS_CREATE = "Users.Create"
USERS_EDIT = "Users.Edit"
USERS_ACTIVATE = "Users.Activate"
USERS_DEACTIVATE = "Users.Deactivate"
USERS_UNLOCK = "Users.Unlock"
USERS_ASSIGN_USER_TYPE = "Users.AssignUserType"
USERS_GENERATE_SETUP_LINK = "Users.GenerateSetupLink"
USERS_GENERATE_RESET_LINK = "Users.GenerateResetLink"
USERS_VIEW_AUDIT = "Users.ViewAudit"
USER_TYPES_VIEW = "UserTypes.View"
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

PERMISSION_CATALOG: tuple[tuple[str, str], ...] = (
    (USERS_VIEW, "View users within assigned visibility scope"),
    (USERS_CREATE, "Create users"),
    (USERS_EDIT, "Edit user profiles, including employee code"),
    (USERS_ACTIVATE, "Activate users"),
    (USERS_DEACTIVATE, "Deactivate users and terminate their session"),
    (USERS_UNLOCK, "Manually unlock locked accounts"),
    (USERS_ASSIGN_USER_TYPE, "Assign a non-OWNER user type"),
    (USERS_GENERATE_SETUP_LINK, "Generate one-time password setup links"),
    (USERS_GENERATE_RESET_LINK, "Generate one-time password reset links"),
    (USERS_VIEW_AUDIT, "View user-management audit history"),
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
)

ALL_PERMISSION_CODES: tuple[str, ...] = tuple(code for code, _ in PERMISSION_CATALOG)

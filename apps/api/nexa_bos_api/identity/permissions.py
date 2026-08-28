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
        "Assign user-directory and customer visibility scopes to user types",
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
)

ALL_PERMISSION_CODES: tuple[str, ...] = tuple(code for code, _ in PERMISSION_CATALOG)

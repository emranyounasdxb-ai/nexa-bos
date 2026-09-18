export const modulePermissionDependencies: Record<string, string[]> = {
  "Assets.ManageStock": [
    "Assets.View"
  ],
  "Assets.ManageMaster": [
    "Assets.View"
  ],
  "Assets.Allocate": [
    "Assets.View"
  ],
  "Assets.Return": [
    "Assets.View"
  ],
  "Assets.Transfer": [
    "Assets.View"
  ],
  "Assets.ManageStatus": [
    "Assets.View"
  ],
  "Assets.ViewAudit": [
    "Assets.View"
  ],
  "Attendance.Manage": [
    "Attendance.View"
  ],
  "Attendance.ManageOffice": [
    "Attendance.View"
  ],
  "Attendance.Correct": [
    "Attendance.View"
  ],
  "Attendance.Reports": [
    "Attendance.View"
  ],
  "Attendance.CloseMonth": [
    "Attendance.View"
  ],
  "Attendance.ReopenMonth": [
    "Attendance.View"
  ],
  "Assets.ManageCategories": [
    "Assets.View"
  ],
  "Assets.Repair": [
    "Assets.View"
  ],
  "Assets.Retire": [
    "Assets.View"
  ],
  "Assets.Reports": [
    "Assets.View"
  ],
  "Assets.Export": [
    "Assets.View",
    "Assets.Reports"
  ],
  "Attendance.Daily": [
    "Attendance.View"
  ],
  "Attendance.Calendar": [
    "Attendance.View"
  ],
  "Attendance.Upload": [
    "Attendance.View"
  ],
  "Attendance.ConfirmImport": [
    "Attendance.View"
  ],
  "Attendance.RecordApprovedLeave": [
    "Attendance.View"
  ],
  "Attendance.Export": [
    "Attendance.View",
    "Attendance.Reports"
  ],
  "Attendance.ManageHolidays": [
    "Attendance.View"
  ],
  "Attendance.ManageLeaveTypes": [
    "Attendance.View"
  ]
};
export function includeModuleDependencies(codes: string[]) { return Array.from(new Set(codes.flatMap(code => [code, ...(modulePermissionDependencies[code] ?? [])]))); }
export function removeModuleDependencies(codes: string[], removed: Set<string>) { return codes.filter(code => !removed.has(code) && !(modulePermissionDependencies[code] ?? []).some(required => removed.has(required))); }

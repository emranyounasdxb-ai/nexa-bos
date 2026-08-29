export const ATTENDANCE_STATUSES = [
  "Present",
  "Absent",
  "Leave",
  "Official Holiday",
  "Weekly Off",
] as const;

export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeCode: string | null;
  fullName: string | null;
  officeName: string | null;
  departmentName: string | null;
  attendanceDate: string;
  status: AttendanceStatus;
  timeIn: string | null;
  timeOut: string | null;
  notes: string | null;
  leaveTypeId: string | null;
  leaveType: { id: string; name: string; code: string } | null;
  isLate: boolean;
  lateMinutes: number;
  isEarlyExit: boolean;
  earlyExitMinutes: number;
  isIncomplete: boolean;
  calculationState: string;
  workedOnHoliday: boolean;
  corrections: {
    id: string;
    reason: string;
    oldValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    createdAt: string;
    actorName: string | null;
  }[];
};

export type AttendanceSummary = {
  presentCount: number;
  absentCount: number;
  leaveCount: number;
  lateCount: number;
  averageLateMinutes: number;
  averageTimeIn: string | null;
  averageTimeOut: string | null;
  earlyExitCount: number;
  earlyExitMinutes: number;
  incompleteCount: number;
  attendancePercent: number | null;
  attendanceScore: number;
  attendanceImpact: number;
  officialHolidayCount: number;
  weeklyOffCount: number;
  workedOnHolidayCount: number;
};

export function formatMinutes(value: number): string {
  return `${value} min`;
}

export function todayIso(): string {
  const now = new Date();
  const dubai = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Dubai" }));
  const year = dubai.getFullYear();
  const month = String(dubai.getMonth() + 1).padStart(2, "0");
  const day = String(dubai.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

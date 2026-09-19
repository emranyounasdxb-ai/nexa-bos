"use client";
import { useAuth } from "@/lib/auth-context";
import { AttendanceRecords } from "./attendance-records";
import { AttendanceWorkspace } from "./attendance-workspace";
export default function AttendancePage() {
  const { can } = useAuth();
  return can("Attendance.View") ? <AttendanceWorkspace /> : <AttendanceRecords />;
}

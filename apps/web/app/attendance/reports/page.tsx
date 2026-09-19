"use client";
import { AttendanceReportsView } from "./reports-view";
import { AttendanceWorkspace } from "../attendance-workspace";
import { useAuth } from "@/lib/auth-context";
export default function AttendanceReportsPage() {
  const { user, can } = useAuth();
  return can("Attendance.View") && can("Attendance.Reports") ? <AttendanceWorkspace /> : <AttendanceReportsView />;
}

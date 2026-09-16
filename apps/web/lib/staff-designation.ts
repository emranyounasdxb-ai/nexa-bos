type StaffDesignation = {
  userType?: { code: string; name: string } | null;
  designation?: { name: string } | null;
};

/** User Types are the canonical staff designations; retain legacy labels for unassigned records. */
export function staffDesignationName(staff: StaffDesignation): string | undefined {
  return staff.userType && staff.userType.code !== "PENDING"
    ? staff.userType.name
    : staff.designation?.name;
}

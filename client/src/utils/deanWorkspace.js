export const isDeanPersonalPath = (pathname) =>
  pathname === "/dean/faculty" || pathname.startsWith("/dean/faculty/");

// Compatibility aliases preserve inert calendar options only, never owner/redirect inputs.
export function calendarAliasSuffix(search = "", hash = "") {
  const input = new URLSearchParams(search), output = new URLSearchParams();
  for (const key of ["view", "date", "includeInactive", "includeFinalized"]) {
    const value = input.get(key);
    if (input.getAll(key).length !== 1) continue;
    const valid = key === "view" ? ["month", "week"].includes(value)
      : key === "date" ? /^\d{4}-\d{2}-\d{2}$/.test(value || "") && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
      : ["true", "false"].includes(value);
    if (valid) output.set(key, value);
  }
  const safeHash = /^#[a-z\d_-]{1,80}$/i.test(hash) ? hash : "";
  return (output.size ? `?${output}` : "") + safeHash;
}

export const isDeanManagementPath = (pathname) =>
  pathname.startsWith("/dean/") && !isDeanPersonalPath(pathname);

export function deanWorkspace(pathname, search = "") {
  if (isDeanPersonalPath(pathname)) return "faculty";
  if (
    ["/dean/notifications", "/dean/account"].includes(pathname) &&
    new URLSearchParams(search).get("workspace") === "faculty"
  )
    return "faculty";
  return "management";
}

export function legacyFacultyDestination(pathname, search = "", hash = "") {
  const page = pathname.replace(/^\/faculty\/?/, "").replace(/\/+$/, "");
  const shared = {
    notifications: "notifications",
    account: "account",
    profile: "account",
    security: "account",
  };
  if (Object.hasOwn(shared, page)) {
    const params = new URLSearchParams(search);
    params.set("workspace", "faculty");
    return `/dean/${shared[page]}?${params}${hash}`;
  }
  return `/dean/faculty/${page === "appointments" ? "consultations" : page || "dashboard"}${search}${hash}`;
}

// Compatibility redirects keep only validated monitoring filters, never arbitrary targets.
export function monitoringQuery(search = "") {
  const input = new URLSearchParams(search), output = new URLSearchParams();
  const statuses = ["Pending", "Reschedule Proposed", "Confirmed", "Rejected", "Cancelled", "Expired", "Awaiting Attendance Update", "Completed", "Attendance Review", "Awaiting Faculty Schedule", "Approved", "Needs Reschedule", "Rescheduled", "No Show"];
  for (const key of ["search", "facultyId", "studentId", "status", "mode", "page", "limit", "sort"]) {
    const values = input.getAll(key), value = values[0];
    if (values.length !== 1) continue;
    const valid = key === "search" ? value.length <= 150 && !/[\x00-\x1f\x7f]/.test(value)
      : ["facultyId", "studentId"].includes(key) ? /^[a-f\d]{24}$/i.test(value)
      : key === "status" ? statuses.includes(value)
      : key === "mode" ? ["Online", "Face-to-Face"].includes(value)
      : key === "sort" ? ["newest", "oldest"].includes(value)
      : /^[1-9]\d*$/.test(value) && Number.isSafeInteger(+value) && +value <= (key === "limit" ? 100 : 1000000);
    if (valid) output.set(key, value);
  }
  const start = input.get("start"), end = input.get("end");
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (input.getAll("start").length === 1 && input.getAll("end").length === 1 && validDate(start) && validDate(end)) {
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (days > 0 && days <= 366) { output.set("start", start); output.set("end", end); }
  }
  return output.size ? `?${output}` : "";
}

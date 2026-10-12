export const isDeanPersonalPath = (pathname) =>
  pathname === "/dean/faculty" || pathname.startsWith("/dean/faculty/");

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

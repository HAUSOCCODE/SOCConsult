import { Link } from "react-router-dom";

export default function DeferredFeaturePage({ title, personal = false, dashboard, dashboardLabel }) {
  return (
    <section className="rounded-2xl border bg-white p-4 sm:p-6">
      <h2 className="text-xl font-bold text-maroon-900">{title}</h2>
      <p className="mt-3 text-sm text-slate-600">
        This feature is scheduled for a later development task.
      </p>
      <Link
        className="btn-secondary mt-5 inline-flex"
        to={dashboard || (personal ? "/dean/faculty/dashboard" : "/dean/dashboard")}
      >
        Back to {dashboardLabel || (personal ? "My Faculty Workspace" : "Dean Management")}
      </Link>
    </section>
  );
}

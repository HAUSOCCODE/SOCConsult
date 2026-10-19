import { useMemo, useState } from "react";
import { Pencil, Power, Trash2 } from "lucide-react";
import ConfirmDialog from "../ConfirmDialog";

const formatDateTime = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  return date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" });
};

export default function StudentAvailabilityList({ availability, busyId, onEdit, onToggle, onDelete }) {
  const [filter, setFilter] = useState("all");
  const [removeTarget, setRemoveTarget] = useState(null);
  const visible = useMemo(() => availability.filter((item) => filter === "all" || (filter === "active" ? item.isActive : !item.isActive)), [availability, filter]);

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Delete Availability"
        message="Delete this preferred availability period?"
        supportingText="This action cannot be undone."
        confirmLabel="Delete"
        loadingLabel="Deleting..."
        loading={Boolean(removeTarget && busyId === removeTarget._id)}
        onConfirm={async () => { await onDelete(removeTarget); setRemoveTarget(null); }}
        onCancel={() => !busyId && setRemoveTarget(null)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-bold text-maroon-900">Preferred Periods</h2>
          <p className="mt-1 text-xs text-slate-500">Active and inactive periods remain private to you.</p>
        </div>
        <div className="flex rounded-lg border border-slate-200 p-1" aria-label="Availability filter">
          {["all", "active", "inactive"].map((value) => (
            <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold capitalize ${filter === value ? "bg-maroon-800 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{value}</button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-slate-300 p-6 text-center">
          <p className="text-sm font-semibold text-slate-700">{availability.length ? `No ${filter} availability periods.` : "No private availability entered."}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">Adding availability is optional and is not required to book a Faculty slot.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {visible.map((item) => (
            <article key={item._id} className="min-w-0 rounded-xl border border-slate-200 p-3.5">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-slate-800">{formatDateTime(item.startAt)}</p>
                  <p className="mt-1 break-words text-xs text-slate-500">Until {formatDateTime(item.endAt)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${item.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{item.isActive ? "Active" : "Inactive"}</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-secondary text-xs" type="button" onClick={() => onEdit(item)} disabled={Boolean(busyId)}><Pencil size={14} /> Edit</button>
                <button className="btn-secondary text-xs" type="button" onClick={() => onToggle(item)} disabled={Boolean(busyId)}><Power size={14} /> {item.isActive ? "Deactivate" : "Activate"}</button>
                <button className="btn-danger-action-sm text-xs" type="button" onClick={() => setRemoveTarget(item)} disabled={Boolean(busyId)}><Trash2 size={14} /> Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

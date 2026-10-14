import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";

const emptyForm = { startAt: "", endAt: "", isActive: true };

const manilaInputValue = (value) => {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
};

const toManilaTimestamp = (value) => `${value}:00+08:00`;

export default function StudentAvailabilityForm({ editing, onCancel, onSaved }) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setForm(
      editing
        ? {
            startAt: manilaInputValue(editing.startAt),
            endAt: manilaInputValue(editing.endAt),
            isActive: Boolean(editing.isActive),
          }
        : emptyForm,
    );
    setError("");
  }, [editing]);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    const startAt = new Date(toManilaTimestamp(form.startAt));
    const endAt = new Date(toManilaTimestamp(form.endAt));
    if (!form.startAt || !form.endAt || !Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime())) {
      setError("Select valid start and end date/time values.");
      return;
    }
    if (endAt <= startAt) {
      setError("End date/time must be later than start date/time.");
      return;
    }
    if (startAt <= new Date()) {
      setError("Start date/time must be in the future.");
      return;
    }
    setSaving(true);
    try {
      const data = await api(editing ? `/student-availability/${editing._id}` : "/student-availability", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          isActive: form.isActive,
        }),
      });
      setForm(emptyForm);
      await onSaved(data.message);
    } catch (requestError) {
      setError(requestError.message || "Unable to save availability.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="font-bold text-maroon-900">{editing ? "Edit Availability" : "Add Availability"}</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">Add an optional preferred period using Philippine time.</p>
      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <form onSubmit={submit} className="mt-4 min-w-0 space-y-4">
        <label className="block min-w-0 text-sm font-semibold text-slate-700">
          Start date/time
          <input className="field mt-1.5 block w-full min-w-0" type="datetime-local" required value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} />
        </label>
        <label className="block min-w-0 text-sm font-semibold text-slate-700">
          End date/time
          <input className="field mt-1.5 block w-full min-w-0" type="datetime-local" required value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />
          Active preferred period
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" type="submit" disabled={saving}>{saving ? "Saving..." : editing ? "Save Changes" : "Add Availability"}</button>
          {editing && <button className="btn-secondary" type="button" onClick={onCancel}>Cancel</button>}
        </div>
      </form>
    </section>
  );
}

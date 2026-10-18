import { formatManilaDisplay } from "../../utils/formatDateTime";
import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import {
  EmptyState,
  ErrorState,
  Loading,
  StatusBadge,
} from "../../components/UI";
import { useToast } from "../../context/ToastContext";
import ConfirmDialog from "../../components/ConfirmDialog";
import {
  Clock3,
  ChevronDown,
  MapPin,
  Monitor,
  Pencil,
  Power,
  Trash2,
  UsersRound,
} from "lucide-react";

const emptyForm = {
  date: "",
  startTime: "",
  endTime: "",
  mode: "Face-to-Face",
  location: "",
  meetingPlatform: "Google Meet",
  customMeetingPlatform: "",
  meetingLink: "",
};

const meetingPlatforms = ["Google Meet", "Microsoft Teams", "Zoom", "Other"];

const validMeetingLink = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
};

const localParts = (value) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return { date: `${year}-${month}-${day}`, time: `${hours}:${minutes}` };
};

const toTimestamp = (date, time) =>
  new Date(`${date}T${time}:00`).toISOString();

const formatLocation = (value) => {
  const text = String(value || "").trim();
  if (!text) return "Location not provided";
  const normalized = text.replace(/\s+-\s+/g, " – ");
  if (normalized !== normalized.toUpperCase()) return normalized;
  return normalized
    .split(/(\s+|–)/)
    .map((part) => {
      if (!/[A-Z]/.test(part) || part === "–") return part;
      if (part.length <= 3) return part;
      return `${part.charAt(0)}${part.slice(1).toLowerCase()}`;
    })
    .join("");
};

export default function ManageAvailability() {
  const toast = useToast();
  const showRequestError = (error, fallback) => {
    const message = error?.message || fallback;
    if (/overlap|conflict|cannot be removed|active consultation/i.test(message))
      toast.warning(message);
    else toast.error(message);
  };
  const [availability, setAvailability] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState("");
  const [formError, setFormError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [expandedScheduleId, setExpandedScheduleId] = useState(null);

  useEffect(() => {
    if (availability?.length && expandedScheduleId === null) {
      setExpandedScheduleId(availability[0]._id);
    }
  }, [availability, expandedScheduleId]);

  const load = async () => {
    try {
      const data = await api("/availability/mine");
      setAvailability(
        Array.isArray(data?.availability) ? data.availability : [],
      );
      setLoadError("");
    } catch {
      setLoadError("Unable to load availability. Please try again.");
    }
  };

  useEffect(() => {
    void load();
    const refresh = () => void load();
    const interval = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId("");
    setFormError("");
  };

  const save = async (event) => {
    event.preventDefault();
    setFormError("");
    const start = new Date(`${form.date}T${form.startTime}:00`);
    const end = new Date(`${form.date}T${form.endTime}:00`);
    if (
      !form.date ||
      !form.startTime ||
      !form.endTime ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime())
    ) {
      setFormError(
        "Select a valid availability date, start time, and end time.",
      );
      return;
    }
    if (end <= start) {
      setFormError("End time must be later than start time.");
      return;
    }
    if (start <= new Date()) {
      setFormError("Start time must be later than the current time.");
      return;
    }
    const meetingPlatform =
      form.meetingPlatform === "Other"
        ? form.customMeetingPlatform.trim()
        : form.meetingPlatform;
    if (form.mode === "Face-to-Face" && !form.location.trim()) {
      setFormError("Location is required for face-to-face availability.");
      return;
    }
    if (form.mode === "Online" && !meetingPlatform) {
      setFormError("Meeting platform is required for online availability.");
      return;
    }
    if (
      form.mode === "Online" &&
      form.meetingLink.trim() &&
      !validMeetingLink(form.meetingLink.trim())
    ) {
      setFormError("Please enter a valid meeting link.");
      return;
    }
    setSaving(true);
    try {
      const data = await api(
        editingId ? `/availability/${editingId}` : "/availability",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({
            startAt: toTimestamp(form.date, form.startTime),
            endAt: toTimestamp(form.date, form.endTime),
            mode: form.mode,
            location: form.mode === "Face-to-Face" ? form.location.trim() : "",
            meetingPlatform: form.mode === "Online" ? meetingPlatform : "",
            meetingLink: form.mode === "Online" ? form.meetingLink.trim() : "",
          }),
        },
      );
      await load();
      resetForm();
      toast.success(data.message);
    } catch (requestError) {
      showRequestError(requestError, "Unable to save availability.");
    } finally {
      setSaving(false);
    }
  };

  const edit = (item) => {
    const start = localParts(item.startAt);
    const end = localParts(item.endAt);
    setEditingId(item._id);
    const platform = item.meetingPlatform || "";
    const knownPlatform = meetingPlatforms.includes(platform);
    setForm({
      date: start.date,
      startTime: start.time,
      endTime: end.time,
      mode: item.mode || "Online",
      location: item.location || "",
      meetingPlatform: knownPlatform
        ? platform
        : platform
          ? "Other"
          : "Google Meet",
      customMeetingPlatform: knownPlatform ? "" : platform,
      meetingLink: item.meetingLink || "",
    });
    setFormError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const updateActiveState = async (item) => {
    if (!item || toggling) return;
    setToggling(true);
    try {
      const data = await api(`/availability/${item._id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      toast.success(data.message);
      await load();
      setDeactivateTarget(null);
    } catch (requestError) {
      showRequestError(requestError, "Unable to update availability.");
    } finally {
      setToggling(false);
    }
  };

  const toggle = (item) => {
    if (item.isActive) setDeactivateTarget(item);
    else void updateActiveState(item);
  };

  const remove = async () => {
    if (!removeTarget || removing) return;
    setRemoving(true);
    try {
      const data = await api(`/availability/${removeTarget._id}`, {
        method: "DELETE",
      });
      setRemoveTarget(null);
      toast.success(
        data.message || "Consultation availability removed successfully.",
      );
      await load();
    } catch (requestError) {
      showRequestError(requestError, "Unable to remove availability.");
    } finally {
      setRemoving(false);
    }
  };

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!availability) return <Loading />;

  return (
    <div className="grid w-full min-w-0 max-w-full gap-5 pb-20 md:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)] md:items-start min-[1200px]:grid-cols-1 min-[1200px]:gap-5">
      <ConfirmDialog
        open={Boolean(removeTarget)}
        title="Remove Consultation Availability"
        message="Are you sure you want to remove this consultation availability?"
        supportingText="Students will no longer be able to book this availability."
        confirmLabel="Remove"
        loadingLabel="Removing..."
        loading={removing}
        onConfirm={remove}
        onCancel={() => !removing && setRemoveTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        title="Deactivate Consultation Availability"
        message="Are you sure you want to deactivate this consultation availability?"
        supportingText="Students will no longer be able to book this availability while it is inactive."
        confirmLabel="Deactivate"
        loadingLabel="Deactivating..."
        variant="default"
        loading={toggling}
        onConfirm={() => updateActiveState(deactivateTarget)}
        onCancel={() => !toggling && setDeactivateTarget(null)}
      />
      <section className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm min-[1200px]:p-5">
        <h1 className="text-base font-bold text-maroon-900">
          Add Consultation Availability
        </h1>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Publish the schedules students can select when booking.
        </p>
        {formError && (
          <p id="availability-form-error" role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {formError}
          </p>
        )}
        <form aria-describedby={formError ? "availability-form-error" : undefined} onSubmit={save} className="mt-4 min-w-0 max-w-full space-y-3.5">
          <div className="grid min-w-0 grid-cols-1 gap-3 min-[1200px]:grid-cols-3">
            <Field label="Availability Date">
              <input
                className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm"
                type="date"
                required
                value={form.date}
                onChange={(event) =>
                  setForm({ ...form, date: event.target.value })
                }
              />
            </Field>
            <Field label="Start Time">
              <input
                className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm"
                type="time"
                step="60"
                required
                value={form.startTime}
                onChange={(event) =>
                  setForm({ ...form, startTime: event.target.value })
                }
              />
            </Field>
            <Field label="End Time">
              <input
                className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm"
                type="time"
                step="60"
                required
                value={form.endTime}
                onChange={(event) =>
                  setForm({ ...form, endTime: event.target.value })
                }
              />
            </Field>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 min-[1200px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <Field label="Consultation Mode">
              <select
                className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm"
                value={form.mode}
                onChange={(event) => {
                  const mode = event.target.value;
                  setForm({
                    ...form,
                    mode,
                    location: mode === "Face-to-Face" ? form.location : "",
                    meetingPlatform:
                      mode === "Online"
                        ? form.meetingPlatform || "Google Meet"
                        : "Google Meet",
                    customMeetingPlatform:
                      mode === "Online" ? form.customMeetingPlatform : "",
                    meetingLink: mode === "Online" ? form.meetingLink : "",
                  });
                  setFormError("");
                }}
              >
                <option value="Face-to-Face">Face-to-Face</option>
                <option value="Online">Online</option>
              </select>
            </Field>
            {form.mode === "Face-to-Face" ? (
              <Field label="Location">
                <input
                  className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm"
                  required
                  placeholder="e.g., SJH Building - Room 104"
                  value={form.location}
                  onChange={(event) =>
                    setForm({ ...form, location: event.target.value })
                  }
                />
              </Field>
            ) : (
              <>
                <Field label="Meeting Platform">
                  <select
                    className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm"
                    required
                    value={form.meetingPlatform}
                    onChange={(event) => {
                      setForm({
                        ...form,
                        meetingPlatform: event.target.value,
                        customMeetingPlatform:
                          event.target.value === "Other"
                            ? form.customMeetingPlatform
                            : "",
                      });
                      setFormError("");
                    }}
                  >
                    {meetingPlatforms.map((platform) => (
                      <option key={platform} value={platform}>
                        {platform}
                      </option>
                    ))}
                  </select>
                </Field>
                {form.meetingPlatform === "Other" && (
                  <Field label="Platform Name">
                    <input
                      className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm"
                      required
                      placeholder="Enter meeting platform"
                      value={form.customMeetingPlatform}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          customMeetingPlatform: event.target.value,
                        })
                      }
                    />
                  </Field>
                )}
                <Field label="Meeting Link">
                  <input
                    className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm"
                    type="url"
                    placeholder="https://meet.google.com/abc-defg-hij"
                    value={form.meetingLink}
                    onChange={(event) =>
                      setForm({ ...form, meetingLink: event.target.value })
                    }
                  />
                </Field>
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-col items-stretch gap-2 min-[1200px]:flex-row min-[1200px]:items-center">
            <button
              disabled={saving}
              className="btn-primary h-10 min-h-0 w-full rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 min-[1200px]:w-[168px]"
            >
              {saving
                ? "Saving..."
                : editingId
                  ? "Update Availability"
                  : "Add Availability"}
            </button>
            {editingId && (
              <button
                type="button"
                className="btn-secondary"
                onClick={resetForm}
              >
                Cancel Edit
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="min-w-0">
        <h2 className="mb-3 text-lg font-bold text-slate-900">
          Published Schedules
        </h2>
        {availability.length === 0 ? (
          <EmptyState
            title="No consultation schedules published yet."
            text="Create an availability schedule above to make consultation times available to Students."
          />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-3 min-[1200px]:grid-cols-2">
            {availability.map((item) => (
              <ScheduleCard
                key={item._id}
                item={item}
                onEdit={edit}
                onToggle={toggle}
                onRemove={(id) =>
                  setRemoveTarget(availability.find((item) => item._id === id))
                }
                expanded={expandedScheduleId === item._id}
                onExpand={() =>
                  setExpandedScheduleId((current) =>
                    current === item._id ? "" : item._id,
                  )
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ScheduleCard({
  item,
  onEdit,
  onToggle,
  onRemove,
  expanded,
  onExpand,
}) {
  const dateOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const timeOptions = { hour: "numeric", minute: "2-digit" };
  const expired = item.status === "expired";
  const statusLabel = expired
    ? "Expired"
    : item.isActive
      ? "Active"
      : "Inactive";
  const online = item.mode === "Online";
  const detail = online
    ? item.meetingPlatform || "Meeting platform not provided"
    : formatLocation(item.location);
  const ModeIcon = online ? Monitor : UsersRound;
  return (
    <article className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-colors duration-150 hover:border-maroon-200">
      <div className="p-3.5">
        <button
          type="button"
          className="flex w-full min-w-0 items-start justify-between gap-2 text-left md:pointer-events-none"
          aria-expanded={expanded}
          onClick={onExpand}
        >
          <h3 className="min-w-0 break-words text-[15px] font-bold leading-6 text-maroon-900 sm:text-base">
            {formatManilaDisplay(new Date(item.startAt), dateOptions, "date")}
          </h3>
          <span className="flex shrink-0 items-center gap-1.5">
            <StatusBadge status={statusLabel} compact />
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={`mt-0.5 shrink-0 text-slate-500 transition-transform md:hidden ${expanded ? "rotate-180" : ""}`}
            />
          </span>
        </button>

        <dl className={`${expanded ? "grid" : "hidden"} mt-3 min-w-0 grid-cols-1 gap-2 md:grid md:grid-cols-[1.05fr_.8fr_1.15fr]`}>
          <ScheduleDetail icon={Clock3} label="Time">
            {formatManilaDisplay(new Date(item.startAt), timeOptions, "time")} –{" "}
            {formatManilaDisplay(new Date(item.endAt), timeOptions, "time")}
          </ScheduleDetail>
          <ScheduleDetail icon={ModeIcon} label="Mode">
            {item.mode || "Online"}
          </ScheduleDetail>
          <ScheduleDetail
            icon={online ? Monitor : MapPin}
            label={online ? "Platform" : "Location"}
          >
            {detail}
          </ScheduleDetail>
        </dl>
      </div>

      <div className={`${expanded ? "flex" : "hidden"} min-w-0 flex-wrap items-center justify-center gap-2 border-t border-slate-200 bg-slate-50/70 p-2.5 md:flex`}>
        {!expired && (
          <>
            <button
              type="button"
              onClick={() => onEdit(item)}
              className="btn-action-sm h-8 w-auto gap-1.5 px-2.5"
            >
              <Pencil size={14} aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => onToggle(item)}
              className={`inline-flex h-8 w-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition-colors duration-150 focus-visible:ring-2 ${item.isActive ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-200" : "border-maroon-200 bg-white text-maroon-800 hover:bg-maroon-50 focus-visible:ring-maroon-100"}`}
            >
              <Power size={14} aria-hidden="true" />
              {item.isActive ? "Deactivate" : "Activate"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => onRemove(item._id)}
          className="btn-danger-action-sm h-8 w-auto gap-1.5 px-2.5"
        >
          <Trash2 size={14} aria-hidden="true" />
          Remove
        </button>
      </div>
    </article>
  );
}

function ScheduleDetail({ icon: Icon, label, className = "", children }) {
  return (
    <div
      className={`flex min-w-0 items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 ${className}`}
    >
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-maroon-700 shadow-sm">
        <Icon size={15} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
          {label}
        </dt>
        <dd className="mt-0.5 break-words text-xs font-semibold leading-5 text-slate-700 sm:text-sm">
          {children}
        </dd>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block w-full min-w-0 max-w-full text-xs font-semibold text-slate-700">
      {label}
      {children}
    </label>
  );
}

import { formatManilaDisplay, manilaInputParts, parseManilaInput } from "../../utils/formatDateTime";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { safeStudentError } from "../../utils/studentUiErrors";
import {
  EmptyState,
  ErrorState,
  Loading,
  StatusBadge,
} from "../../components/UI";
import { useToast } from "../../context/ToastContext";
import { Link } from "react-router-dom";
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
  endDate: "",
  startTime: "",
  endTime: "",
  mode: "Face-to-Face",
  location: "",
  meetingPlatform: "Google Meet",
  customMeetingPlatform: "",
  meetingLink: "",
  isActive: true,
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

const localParts = manilaInputParts;
const toTimestamp = (date, time) => parseManilaInput(date, time).toISOString();
const hasEnded = (item, now) => new Date(item.endAt) <= now;
const canChange = (item, now) =>
  !hasEnded(item, now) && new Date(item.startAt) > now && !item.protected;
const reservationGuidance = "This schedule has an existing consultation reservation. Review the consultation before changing its availability.";

function previewDeactivation(availability, first, afterLast, now) {
  const preview = { eligible: [], started: 0, inactive: 0, protected: 0 };
  for (const item of availability) {
    const start = new Date(item.startAt);
    if (!(start >= first && start < afterLast)) continue;
    if (hasEnded(item, now) || start <= now) preview.started++;
    else if (!item.isActive) preview.inactive++;
    else if (item.protected) preview.protected++;
    else preview.eligible.push(item);
  }
  return preview;
}

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

export default function ManageAvailability({ routeBase = "/faculty", consultationsPath = "/faculty/appointments", showCalendarLink = true, onChanged, revision = 0 }) {
  const requestSequence = useRef(0);
  const mutationBusy = useRef(false);
  const [editingVersion, setEditingVersion] = useState(0);
  const toast = useToast();
  const showRequestError = (error, fallback) => {
    if (error?.status === 409) toast.warning("This slot changed, overlaps a schedule, or has a consultation reservation/history. Refresh availability. Use consultation reschedule or cancellation for reserved slots; deactivate slots with history.");
    else toast.error(safeStudentError(error, error?.status === 400 ? "Check the availability date, times, mode, and meeting details." : fallback));
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
  const [showPast, setShowPast] = useState(false);
  const [showSemester, setShowSemester] = useState(false);
  const [period, setPeriod] = useState({ startDate: "", endDate: "" });
  const [semesterTarget, setSemesterTarget] = useState(null);
  const [endingSemester, setEndingSemester] = useState(false);
  const [semesterResult, setSemesterResult] = useState(null);

  const load = async () => {
    const sequence = ++requestSequence.current;
    try {
      const data = await api("/availability/mine", { cache: "no-store" });
      if (sequence !== requestSequence.current) return;
      setAvailability(
        Array.isArray(data?.availability) ? data.availability : [],
      );
      setLoadError("");
    } catch {
      if (sequence !== requestSequence.current) return;
      setLoadError("Unable to load availability. Please try again.");
    }
  };

  useEffect(() => {
    void load();
    const refresh = () => void load();
    const interval = window.setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    return () => {
      ++requestSequence.current;
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [revision]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId("");
    setFormError("");
  };

  const save = async (event) => {
    event.preventDefault();
    setFormError("");
    if (mutationBusy.current) return;
    const start = parseManilaInput(form.date, form.startTime);
    const end = parseManilaInput(form.endDate || form.date, form.endTime);
    if (
      !form.date ||
      !form.startTime ||
      !form.endTime ||
      !start ||
      !end
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
    mutationBusy.current = true;
    setSaving(true);
    try {
      const data = await api(
        editingId ? `/availability/${editingId}` : "/availability",
        {
          method: editingId ? "PUT" : "POST",
          body: JSON.stringify({
            ...(editingId && { expectedVersion: editingVersion }),
            isActive: form.isActive,
            startAt: toTimestamp(form.date, form.startTime),
            endAt: toTimestamp(form.endDate || form.date, form.endTime),
            mode: form.mode,
            location: form.mode === "Face-to-Face" ? form.location.trim() : "",
            meetingPlatform: form.mode === "Online" ? meetingPlatform : "",
            meetingLink: form.mode === "Online" ? form.meetingLink.trim() : "",
          }),
        },
      );
      await load();
      onChanged?.();
      resetForm();
      toast.success(data.message);
    } catch (requestError) {
      showRequestError(requestError, "Unable to save availability.");
    } finally {
      mutationBusy.current = false;
      setSaving(false);
    }
  };

  const edit = (item) => {
    if (mutationBusy.current || !canChange(item, Date.now())) return;
    const start = localParts(item.startAt);
    const end = localParts(item.endAt);
    setEditingId(item._id);
    setEditingVersion(item.__v ?? 0);
    const platform = item.meetingPlatform || "";
    const knownPlatform = meetingPlatforms.includes(platform);
    setForm({
      isActive: item.isActive,
      date: start.date,
      endDate: end.date,
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
    if (!item || mutationBusy.current) return;
    mutationBusy.current = true;
    setToggling(true);
    try {
      const data = await setActiveState(item, !item.isActive);
      toast.success(data.message);
      await load();
      onChanged?.();
      setDeactivateTarget(null);
    } catch (requestError) {
      showRequestError(requestError, "Unable to update availability.");
    } finally {
      mutationBusy.current = false;
      setToggling(false);
    }
  };

  const toggle = (item) => {
    if (mutationBusy.current || !canChange(item, Date.now())) return;
    if (item.isActive) setDeactivateTarget(item);
    else void updateActiveState(item);
  };

  const setActiveState = (item, isActive) => api(`/availability/${item._id}`, {
    method: "PUT",
    body: JSON.stringify({ isActive, expectedVersion: item.__v ?? 0 }),
  });

  const endSemester = async () => {
    if (!semesterTarget?.eligible.length || mutationBusy.current) return;
    mutationBusy.current = true;
    setEndingSemester(true);
    setSemesterResult(null);
    const { eligible, ...previewCounts } = semesterTarget;
    const result = { ...previewCounts, deactivated: 0, changed: 0, failed: 0, notAttempted: 0, stopped: "" };
    try {
      for (const [index, item] of eligible.entries()) {
        if (!canChange(item, Date.now())) {
          result.started++;
          continue;
        }
        try {
          const data = await setActiveState(item, false);
          if (data?.availability?._id === item._id && data.availability.isActive === false) result.deactivated++;
          else result.failed++;
        } catch (error) {
          if (error?.status === 409 && error.message === "This slot has a reserved consultation. Use the consultation reschedule or cancellation workflow.") result.protected++;
          else if ([404, 409].includes(error?.status)) result.changed++;
          else {
            result.failed++;
            if ([401, 403, 429].includes(error?.status)) {
              result.notAttempted = eligible.length - index - 1;
              result.stopped = error.status === 429
                ? "The server is limiting requests. Wait before trying again."
                : "Your session or permissions could not be verified. Sign in again if needed.";
              break;
            }
          }
        }
      }
      await load();
      if (result.deactivated) onChanged?.();
    } finally {
      setSemesterResult(result);
      setSemesterTarget(null);
      setEndingSemester(false);
      mutationBusy.current = false;
    }
  };

  const remove = async () => {
    if (!removeTarget || mutationBusy.current) return;
    mutationBusy.current = true;
    setRemoving(true);
    try {
      const data = await api(`/availability/${removeTarget._id}`, {
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: removeTarget.__v ?? 0 }),
      });
      setRemoveTarget(null);
      toast.success(
        data.message || "Consultation availability removed successfully.",
      );
      await load();
      onChanged?.();
    } catch (requestError) {
      showRequestError(requestError, "Unable to remove availability.");
    } finally {
      mutationBusy.current = false;
      setRemoving(false);
    }
  };

  if (!availability) return loadError ? <ErrorState message={loadError} onRetry={load} /> : <Loading />;

  const now = Date.now();
  const past = availability.filter(item => hasEnded(item, now));
  const current = availability.filter(item => !hasEnded(item, now));
  const visible = showPast ? past : current;
  const controlsDisabled = Boolean(loadError) || saving || removing || toggling || endingSemester;
  const { startDate, endDate } = period;
  const first = parseManilaInput(startDate, "00:00");
  const lastMinute = parseManilaInput(endDate, "23:59");
  const preview = showSemester && first && lastMinute && first <= lastMinute
    ? previewDeactivation(availability, first, +lastMinute + 60_000, now)
    : null;

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
      <ConfirmDialog
        open={Boolean(semesterTarget)}
        title="Confirm End Semester Availability"
        message={semesterTarget && `Deactivate ${semesterTarget.eligible.length} ${semesterTarget.eligible.length === 1 ? "schedule" : "schedules"} from ${semesterTarget.startDate} through ${semesterTarget.endDate} (Asia/Manila)?`}
        supportingText="Students cannot book deactivated schedules. The server checks each schedule again before updating it."
        confirmLabel="Deactivate Schedules"
        loadingLabel="Deactivating schedules…"
        variant="default"
        loading={endingSemester}
        onConfirm={endSemester}
        onCancel={() => !mutationBusy.current && setSemesterTarget(null)}
      />
      {loadError && <div className="md:col-span-full"><ErrorState message={loadError} onRetry={load} /></div>}
      <section className="w-full min-w-0 max-w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm min-[1200px]:p-5">
        <h2 className="text-base font-bold text-maroon-900">
          Add Consultation Availability
        </h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Publish one consultation slot for one Student. Times use Asia/Manila.
        </p>
        {showCalendarLink && <Link className="mt-2 inline-block text-sm font-semibold text-maroon-800 underline" to={`${routeBase}/calendar`}>Open Consultation Calendar</Link>}
        {formError && (
          <p id="availability-form-error" role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {formError}
          </p>
        )}
        <form aria-describedby={formError ? "availability-form-error" : undefined} onSubmit={save} className="mt-4 min-w-0 max-w-full space-y-3.5">
          <div className="grid min-w-0 grid-cols-1 gap-3 min-[1200px]:grid-cols-3">
            <Field label="Start Date">
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
            <Field label="End Date">
              <input className="field mt-1.5 h-11 min-h-0 box-border px-3 py-2 text-sm" type="date" required
                value={form.endDate || form.date} onChange={event => setForm({ ...form, endDate: event.target.value })} />
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
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={event => setForm({ ...form, isActive: event.target.checked })} />Active and available for booking</label>
          <div className="flex min-w-0 flex-col items-stretch gap-2 min-[1200px]:flex-row min-[1200px]:items-center">
            <button
              disabled={controlsDisabled}
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-slate-900">Published Schedules</h2>
          <button type="button" className="btn-secondary" aria-expanded={showSemester}
            aria-controls="semester-availability" disabled={controlsDisabled} onClick={() => setShowSemester(value => !value)}>
            End Semester Availability
          </button>
        </div>
        <div id="semester-availability" hidden={!showSemester} className="mb-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm text-slate-600">Select a date range in Asia/Manila. Schedules count if their start date falls on or between the two dates.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Semester Start Date">
              <input className="field mt-1.5" type="date" value={startDate} disabled={endingSemester}
                onChange={event => setPeriod({ ...period, startDate: event.target.value })} />
            </Field>
            <Field label="Semester End Date">
              <input className="field mt-1.5" type="date" value={endDate} disabled={endingSemester}
                onChange={event => setPeriod({ ...period, endDate: event.target.value })} />
            </Field>
          </div>
          <div aria-live="polite" className="space-y-1 text-sm text-slate-700">
            {!preview ? <p>{startDate && endDate ? "Enter valid dates with the end date on or after the start date." : "Select both dates to preview schedules."}</p> : <>
              <p>{preview.eligible.length ? `${preview.eligible.length} eligible for deactivation` : "No eligible schedules in this range."}</p>
              <p>{preview.started + preview.inactive + preview.protected} to skip ({preview.inactive} inactive, {preview.started} started or ended, {preview.protected} reserved)</p>
            </>}
          </div>
          {preview?.protected > 0 && <ReservationGuidance consultationsPath={consultationsPath} />}
          <button type="button" className="btn-primary" disabled={controlsDisabled || !preview?.eligible.length}
            onClick={() => !mutationBusy.current && setSemesterTarget({ ...preview, ...period })}>
            Review Deactivation
          </button>
          <div role="status" className="space-y-1 text-sm text-slate-700">
            {semesterResult && <>
              <p className="font-semibold">Deactivation results for {semesterResult.startDate} through {semesterResult.endDate}</p>
              <p>{semesterResult.deactivated} deactivated</p>
              <p>{semesterResult.started + semesterResult.inactive + semesterResult.protected + semesterResult.changed} skipped ({semesterResult.inactive} inactive, {semesterResult.started} started or ended, {semesterResult.protected} reserved, {semesterResult.changed} changed or removed)</p>
              <p>{semesterResult.failed} {semesterResult.failed === 1 ? "update" : "updates"} could not be confirmed</p>
              {semesterResult.stopped && <p>{semesterResult.stopped}</p>}
              {semesterResult.notAttempted > 0 && <p>{semesterResult.notAttempted} {semesterResult.notAttempted === 1 ? "schedule" : "schedules"} left unprocessed</p>}
            </>}
          </div>
          {semesterResult?.protected > 0 && !preview?.protected && <ReservationGuidance consultationsPath={consultationsPath} />}
        </div>
        <div role="group" aria-label="Published schedule views" className="mb-3 flex flex-wrap gap-2">
          <button type="button" className={showPast ? "btn-secondary" : "btn-primary"} aria-pressed={!showPast}
            onClick={() => { setShowPast(false); setExpandedScheduleId(null); }}>Current &amp; Upcoming ({current.length})</button>
          <button type="button" className={showPast ? "btn-primary" : "btn-secondary"} aria-pressed={showPast}
            onClick={() => { setShowPast(true); setExpandedScheduleId(null); }}>Past Schedules ({past.length})</button>
        </div>
        {visible.length === 0 ? (
          <EmptyState
            title={showPast ? "No past schedules." : "No current or upcoming schedules."}
            text={showPast ? "Ended availability appears here." : "Add a consultation availability schedule to publish new times."}
          />
        ) : (
          <div className="grid min-w-0 grid-cols-1 gap-3 min-[1200px]:grid-cols-2">
            {visible.map((item, index) => (
              <ScheduleCard
                key={item._id}
                consultationsPath={consultationsPath}
                item={item}
                now={now}
                controlsDisabled={controlsDisabled}
                onEdit={edit}
                onToggle={toggle}
                onRemove={() => {
                  if (!mutationBusy.current && canChange(item, Date.now())) setRemoveTarget(item);
                }}
                expanded={expandedScheduleId === null ? index === 0 : expandedScheduleId === item._id}
                onExpand={() =>
                  setExpandedScheduleId((current) =>
                    current === item._id || (current === null && index === 0) ? "" : item._id,
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
  now = Date.now(),
  controlsDisabled = false,
  onEdit,
  onToggle,
  onRemove,
  expanded,
  onExpand,
  consultationsPath,
}) {
  const dateOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  };
  const timeOptions = { hour: "numeric", minute: "2-digit" };
  const expired = hasEnded(item, now);
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

      {canChange(item, now) && (
        <div className={`${expanded ? "flex" : "hidden"} min-w-0 flex-wrap items-center justify-center gap-2 border-t border-slate-200 bg-slate-50/70 p-2.5 md:flex`}>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => onEdit(item)}
              className="btn-action-sm h-8 w-auto gap-1.5 px-2.5"
            >
              <Pencil size={14} aria-hidden="true" />
              Edit
            </button>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={() => onToggle(item)}
              className={`inline-flex h-8 w-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-semibold transition-colors duration-150 focus-visible:ring-2 ${item.isActive ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 focus-visible:ring-amber-200" : "border-maroon-200 bg-white text-maroon-800 hover:bg-maroon-50 focus-visible:ring-maroon-100"}`}
            >
              <Power size={14} aria-hidden="true" />
              {item.isActive ? "Deactivate" : "Activate"}
            </button>
            <button
              type="button"
              disabled={controlsDisabled}
              onClick={onRemove}
              className="btn-danger-action-sm h-8 w-auto gap-1.5 px-2.5"
            >
              <Trash2 size={14} aria-hidden="true" />
              Remove
            </button>
        </div>
      )}
      {!expired && new Date(item.startAt) <= now && <p className="p-3 text-sm text-slate-600">This schedule has already started.</p>}
      {item.protected && <div className="p-3"><ReservationGuidance consultationsPath={consultationsPath} /></div>}
    </article>
  );
}

function ReservationGuidance({ consultationsPath }) {
  return <p className="text-sm text-amber-900">{reservationGuidance} <Link className="font-semibold underline" to={consultationsPath}>Open Consultations</Link></p>;
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

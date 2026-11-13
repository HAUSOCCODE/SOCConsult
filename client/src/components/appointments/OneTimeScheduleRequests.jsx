import useDialogFocus from "../../hooks/useDialogFocus";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { StatusBadge } from "../UI";
import AppointmentRequestDetailsModal from "./AppointmentRequestDetailsModal";
import { useToast } from "../../context/ToastContext";
import { formatPersonName } from "../../utils/formatPersonName";

const SAFE_APPROVAL_MESSAGES = new Set([
  "Choose a valid future date and time with a timezone.",
  "Duration must be between 5 and 240 minutes.",
  "Choose a consultation mode.",
  "Enter a location (up to 150 characters).",
  "Enter a meeting platform and an optional valid HTTP or HTTPS meeting link.",
  "Choose a valid future schedule.",
  "Invalid consultation duration.",
  "Choose a valid consultation mode.",
  "Enter a valid location.",
  "Enter a valid meeting platform.",
  "This schedule conflicts with another active appointment.",
  "This request is no longer pending or does not belong to you.",
  "The Student account is no longer active.",
]);
const actionError = (error, decision) => {
  if (!error?.status) return "Network connection interrupted. Please try again.";
  if (error.status === 401) return "Your session has expired. Please sign in again.";
  if ([403, 404].includes(error.status)) return "This request is unavailable or you do not have permission to update it.";
  if (decision === "approve" && SAFE_APPROVAL_MESSAGES.has(error.message)) return error.message;
  if (decision === "approve" && error.status === 409) return "The selected schedule conflicts with another consultation or the request changed. Refresh and try again.";
  if (decision === "approve") return "Unable to approve the consultation. Please try again.";
  if (decision === "reject" && error.status === 409) return "This request changed before it could be rejected. Refresh and try again.";
  return "Unable to reject the consultation. Please try again.";
};

const initial = {
  date: "",
  time: "",
  durationMinutes: "",
  mode: "Face-to-Face",
  location: "",
  meetingPlatform: "Google Meet",
  meetingLink: "",
};

export default function OneTimeScheduleRequests({ reviewRequest, onClose, onDecided, onConflict } = {}) {
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(reviewRequest || null);
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState({ ...initial, durationMinutes: String(reviewRequest?.estimatedDurationMinutes || "") });
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [decisionError, setDecisionError] = useState("");
  const [busy, setBusy] = useState(false);
  const reviewButtonRef = useRef(null);
  const reviewDialogRef = useRef(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const closeReview = () => { setSelected(null); setRejecting(false); setDecisionError(""); onClose?.(); };
  const load = () =>
    api("/schedule-requests/mine")
      .then((data) => setRequests(data.requests || []))
      .catch(() => toast.error("Unable to load schedule requests."));
  useEffect(() => {
    if (reviewRequest) return;
    void load();
    const timer = window.setInterval(load, 20000);
    return () => window.clearInterval(timer);
  }, []);
  useDialogFocus(reviewDialogRef, { open: Boolean(selected), busy, onClose: () => { if (!busyRef.current) closeReview(); }, restoreTarget: reviewButtonRef.current });
  const choose = (request, opener) => {
    reviewButtonRef.current = opener;
    setSelected(request);
    setRejectNote("");
    setRejecting(false);
    setDecisionError("");
    setForm({
      ...initial,
      durationMinutes: String(request.estimatedDurationMinutes || ""),
    });
  };
  const decide = async (decision) => {
    if (!selected || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDecisionError("");
    try {
      if (!Number.isInteger(selected.__v)) throw new Error("Reload request details.");
      if (decision === "reject" && !rejectNote.trim()) {
        setDecisionError("Please provide a reason for rejecting this consultation.");
        return;
      }
      let body = { note: rejectNote };
      if (decision === "approve") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { setDecisionError("Please select a valid consultation date."); return; }
        if (!/^\d{2}:\d{2}$/.test(form.time)) { setDecisionError("Please enter a valid start time."); return; }
        const durationMinutes = Number(form.durationMinutes);
        if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 240) {
          setDecisionError("Duration must be between 5 and 240 minutes."); return;
        }
        if (form.mode === "Face-to-Face" && !form.location.trim()) {
          setDecisionError("Please provide a consultation location."); return;
        }
        if (form.mode === "Online" && !form.meetingPlatform.trim()) {
          setDecisionError("Please provide an online meeting platform."); return;
        }
        const startAt = `${form.date}T${form.time}:00+08:00`;
        if (!Number.isFinite(new Date(startAt).getTime()) || new Date(startAt) <= new Date()) {
          setDecisionError("Please choose a future consultation time."); return;
        }
        body = {
          startAt,
          durationMinutes,
          mode: form.mode,
          location: form.location,
          meetingPlatform: form.meetingPlatform,
          meetingLink: form.meetingLink,
        };
      }
      const data = await api(`/schedule-requests/${selected._id}/${decision}`, {
        method: "PUT",
        body: JSON.stringify({ ...body, expectedVersion: selected.__v }),
      });
      toast.success(decision === "approve" ? "Consultation approved and scheduled successfully." : "Consultation request rejected.");
      closeReview();
      if (reviewRequest) onDecided?.();
      else await load();
    } catch (error) {
      const message = error?.status ? actionError(error, decision)
        : error?.message === "Reload request details." ? "Reload request details before deciding." : actionError(error, decision);
      setDecisionError(message);
      toast.error(message);
      if (error.status === 409) onConflict?.();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="w-full max-w-none space-y-3">
      {!reviewRequest && <>
      <div>
        <h2 className="text-lg font-bold text-maroon-900">
          Requests for a Schedule
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Students here have not chosen a published schedule. Approve with a
          one-time consultation time or reject.
        </p>
      </div>
      <div className="min-w-0 space-y-3">
        {requests.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No pending schedule requests.
          </p>
        ) : (
          requests.map((request) => (
            <article
              key={request._id}
              className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold text-maroon-900">
                    {request.subject}
                  </h3>
                  <p className="mt-1 text-sm text-slate-700">
                    {formatPersonName(request.student?.name)} ·{" "}
                    {request.estimatedDurationMinutes} minutes
                  </p>
                  <p className="mt-1 text-sm text-slate-600">
                    {request.reason}
                  </p>
                </div>
                <StatusBadge appointment status={request.status} allowWrap />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setDetails(request)}
                >
                  View Details
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={(event) => choose(request, event.currentTarget)}
                >
                  Review Request
                </button>
              </div>
            </article>
          ))
        )}
      </div>
      </>}
      {selected &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 sm:p-6"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) {
                closeReview();
              }
            }}
          >
            <section
              ref={reviewDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="review-schedule-request-title"
              tabIndex={-1}
              className="flex max-h-[calc(100dvh-48px)] w-[min(680px,calc(100vw-32px))] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <header className="shrink-0 border-b border-slate-200 px-4 py-4 sm:px-6 sm:py-5">
                <h3
                  id="review-schedule-request-title"
                  className="text-xl font-bold text-maroon-900"
                >
                  Review Schedule Request
                </h3>
                <p className="mt-2 break-words text-sm text-slate-700">
                  {formatPersonName(selected.student?.name)} ·{" "}
                  {selected.subject}
                </p>
                <p className="mt-1 break-words text-sm text-slate-600">
                  {selected.reason}
                </p>
              </header>
              <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6 sm:py-5">
                {!rejecting && <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Consultation date
                    <input disabled={busy}
                      type="date"
                      className="field mt-1"
                      value={form.date}
                      onChange={(event) =>
                        setForm({ ...form, date: event.target.value })
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Start time (Asia/Manila)
                    <input disabled={busy}
                      type="time"
                      className="field mt-1"
                      value={form.time}
                      onChange={(event) =>
                        setForm({ ...form, time: event.target.value })
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Duration (minutes)
                    <input disabled={busy}
                      type="number"
                      min="5"
                      max="240"
                      className="field mt-1"
                      value={form.durationMinutes}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          durationMinutes: event.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="text-sm font-semibold">
                    Mode
                    <select disabled={busy}
                      className="field mt-1"
                      value={form.mode}
                      onChange={(event) =>
                        setForm({ ...form, mode: event.target.value })
                      }
                    >
                      <option>Face-to-Face</option>
                      <option>Online</option>
                    </select>
                  </label>
                  {form.mode === "Face-to-Face" ? (
                    <label className="text-sm font-semibold sm:col-span-2">
                      Location
                      <input disabled={busy}
                        className="field mt-1"
                        maxLength="150"
                        value={form.location}
                        onChange={(event) =>
                          setForm({ ...form, location: event.target.value })
                        }
                      />
                    </label>
                  ) : (
                    <>
                      <label className="text-sm font-semibold">
                        Meeting platform
                        <input disabled={busy}
                          className="field mt-1"
                          maxLength="100"
                          value={form.meetingPlatform}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              meetingPlatform: event.target.value,
                            })
                          }
                        />
                      </label>
                      <label className="text-sm font-semibold">
                        Meeting link (optional)
                        <input disabled={busy}
                          type="url"
                          className="field mt-1"
                          value={form.meetingLink}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              meetingLink: event.target.value,
                            })
                          }
                        />
                      </label>
                    </>
                  )}
                </div>}
                {rejecting && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <label className="text-sm font-semibold">
                    Rejection reason (required)
                    <textarea disabled={busy}
                      className="field mt-1 min-h-20 resize-y"
                      maxLength="500"
                      value={rejectNote}
                      onChange={(event) => { setRejectNote(event.target.value); setDecisionError(""); }}
                    />
                  </label>
                </div>}
                {decisionError && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{decisionError}</p>}
              </div>
              <footer className="sticky bottom-0 flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 min-[460px]:flex-row min-[460px]:flex-wrap min-[460px]:justify-end sm:px-6 sm:py-4">
                <button
                  type="button"
                  className="btn-secondary w-full min-[460px]:w-auto"
                  disabled={busy}
                  onClick={() => {
                    if (rejecting) {
                      setRejecting(false);
                      setDecisionError("");
                    } else closeReview();
                  }}
                >
                  {rejecting ? "Back" : "Close"}
                </button>
                <button
                  type="button"
                  className="btn-secondary w-full min-[460px]:w-auto"
                  disabled={busy}
                  onClick={() => {
                    if (rejecting) void decide("reject");
                    else {
                      setRejecting(true);
                      setDecisionError("");
                    }
                  }}
                >
                  {rejecting ? "Confirm Rejection" : "Reject"}
                </button>
                {!rejecting && <button
                  type="button"
                  className="btn-primary w-full min-[460px]:w-auto"
                  disabled={busy}
                  onClick={() => decide("approve")}
                >
                  {busy ? "Saving..." : "Approve and Schedule"}
                </button>}
              </footer>
            </section>
          </div>,
          document.body,
        )}
      {details && (
        <AppointmentRequestDetailsModal
          appointment={details}
          onClose={() => setDetails(null)}
        />
      )}
    </section>
  );
}

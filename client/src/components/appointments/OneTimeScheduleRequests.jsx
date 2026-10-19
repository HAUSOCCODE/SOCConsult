import useDialogFocus from "../../hooks/useDialogFocus";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { StatusBadge } from "../UI";
import AppointmentRequestDetailsModal from "./AppointmentRequestDetailsModal";
import { useToast } from "../../context/ToastContext";
import { formatPersonName } from "../../utils/formatPersonName";

const initial = {
  date: "",
  time: "",
  durationMinutes: "",
  mode: "Face-to-Face",
  location: "",
  meetingPlatform: "Google Meet",
  meetingLink: "",
};

export default function OneTimeScheduleRequests({ reviewRequest, onClose, onDecided } = {}) {
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [selected, setSelected] = useState(reviewRequest || null);
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState({ ...initial, durationMinutes: String(reviewRequest?.estimatedDurationMinutes || "") });
  const [rejectNote, setRejectNote] = useState("");
  const [busy, setBusy] = useState(false);
  const reviewButtonRef = useRef(null);
  const reviewDialogRef = useRef(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const closeReview = () => { setSelected(null); onClose?.(); };
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
    setForm({
      ...initial,
      durationMinutes: String(request.estimatedDurationMinutes || ""),
    });
  };
  const decide = async (decision) => {
    if (!selected || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      let body = { note: rejectNote };
      if (decision === "approve") {
        if (!form.date || !form.time)
          throw new Error("Choose a date and start time.");
        const startAt = `${form.date}T${form.time}:00+08:00`;
        body = {
          startAt,
          durationMinutes: Number(form.durationMinutes),
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
      toast.success(data.message);
      closeReview();
      if (reviewRequest) onDecided?.();
      else await load();
    } catch (error) {
      toast.error(error.message || "Unable to decide this request.");
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
                <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
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
                </div>
                <div className="mt-5 border-t border-slate-200 pt-4">
                  <label className="text-sm font-semibold">
                    Rejection reason (optional)
                    <textarea disabled={busy}
                      className="field mt-1 min-h-20 resize-y"
                      maxLength="500"
                      value={rejectNote}
                      onChange={(event) => setRejectNote(event.target.value)}
                    />
                  </label>
                </div>
              </div>
              <footer className="sticky bottom-0 flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-4 py-3 min-[460px]:flex-row min-[460px]:flex-wrap min-[460px]:justify-end sm:px-6 sm:py-4">
                <button
                  type="button"
                  className="btn-secondary w-full min-[460px]:w-auto"
                  disabled={busy}
                  onClick={closeReview}
                >
                  Close
                </button>
                <button
                  type="button"
                  className="btn-secondary w-full min-[460px]:w-auto"
                  disabled={busy}
                  onClick={() => decide("reject")}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="btn-primary w-full min-[460px]:w-auto"
                  disabled={busy}
                  onClick={() => decide("approve")}
                >
                  {busy ? "Saving..." : "Approve and Schedule"}
                </button>
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

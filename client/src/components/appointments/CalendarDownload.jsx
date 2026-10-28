import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";

export const canDownloadCalendar = (a, now = Date.now()) => Boolean(a?._id || a?.id) &&
  a.status === "Confirmed" && a.startAt != null && a.endAt != null &&
  Number.isFinite(+new Date(a.startAt)) && Number.isFinite(+new Date(a.endAt)) &&
  +new Date(a.endAt) > +new Date(a.startAt) && now < +new Date(a.endAt);

export default function CalendarDownload({ appointment }) {
  const pending = useRef(false), controller = useRef(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => () => controller.current?.abort(), []);
  const download = async () => {
    if (pending.current || !canDownloadCalendar(appointment)) return;
    pending.current = true; setBusy(true); setMessage(""); setFailed(false);
    const request = new AbortController(); controller.current = request;
    try {
      const { blob, filename } = await api.download(`/appointments/${appointment._id || appointment.id}/calendar.ics`, { signal: request.signal, cache: "no-store" });
      if (request.signal.aborted) return;
      if (!/^text\/calendar(?:;|$)/i.test(blob.type)) throw new Error();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = /^SOCConsult-Consultation-\d{4}-\d{2}-\d{2}\.ics$/.test(filename) ? filename : "SOCConsult-Consultation.ics";
        document.body.appendChild(anchor); anchor.click();
      } finally {
        anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setMessage("Calendar download started");
    } catch {
      if (!request.signal.aborted) { setFailed(true); setMessage("Unable to download the calendar file. It may have ended or changed. Refresh the details and try again."); }
    } finally {
      pending.current = false;
      if (!request.signal.aborted) setBusy(false);
    }
  };
  if (!canDownloadCalendar(appointment) && !busy && !message) return null;
  return <section className="rounded border p-4" aria-busy={busy}>
    <h3 className="font-bold">Add to Calendar</h3>
    <p className="my-2 text-sm">This file is a one-way snapshot. External calendar changes do not update SOCConsult; calendars are not synchronized. Downloads are available only before the consultation ends.</p>
    <button type="button" className="btn-primary" disabled={busy || !canDownloadCalendar(appointment)} onClick={download}>{busy ? "Downloading..." : "Download .ics"}</button>
    {message && <p className="mt-2" role={failed ? "alert" : "status"}>{message}</p>}
  </section>;
}

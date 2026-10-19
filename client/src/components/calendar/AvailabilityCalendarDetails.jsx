import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import DetailLoadingDialog from "../appointments/DetailLoadingDialog";
import { consultationTime } from "../appointments/PersonalConsultationDetails";

export default function AvailabilityCalendarDetails({ selection, onClose }) {
  const [result, setResult] = useState({ loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult({ loading: true });
    api(`/availability/${selection.id}/calendar-details`, { signal: controller.signal, cache: "no-store" })
      .then(data => { if (!controller.signal.aborted) setResult({ data: data.availability }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ error: true }); });
    return () => controller.abort();
  }, [selection, retry]);
  const slot = result.data;
  return <DetailLoadingDialog title="Availability details" opener={selection.opener} onClose={onClose}>
    {result.loading ? <p>Loading availability details…</p> : result.error ? <><p role="alert">Unable to load this availability. It may no longer be available.</p><button type="button" className="btn-secondary" onClick={() => setRetry(value => value + 1)}>Retry details</button></> : <dl className="space-y-3">
      <div><dt>Status</dt><dd>{slot.status}</dd></div>
      <div><dt>Start (Asia/Manila)</dt><dd>{consultationTime(slot.startAt)}</dd></div>
      <div><dt>End (Asia/Manila)</dt><dd>{consultationTime(slot.endAt)}</dd></div>
      <div><dt>Mode</dt><dd>{slot.mode}</dd></div>
      <div><dt>{slot.mode === "Online" ? "Platform" : "Location"}</dt><dd>{(slot.mode === "Online" ? slot.meetingPlatform : slot.location) || "Not provided"}</dd></div>
    </dl>}
    <button type="button" className="btn-secondary" onClick={onClose}>Close details</button>
  </DetailLoadingDialog>;
}

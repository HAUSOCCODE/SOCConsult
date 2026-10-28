import { FileText, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../api/apiClient";
import { formatPersonName } from "../../utils/formatPersonName";
import { consultationSlotUnavailable, safeStudentError } from "../../utils/studentUiErrors";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
const allowedExtensions = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "pdf", "doc", "docx", "xls",
  "xlsx", "ppt", "pptx", "txt", "csv", "mp4", "webm",
]);
const formatSize = (bytes) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
const time = (value) =>
  new Date(value).toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function ConsultationRequestForm({
  provider,
  slot,
  onCancel,
  onSuccess,
  onSlotUnavailable,
}) {
  const submittingRef = useRef(false);
  const [subject, setSubject] = useState("");
  const [concern, setConcern] = useState("");
  const [documents, setDocuments] = useState([]);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const attach = (fileList) => {
    const incoming = Array.from(fileList || []);
    const combined = [...documents, ...incoming];
    if (combined.length > 5)
      return setError("You can upload up to 5 supporting files.");
    if (incoming.some((file) => file.size > MAX_FILE_SIZE))
      return setError("Each supporting file must be 10 MB or smaller.");
    if (
      incoming.some(
        (file) =>
          !allowedExtensions.has(file.name.split(".").pop()?.toLowerCase()),
      )
    )
      return setError("This file type is not supported.");
    if (combined.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_SIZE)
      return setError("Supporting documents must not exceed 25 MB in total.");
    setError("");
    setDocuments(combined);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const trimmedSubject = subject.trim();
    const trimmedConcern = concern.trim();
    if (!trimmedSubject)
      return setError("Subject or Course is required.");
    if (trimmedSubject.length > 150)
      return setError("Subject or Course must be 150 characters or fewer.");
    if (!trimmedConcern)
      return setError("Consultation Concern is required.");
    if (trimmedConcern.length > 1000)
      return setError("Consultation Concern must be 1,000 characters or fewer.");

    submittingRef.current = true;
    setSubmitting(true);
    setError("");
    try {
      const request = new FormData();
      request.append("availabilityId", slot.availabilityId);
      request.append("subject", trimmedSubject);
      request.append("reason", trimmedConcern);
      documents.forEach((file) => request.append("documents", file));
      const data = await api("/appointments", { method: "POST", body: request });
      await onSuccess(data);
    } catch (requestError) {
      if (consultationSlotUnavailable(requestError)) {
        setError("This consultation slot is no longer available. Please choose another time.");
        onSlotUnavailable?.();
      } else {
        setError(safeStudentError(requestError, "Unable to submit the consultation request. Please review the form and try again."));
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      role="dialog"
      aria-modal="true"
      aria-labelledby="consultation-request-title"
      onMouseDown={(event) => event.stopPropagation()}
      className="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
    >
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id="consultation-request-title" className="text-xl font-bold text-maroon-900">
            Request Consultation
          </h2>
          <p className="mt-1 break-words text-sm text-slate-600">
            Faculty: {formatPersonName(provider) || "Consultation Provider"}
          </p>
        </div>
        <button type="button" aria-label="Close" onClick={onCancel} className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-slate-100">
          <X />
        </button>
      </header>

      <div className="space-y-4 px-4 py-4 sm:px-6">
        <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="break-words font-semibold">
            {new Date(slot.startAt).toLocaleDateString("en-PH", {
              timeZone: "Asia/Manila", weekday: "long", month: "long",
              day: "numeric", year: "numeric",
            })}
          </p>
          <p>{time(slot.startAt)} – {time(slot.endAt)}</p>
          <p className="mt-1 break-words">
            {slot.mode} · {slot.mode === "Online"
              ? slot.meetingPlatform || "Meeting platform not provided"
              : slot.location || "Location not provided"}
          </p>
        </div>

        <>
            <label className="block min-w-0 text-sm font-semibold">
              Subject or Course
              <input className="field mt-2" required maxLength="150" value={subject} onChange={(event) => setSubject(event.target.value)} />
              <span className="mt-1 block text-right text-xs font-normal text-slate-500">{subject.length} / 150</span>
            </label>
            <label className="block min-w-0 text-sm font-semibold">
              Consultation Concern
              <textarea className="field mt-2 min-h-[110px] resize-y" required maxLength="1000" value={concern} onChange={(event) => setConcern(event.target.value)} />
              <span className="mt-1 block text-right text-xs font-normal text-slate-500">{concern.length} / 1000</span>
            </label>
            <label className="block min-w-0 text-sm font-semibold">
              Supporting Documents
              <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">
                Optional · Up to 5 files · 10 MB each · 25 MB total
              </span>
              <input className="field mt-2 w-full min-w-0" type="file" multiple accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.mp4,.webm" onChange={(event) => { attach(event.target.files); event.target.value = ""; }} />
            </label>
            {documents.length > 0 && (
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
                {documents.map((file, index) => (
                  <div key={`${file.name}-${file.lastModified}-${index}`} className="flex min-w-0 items-center gap-2 text-sm">
                    <FileText size={17} className="shrink-0 text-maroon-700" />
                    <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
                    <span className="shrink-0 text-xs text-slate-500">{formatSize(file.size)}</span>
                    <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setDocuments(documents.filter((_, itemIndex) => itemIndex !== index))} className="shrink-0 rounded p-1 text-red-700 hover:bg-red-50"><Trash2 size={16} /></button>
                  </div>
                ))}
              </div>
            )}
        </>
        {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>

      <footer className="flex flex-col-reverse gap-3 border-t border-slate-200 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={submitting}>Cancel</button>
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? "Submitting..." : "Submit Request"}
        </button>
      </footer>
    </form>
  );
}

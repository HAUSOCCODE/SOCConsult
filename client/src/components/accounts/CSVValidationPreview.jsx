import { formatManilaDisplay } from "../../utils/formatDateTime";
import CSVErrorTable from "./CSVErrorTable";
export default function CSVValidationPreview({ preview, busy = false, onConfirm }) {
  const eligible = preview.canConfirm && preview.summary.invalidRows === 0 &&
    preview.status === "validated" && new Date(preview.expiresAt).getTime() > Date.now();
  const roles = new Set(preview.rows.map((row) => row.role));
  const accountType = [...roles].some((role) => !["student", "faculty"].includes(role))
    ? "Review invalid roles"
    : roles.size === 2 ? "Student and Faculty" : roles.has("student") ? "Student" : "Faculty";
  return (
    <section className="mt-6" aria-label="CSV validation preview">
      <p role="status">{eligible ? "CSV preview ready. Review the rows before confirming account creation." : preview.status === "processing" ? "Account creation is processing. Refresh to check the import status before trying again." : "Review the validation errors before uploading a corrected CSV."}</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Total rows", "totalRows"],
          ["Valid rows", "validRows"],
          ["Invalid rows", "invalidRows"],
          ["Duplicate/conflict rows", "duplicateRows"],
        ].map(([label, key]) => (
          <div className="rounded-lg border p-3" key={key}>
            <p>{label}</p>
            <strong>{preview.summary[key]}</strong>
          </div>
        ))}
      </div>
      {roles.size > 0 && <p className="mt-3 text-sm"><strong>Account type</strong> {accountType}</p>}
      <p className="mt-3 text-sm">
        {preview.displayFilename && <span>File: {preview.displayFilename}. </span>}
        Preview expires (Asia/Manila): {formatManilaDisplay(new Date(preview.expiresAt), undefined, "timestamp")}
      </p>
      <CSVErrorTable rows={preview.rows} />
      <button className="btn-primary mt-4" disabled={!eligible || busy || !onConfirm} onClick={onConfirm}>
        {busy || preview.status === "processing" ? "Creating accounts…" : "Confirm Account Creation"}
      </button>
      {!eligible && (
        <p className="mt-4 text-red-700">
          {preview.status === "processing" ? "This import is processing. Its status will be checked automatically." :
            "Correct invalid rows or remove rows for accounts that already exist, then upload the updated CSV."}
        </p>
      )}
      <p className="mt-3 text-sm text-slate-600">
        Validation creates no accounts. Eligibility and conflicts are checked again during confirmation.
      </p>
    </section>
  );
}

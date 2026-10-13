import CSVErrorTable from "./CSVErrorTable";
export default function CSVValidationPreview({ preview, busy = false, onConfirm }) {
  const eligible = preview.canConfirm && preview.summary.invalidRows === 0 &&
    preview.status === "validated" && new Date(preview.expiresAt).getTime() > Date.now();
  return (
    <section className="mt-6" aria-label="CSV validation preview">
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
      <p className="mt-3 text-sm">
        {preview.displayFilename && <span>File: {preview.displayFilename}. </span>}
        Preview expires: {new Date(preview.expiresAt).toLocaleString()}
      </p>
      <CSVErrorTable rows={preview.rows} />
      <button className="btn-primary mt-4" disabled={!eligible || busy || !onConfirm} onClick={onConfirm}>
        {busy || preview.status === "processing" ? "Creating accounts…" : "Confirm Account Creation"}
      </button>
      {!eligible && (
        <p className="mt-4 text-red-700">
          {preview.status === "processing" ? "This import is processing. Its status will be checked automatically." :
            "Correct invalid rows or upload a new CSV before confirmation."}
        </p>
      )}
      <p className="mt-3 text-sm text-slate-600">
        Validation creates no accounts. Eligibility and conflicts are checked again during confirmation.
      </p>
    </section>
  );
}

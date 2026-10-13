import CSVErrorTable from "./CSVErrorTable";
export default function CSVValidationPreview({ preview }) {
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
        Preview expires: {new Date(preview.expiresAt).toLocaleString()}
      </p>
      <CSVErrorTable rows={preview.rows} />
      {preview.canConfirm && preview.summary.invalidRows === 0 ? (
        <button className="btn-secondary mt-4" disabled>
          Confirm Account Creation — available in DEA-07
        </button>
      ) : (
        <p className="mt-4 text-red-700">
          Correct all invalid rows and upload again before confirmation.
        </p>
      )}
      <p className="mt-3 text-sm text-slate-600">
        Validation creates no accounts. Eligibility will be checked again when
        account creation becomes available.
      </p>
    </section>
  );
}

export default function CSVUploadPanel({ busy, onSelect, onSubmit, file }) {
  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-3">
      <label className="block text-sm font-semibold" htmlFor="csv-file">
        Select CSV file
      </label>
      <input
        id="csv-file"
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        onChange={(event) => onSelect(event.target.files?.[0] || null)}
      />
      <p className="text-sm text-slate-600">
        Default limits: 1 MiB, 200 accounts per batch, 16 KiB per record. Validation
        previews expire after 30 minutes.
      </p>
      <button className="btn-primary block" disabled={busy || !file}>
        {busy ? "Validating…" : "Upload and validate"}
      </button>
    </form>
  );
}

export default function CSVUploadPanel({ busy, onSelect, onSubmit, file, error }) {
  return (
    <form aria-describedby={error ? "csv-upload-error" : undefined} onSubmit={onSubmit} className="mt-5 space-y-3">
      <label className="block text-sm font-semibold" htmlFor="csv-file">
        Select CSV file
      </label>
      <input
        id="csv-file"
        aria-describedby={error ? "csv-upload-error" : undefined}
        type="file"
        accept=".csv,text/csv"
        disabled={busy}
        onChange={(event) => onSelect(event.target.files?.[0] || null)}
      />
      <p className="text-sm text-slate-600">
        CSV only · 1 MiB max · 200 accounts per batch. Previews expire after 30 minutes.
      </p>
      <button className="btn-primary block" disabled={busy || !file}>
        {busy ? "Validating…" : "Upload and validate"}
      </button>
    </form>
  );
}

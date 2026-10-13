import { Link } from "react-router-dom";

export default function CSVImportResult({ result, onNewImport }) {
  return (
    <section className="mt-6 rounded-lg border p-4" aria-label="CSV import result">
      <h3 className="text-lg font-bold">Import result</h3>
      <p role="status" className="mt-2">{result.message}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3">
        {[
          ["Import ID", result.importId], ["Status", result.status],
          ["Total rows", result.totalRows], ["Successful rows", result.successfulRows],
          ["Failed rows", result.failedRows], ["Students", result.studentCount],
          ["Faculty", result.facultyCount],
          ["Import timestamp", result.importedAt ? new Date(result.importedAt).toLocaleString() : "Not completed"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0"><dt className="text-sm text-slate-600">{label}</dt><dd className="break-words font-semibold">{value}</dd></div>
        ))}
      </dl>
      <div className="mt-5 flex flex-wrap gap-3">
        <Link className="btn-primary" to="/dean/users">Go to User Management</Link>
        <button className="btn-secondary" onClick={onNewImport}>Start New Import</button>
      </div>
    </section>
  );
}

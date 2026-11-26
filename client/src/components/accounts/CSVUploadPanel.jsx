import { useEffect, useRef } from "react";

const accountFields = [
  ["institutional_id", "Institutional ID", true],
  ["first_name", "First name", true],
  ["middle_name", "Middle name", false],
  ["last_name", "Last name", true],
  ["official_email", "Official email", true],
  ["role", "Role", false],
];

export default function CSVUploadPanel({ busy, onSelect, onSubmit, file, error, mapping, onMappingChange }) {
  const input = useRef(null);
  const mappingFields = useRef(null);
  const sourceHeaders = mapping?.headers;
  useEffect(() => {
    if (!file && input.current) input.current.value = "";
  }, [file]);
  useEffect(() => {
    if (sourceHeaders) mappingFields.current?.querySelector("select")?.focus();
  }, [sourceHeaders]);
  return (
    <form aria-describedby={error ? "csv-upload-error" : undefined} onSubmit={onSubmit} className="mt-5 space-y-3">
      <label className="block text-sm font-semibold" htmlFor="csv-file">
        Select CSV file
      </label>
      <input
        id="csv-file"
        ref={input}
        aria-describedby={error ? "csv-upload-error" : undefined}
        type="file"
        accept=".csv,text/csv"
        className="max-w-full"
        disabled={busy}
        onChange={(event) => onSelect(event.target.files?.[0] || null)}
      />
      <p className="text-sm text-slate-600">
        CSV only · 1 MiB max · 200 accounts per batch. Previews expire after 30 minutes.
      </p>
      {mapping && (
        <fieldset ref={mappingFields} className="min-w-0 space-y-3 rounded-lg border border-slate-200 p-4" disabled={busy}>
          <legend className="px-1 text-sm font-semibold">Map columns</legend>
          <p role="status" className="text-sm text-slate-600">
            Match each account field to a column from your file. Unselected columns are ignored.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {accountFields.map(([field, label, required]) => (
              <label key={field} className="min-w-0 text-sm font-semibold">
                {label}{field === "middle_name" && " (optional)"}
                <select className="field mt-1 w-full" required={required}
                  value={mapping.columns[field] ?? ""}
                  onChange={(event) => onMappingChange(field, event.target.value)}
                >
                  <option value="">{field === "role" ? "Use batch account type" : required ? "Choose a source column" : "Leave blank"}</option>
                  {mapping.headers.map((header, index) => (
                    <option key={index} value={index}
                      disabled={mapping.columns[field] !== index && Object.values(mapping.columns).includes(index)}
                    >{header}</option>
                  ))}
                </select>
              </label>
            ))}
            {mapping.columns.role === undefined && (
              <label className="min-w-0 text-sm font-semibold">
                Batch account type
                <select className="field mt-1 w-full" required value={mapping.batchRole}
                  onChange={(event) => onMappingChange("batchRole", event.target.value)}
                >
                  <option value="">Choose an account type</option>
                  <option value="student">Student accounts</option>
                  <option value="faculty">Faculty accounts</option>
                </select>
              </label>
            )}
          </div>
        </fieldset>
      )}
      <button className="btn-primary block" disabled={busy || !file}>
        {mapping ? "Validate mapped CSV" : "Upload and validate"}
      </button>
    </form>
  );
}

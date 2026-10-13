import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/apiClient";
import CSVUploadPanel from "../../components/accounts/CSVUploadPanel";
import CSVValidationPreview from "../../components/accounts/CSVValidationPreview";

export default function CsvImport() {
  const [search, setSearch] = useSearchParams();
  const previewId = search.get("preview");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!previewId) return;
    const controller = new AbortController();
    setPreview(null);
    setBusy(true);
    setError("");
    api(`/dean/account-imports/${encodeURIComponent(previewId)}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) setPreview(value);
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [previewId]);
  useEffect(() => {
    if (!preview) return;
    const timeout = setTimeout(
      () => {
        setPreview(null);
        setError("Preview has expired. Upload your CSV again.");
      },
      Math.max(0, new Date(preview.expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [preview]);
  const selectFile = (value) => {
    setFile(value);
    setPreview(null);
    setError("");
    setSearch({}, { replace: true });
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setPreview(null);
    setError("");
    const body = new FormData();
    body.append("file", file);
    try {
      const result = await api("/dean/account-imports/validate", {
        method: "POST",
        body,
      });
      setPreview(result);
      setSearch({ preview: result.previewId }, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const columns = [
    [
      "institutional_id",
      "Required",
      "Institutional account ID. Keep as text, including leading zeros.",
    ],
    ["first_name", "Required", "First name."],
    ["middle_name", "Optional value", "Middle name. An empty value is valid."],
    ["last_name", "Required", "Last name."],
    [
      "official_email",
      "Required",
      "Official email address; normalized to lowercase.",
    ],
    [
      "role",
      "Required",
      "student or faculty only; normalized to lowercase. Dean is not allowed.",
    ],
  ];

  return (
    <section className="rounded-2xl border bg-white p-4 sm:p-6">
      <h2 className="text-xl font-bold text-maroon-900">CSV Import</h2>
      <p className="mt-3 text-sm text-slate-600">
        Download the project-defined sample template for development and
        testing. Upload a CSV to validate and review every row before account
        creation becomes available in DEA-07.
      </p>
      <a
        className="btn-primary mt-5 inline-flex"
        href="/templates/socconsult-account-import-template.csv"
        download="socconsult-account-import-template.csv"
      >
        Download CSV template
      </a>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="mb-3 text-left text-slate-600">
            Include the five required columns; middle_name is optional. The
            template includes all six. Trim surrounding whitespace; required
            values must not be empty or contain only whitespace.
          </caption>
          <thead>
            <tr>
              <th className="p-2">Column</th>
              <th className="p-2">Requirement</th>
              <th className="p-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {columns.map(([column, requirement, description]) => (
              <tr key={column} className="border-t">
                <td className="p-2 font-mono">{column}</td>
                <td className="p-2">{requirement}</td>
                <td className="p-2">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CSVUploadPanel
        busy={busy}
        onSelect={selectFile}
        onSubmit={submit}
        file={file}
      />
      {error && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
      {preview && <CSVValidationPreview preview={preview} />}
      <Link className="btn-secondary mt-5 inline-flex" to="/dean/dashboard">
        Back to Dean Management
      </Link>
    </section>
  );
}

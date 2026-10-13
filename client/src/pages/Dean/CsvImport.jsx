import { Link } from "react-router-dom";
import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/apiClient";
import CSVUploadPanel from "../../components/accounts/CSVUploadPanel";
import CSVValidationPreview from "../../components/accounts/CSVValidationPreview";
import CSVImportResult from "../../components/accounts/CSVImportResult";
import ConfirmDialog from "../../components/ConfirmDialog";

export default function CsvImport() {
  const [search, setSearch] = useSearchParams();
  const previewId = search.get("preview");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const inFlight = useRef(false);
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
    if (!preview?.expiresAt || preview.status === "processing" || confirming) return;
    const timeout = setTimeout(
      () => {
        setPreview(null);
        setDialogOpen(false);
        setError("Preview has expired. Upload your CSV again.");
      },
      Math.max(0, new Date(preview.expiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [preview, confirming]);
  useEffect(() => {
    if (preview?.status !== "processing" || !previewId || confirming) return;
    const controller = new AbortController();
    let timeout;
    const check = async () => {
      try {
        const value = await api(`/dean/account-imports/${encodeURIComponent(previewId)}`, { signal: controller.signal });
        if (!controller.signal.aborted) { setPreview(value); setError(""); }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err.message);
          if (err.status === 404) setPreview(null);
        }
      } finally {
        if (!controller.signal.aborted) timeout = setTimeout(check, 3000);
      }
    };
    timeout = setTimeout(check, 3000);
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [preview, previewId, confirming]);
  const selectFile = (value) => {
    setFile(value);
    setPreview(null);
    setError("");
    setSearch({}, { replace: true });
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!file || busy || inFlight.current) return;
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
  const confirm = async () => {
    if (inFlight.current || busy || !preview?.canConfirm || preview.status !== "validated" ||
      preview.summary.invalidRows !== 0 || new Date(preview.expiresAt).getTime() <= Date.now()) return;
    inFlight.current = true;
    setConfirming(true);
    setError("");
    try {
      const result = await api(`/dean/account-imports/${encodeURIComponent(preview.previewId)}/confirm`, { method: "POST" });
      setPreview(result);
    } catch (err) {
      setError(err.message);
      if (err.data?.preview) setPreview(err.data.preview);
      // The server may have committed even when the response was lost. GET never creates accounts.
      try {
        const recovered = await api(`/dean/account-imports/${encodeURIComponent(preview.previewId)}`);
        setPreview(recovered);
        if (recovered.status === "completed") setError("");
      } catch (recoveryError) {
        if (recoveryError.status === 404) setPreview(null);
        else setError("Unable to check the import status. Refresh this page before trying again.");
      }
    } finally {
      setDialogOpen(false);
      setConfirming(false);
      inFlight.current = false;
    }
  };
  const studentCount = preview?.rows?.filter((row) => row.role === "student").length || 0;
  const facultyCount = preview?.rows?.filter((row) => row.role === "faculty").length || 0;
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
        testing. Upload a CSV of up to 200 accounts, review every row, then confirm
        account creation. Use multiple batches for larger populations.
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
        busy={busy || confirming || preview?.status === "processing"}
        onSelect={selectFile}
        onSubmit={submit}
        file={file}
      />
      {error && (
        <p role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
      {preview && (["completed", "failed"].includes(preview.status) ?
        <CSVImportResult result={preview} onNewImport={() => selectFile(null)} /> :
        <CSVValidationPreview preview={preview} busy={busy || confirming} onConfirm={() => setDialogOpen(true)} />)}
      {preview?.status === "processing" && !confirming && (
        <button className="btn-secondary mt-4" onClick={() => selectFile(null)}>Start New Import</button>
      )}
      <ConfirmDialog
        open={dialogOpen}
        title="Confirm Account Creation"
        message={`Create ${preview?.summary?.totalRows || 0} accounts: ${studentCount} Students and ${facultyCount} Faculty?`}
        supportingText="Official email is the login. Each user's institutional ID is their initial password. Passwords will not appear in results. Users may change their password later."
        confirmLabel="Create accounts"
        loadingLabel="Creating accounts…"
        variant="primary"
        loading={confirming}
        onConfirm={confirm}
        onCancel={() => setDialogOpen(false)}
      />
      <Link className="btn-secondary mt-5 inline-flex" to="/dean/dashboard">
        Back to Dean Management
      </Link>
    </section>
  );
}

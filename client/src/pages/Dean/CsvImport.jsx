import ResponsiveTable from "../../components/ResponsiveTable";
import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useState, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../../api/apiClient";
import CSVUploadPanel from "../../components/accounts/CSVUploadPanel";
import CSVValidationPreview from "../../components/accounts/CSVValidationPreview";
import CSVImportResult from "../../components/accounts/CSVImportResult";
import ConfirmDialog from "../../components/ConfirmDialog";

export default function CsvImport({ onImported } = {}) {
  const [search, setSearch] = useSearchParams();
  const previewId = search.get("preview");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [checkRequired, setCheckRequired] = useState(false);
  const [previewRetry, setPreviewRetry] = useState(0);
  const [mapping, setMapping] = useState(null);
  const currentPreview = useRef(previewId);
  currentPreview.current = previewId;
  const inFlight = useRef(false);
  const validationFlight = useRef(false);
  const uploadRequest = useRef(0);
  const mounted = useRef(true);
  const reportedImport = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++uploadRequest.current; }; }, []);
  useEffect(() => {
    if (preview?.status !== "completed" || reportedImport.current === preview.previewId) return;
    reportedImport.current = preview.previewId;
    onImported?.();
  }, [preview, onImported]);
  useEffect(() => {
    ++uploadRequest.current;
    if (!previewId) { setBusy(false); return; }
    const controller = new AbortController();
    setPreview(null);
    setMapping(null);
    setBusy(true);
    setError("");
    api(`/dean/account-imports/${encodeURIComponent(previewId)}`, {
      signal: controller.signal,
    })
      .then((value) => {
        if (!controller.signal.aborted) { setPreview(value); setCheckRequired(false); }
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(deanUiError(err, "csv"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [previewId, previewRetry]);
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
          setError(deanUiError(err, "csv"));
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
    if (inFlight.current || validationFlight.current) return;
    ++uploadRequest.current;
    reportedImport.current = null;
    setCheckRequired(false);
    setBusy(false);
    setFile(value);
    setMapping(null);
    setPreview(null);
    setError("");
    setSearch((current) => {
      const next = new URLSearchParams(current);
      next.delete("preview");
      return next;
    }, { replace: true });
  };
  const changeMapping = (field, value) => {
    setError("");
    setMapping((current) => {
      if (field === "batchRole") return { ...current, batchRole: value };
      const columns = { ...current.columns };
      if (value === "") delete columns[field];
      else columns[field] = Number(value);
      return { ...current, columns, batchRole: field === "role" ? "" : current.batchRole };
    });
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!file || busy || inFlight.current || validationFlight.current) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("Select a supported CSV file."); return; }
    if (!file.size) { setError("CSV file is empty."); return; }
    if (file.size > 1024 * 1024) { setError("CSV file must be 1 MiB or smaller."); return; }
    validationFlight.current = true;
    const request = ++uploadRequest.current;
    setBusy(true);
    setPreview(null);
    setError("");
    const body = new FormData();
    body.append("file", file);
    if (mapping) {
      body.append("mapping", JSON.stringify({
        columns: Object.entries(mapping.columns),
        ...(mapping.batchRole && { batchRole: mapping.batchRole }),
      }));
    }
    try {
      const result = await api("/dean/account-imports/validate", {
        method: "POST",
        body,
      });
      if (request !== uploadRequest.current) return;
      if (result.mappingRequired) {
        setMapping({ headers: result.headers, columns: result.suggestedColumns, batchRole: "" });
        return;
      }
      setMapping(null);
      setFile(null);
      setPreview(result);
      setSearch((current) => {
        const next = new URLSearchParams(current);
        next.set("preview", result.previewId);
        return next;
      }, { replace: true });
    } catch (err) {
      if (request === uploadRequest.current) setError(deanUiError(err, "csv"));
    } finally {
      validationFlight.current = false;
      if (request === uploadRequest.current) setBusy(false);
    }
  };
  const confirm = async () => {
    if (checkRequired || inFlight.current || busy || !preview?.canConfirm || preview.status !== "validated" ||
      preview.summary.invalidRows !== 0 || new Date(preview.expiresAt).getTime() <= Date.now()) return;
    inFlight.current = true;
    setConfirming(true);
    setError("");
    try {
      const result = await api(`/dean/account-imports/${encodeURIComponent(preview.previewId)}/confirm`, { method: "POST" });
      if (mounted.current && currentPreview.current === previewId) setPreview(result);
    } catch (err) {
      if (!mounted.current || currentPreview.current !== previewId) return;
      setCheckRequired(true);
      setError(deanUiError(err, "import"));
      if (err.data?.preview) setPreview(err.data.preview);
      // The server may have committed even when the response was lost. GET never creates accounts.
      try {
        const recovered = await api(`/dean/account-imports/${encodeURIComponent(preview.previewId)}`);
        if (!mounted.current) return;
        setPreview(recovered);
        if (recovered.status === "completed") { setError(""); setCheckRequired(false); }
        else if (recovered.status === "processing" || recovered.status === "validated") setError("Import could not be confirmed. Refresh to check its status before trying again.");
      } catch (recoveryError) {
        if (!mounted.current) return;
        if (recoveryError.status === 404) { setPreview(null); setError("This preview is missing or expired. Refresh to check import status before uploading again."); }
        else setError("Unable to check the import status. Refresh this page before trying again.");
      }
    } finally {
      if (mounted.current) { setDialogOpen(false); setConfirming(false); }
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
      "Column or batch selection",
      "student or faculty only. If there is no mapped role column, choose Student or Faculty for the batch.",
    ],
  ];

  return (
    <section id="csv-import" aria-labelledby="csv-import-title" className="min-w-0 border-t border-slate-200 pt-6">
      <h3 id="csv-import-title" className="text-lg font-semibold text-maroon-900">Import from CSV</h3>
      <p className="mt-1 text-sm text-slate-600">Upload up to 200 accounts per batch. Review validation results before creating accounts.</p>
      <a
        className="mt-3 inline-flex text-sm font-semibold text-maroon-800 underline underline-offset-2 hover:text-maroon-900"
        href="/templates/socconsult-account-import-template.csv"
        download="socconsult-account-import-template.csv"
      >
        Download CSV template
      </a>
      <details className="mt-3 text-sm text-slate-700">
        <summary className="w-fit cursor-pointer font-medium text-maroon-800">CSV format requirements</summary>
      <ResponsiveTable label="CSV column requirements" className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="mb-3 text-left text-slate-600">
            Give each source column a unique header. The template includes all six account fields.
            For other exports, map the columns with the required information. If the source needs
            corrections, edit it in Excel or use the template. Format institutional IDs as text to keep leading zeros.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="p-2">Column</th>
              <th scope="col" className="p-2">Requirement</th>
              <th scope="col" className="p-2">Description</th>
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
        </table></ResponsiveTable>
      </details>
      <CSVUploadPanel error={error}
        busy={busy || confirming || preview?.status === "processing"}
        onSelect={selectFile}
        onSubmit={submit}
        file={file}
        mapping={mapping}
        onMappingChange={changeMapping}
      />
      {busy && <p role="status">Loading or validating CSV preview…</p>}
      {confirming && <p role="status">Creating accounts…</p>}
      {!file && !preview && !busy && <p role="status" className="mt-3">No CSV file selected.</p>}
      {error && previewId && !confirming && <button type="button" className="btn-secondary mt-4" disabled={busy} onClick={() => { if (!inFlight.current && !validationFlight.current) setPreviewRetry(n => n + 1); }}>Refresh import status</button>}
      {error && (
        <p id="csv-upload-error" role="alert" className="mt-4 text-red-700">
          {error}
        </p>
      )}
      {preview && (["completed", "failed"].includes(preview.status) ?
        <CSVImportResult result={preview} onNewImport={() => selectFile(null)} /> :
        <CSVValidationPreview preview={preview} busy={busy || confirming || checkRequired} onConfirm={() => setDialogOpen(true)} />)}
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
        onCancel={() => { if (!inFlight.current) setDialogOpen(false); }}
      />
    </section>
  );
}

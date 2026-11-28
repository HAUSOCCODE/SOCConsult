import { startTransition, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { deanUiError, isAbortError } from "../../utils/deanUiErrors";
import { formatPersonName } from "../../utils/formatPersonName";

const endpoint = "/dean/privilege-transfer";
const feedback = code => deanUiError({ code }, "transfer");

export default function DeanPrivilegeTransfer() {
  const { user, clearSession } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState(null);
  const [directory, setDirectory] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [selection, setSelection] = useState(null);
  const [preview, setPreview] = useState(null);
  const [disposition, setDisposition] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ role: "faculty", search: query.search, page: query.page, limit: 8 });
    api(`/dean/users?${params}`, { signal: controller.signal }).then(data => {
      if (!Array.isArray(data.users) || !data.pagination) throw new Error("Invalid Faculty directory response");
      if (!controller.signal.aborted) setDirectory(data);
    }).catch(error => {
      if (!isAbortError(error) && !controller.signal.aborted) setLookupError(deanUiError(error, "transfer"));
    });
    return () => controller.abort();
  }, [query]);

  useEffect(() => {
    if (!selection) return;
    const controller = new AbortController();
    api(`${endpoint}/successors/${selection.id}`, { signal: controller.signal }).then(data => {
      if (data.successor?._id !== selection.id) throw new Error("Invalid Faculty preview response");
      if (!controller.signal.aborted) setPreview(data);
    }).catch(error => {
      if (!isAbortError(error) && !controller.signal.aborted) setErrorMessage(deanUiError(error, "transfer"));
    });
    return () => controller.abort();
  }, [selection]);

  const findFaculty = (term, page) => {
    setLookupError("");
    setDirectory(null);
    setQuery({ search: term, page });
  };

  const selectFaculty = id => {
    setSelection({ id });
    setPreview(null);
    setDisposition("");
    setErrorMessage("");
    setCurrentPassword("");
    setConfirmation("");
  };

  const successor = preview?.successor?._id === selection?.id ? preview?.successor : null;
  const ready = successor && !preview.successorIssue && disposition &&
    (disposition === "Inactive" || preview.canRemainFaculty) && currentPassword && confirmation === "TRANSFER";
  const submit = async event => {
    event.preventDefault();
    if (pending.current || uncertain || !ready) return;
    pending.current = true;
    setSubmitting(true);
    setErrorMessage("");
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ successorId: successor._id, successorVersion: successor.version,
          outgoingVersion: preview.outgoingVersion, disposition, currentPassword, confirmation }),
      });
      if (result.code !== "TRANSFER_COMPLETED") throw new Error("Unconfirmed transfer");
      toast.success("Dean privileges transferred. The incoming Dean can now sign in with their own credentials.", { duration: 8000 });
      startTransition(() => {
        clearSession();
        navigate(disposition === "Active" ? "/faculty/login" : "/dean/login", { replace: true });
      });
    } catch (error) {
      const unconfirmed = !error.status || error.code === "TRANSFER_UNCERTAIN" ||
        (error.status >= 500 && error.code !== "TRANSFER_UNAVAILABLE");
      setUncertain(unconfirmed);
      if (error.code === "TRANSFER_CONFLICT" || error.code?.startsWith("SUCCESSOR_")) setPreview(null);
      setErrorMessage(unconfirmed ? feedback("TRANSFER_UNCERTAIN") : deanUiError(error, "transfer"));
    } finally {
      pending.current = false;
      setCurrentPassword("");
      setConfirmation("");
      setSubmitting(false);
    }
  };

  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="dean-transfer-title">
      <div>
        <h2 id="dean-transfer-title" className="text-lg font-bold text-maroon-900">Dean Privilege Transfer</h2>
        <p className="mt-1 text-sm text-slate-700">Permanently move Dean management privileges to an existing Faculty account, subject to a future authorized transfer.</p>
      </div>
      <form className="flex flex-wrap items-end gap-2" role="search" onSubmit={event => { event.preventDefault(); findFaculty(search.trim(), 1); }}>
        <label className="min-w-0 flex-1 basis-56 text-sm font-semibold text-slate-700">
          Find a Faculty successor
          <input className="field mt-1.5" type="search" maxLength={200} value={search} disabled={submitting || uncertain}
            placeholder="Name, official email, or institutional ID" onChange={event => setSearch(event.target.value)} />
        </label>
        <button className="btn-secondary text-sm" disabled={submitting || uncertain}>Search Faculty</button>
      </form>
      <p className="text-sm text-slate-600">Create a new Faculty account in <Link className="underline" to="/dean/users">Account Management</Link> if the person needs one.</p>
      {lookupError && <p role="alert" className="text-sm text-red-700">{lookupError}</p>}
      {query && !directory && !lookupError && <p role="status" className="text-sm">Loading Faculty accounts…</p>}
      {directory && <div className="space-y-2">
        {directory.users.length === 0 && <p role="status" className="text-sm">No Faculty accounts match your search.</p>}
        <ul className="space-y-2">
          {directory.users.map(account => (
            <li key={account._id}>
              <button type="button" aria-pressed={selection?.id === account._id} disabled={submitting || uncertain}
                className="w-full rounded-lg border border-slate-300 p-3 text-left text-sm hover:bg-slate-50 focus-visible:outline-maroon-700 aria-pressed:border-maroon-700 aria-pressed:bg-maroon-50"
                onClick={() => selectFaculty(account._id)}>
                <span className="block break-words font-semibold">{account.name}</span>
                <span className="block break-words text-slate-700">{[account.email, account.institutionalId, "Faculty", account.accountStatus].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
        {directory.pagination.totalPages > 1 && <div className="flex flex-wrap items-center gap-2 text-sm">
          <button type="button" className="btn-secondary" disabled={submitting || uncertain || directory.pagination.page <= 1}
            onClick={() => findFaculty(query.search, directory.pagination.page - 1)}>Previous</button>
          <span>Page {directory.pagination.page} of {directory.pagination.totalPages}</span>
          <button type="button" className="btn-secondary" disabled={submitting || uncertain || directory.pagination.page >= directory.pagination.totalPages}
            onClick={() => findFaculty(query.search, directory.pagination.page + 1)}>Next</button>
        </div>}
      </div>}
      {selection && !preview && !errorMessage && <p role="status" className="text-sm">Checking successor eligibility…</p>}
      {successor && <div className="rounded-lg border border-slate-200 p-3 text-sm">
        <p className="break-words font-semibold">{successor.name}</p>
        <p className="break-words text-slate-700">{[successor.email, successor.institutionalId, "Faculty", successor.accountStatus].filter(Boolean).join(" · ")}</p>
        <p role="status" className="mt-1 text-slate-700">{preview.successorIssue ? feedback(preview.successorIssue) : "Eligible for transfer"}</p>
      </div>}
      {successor && !preview.successorIssue && <form className="space-y-4" aria-label="Confirm Dean privilege transfer" aria-busy={submitting} onSubmit={submit}>
        <fieldset disabled={submitting || uncertain} className="space-y-2 text-sm">
          <legend className="mb-2 font-semibold text-slate-700">What should happen to your account?</legend>
          <label className="flex items-start gap-2"><input className="mt-1" type="radio" name="dean-disposition" value="Active" required
            disabled={!preview.canRemainFaculty} checked={disposition === "Active"} onChange={event => setDisposition(event.target.value)} />Continue as Faculty</label>
          {!preview.canRemainFaculty && <p className="text-slate-600">{feedback("OUTGOING_FACULTY_INELIGIBLE")}</p>}
          <label className="flex items-start gap-2"><input className="mt-1" type="radio" name="dean-disposition" value="Inactive" required
            checked={disposition === "Inactive"} onChange={event => setDisposition(event.target.value)} />Deactivate my former account</label>
        </fieldset>
        {disposition && <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-800">
          <p className="break-words"><strong>{formatPersonName(user)}</strong> becomes {disposition === "Active" ? "active Faculty and signs in through Faculty login" : "inactive Faculty and loses sign-in access"}.</p>
          <p className="break-words"><strong>{successor.name}</strong> gains Dean management access and signs in through Dean login with their own password.</p>
          <p>Both accounts are signed out. Consultations, academic records, documents, and audit history stay with their original owners.</p>
          {disposition === "Inactive" && <p>Resolve open consultations or attendance before deactivating.</p>}
        </div>}
        <fieldset disabled={submitting || uncertain} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-semibold text-slate-700">Current password
            <input className="field mt-1.5" type="password" name="currentPassword" autoComplete="current-password" required
              maxLength={1024} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
          </label>
          <label className="min-w-0 text-sm font-semibold text-slate-700">Type TRANSFER to confirm
            <input className="field mt-1.5" autoComplete="off" required maxLength={8}
              value={confirmation} onChange={event => setConfirmation(event.target.value)} />
          </label>
        </fieldset>
        <div className="flex justify-end">
          <button type="submit" className="btn-primary w-full text-sm sm:w-auto" disabled={!ready || submitting || uncertain}>
            {submitting ? "Transferring privileges…" : "Transfer Dean privileges"}
          </button>
        </div>
      </form>}
      {errorMessage && <p role="alert" className="text-sm text-red-700">{errorMessage}</p>}
    </section>
  );
}

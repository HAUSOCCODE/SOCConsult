import { Link, useSearchParams } from "react-router-dom";
import { X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import {
  EmptyState,
  ErrorState,
  Loading,
  StatusBadge,
} from "../../components/UI";
import { useToast } from "../../context/ToastContext";
import Pagination from "../../components/Pagination";
import ConfirmDialog from "../../components/ConfirmDialog";
import ManualAccountForm from "../../components/accounts/ManualAccountForm";

const LIMIT = 20;
const sourceLabel = (source) =>
  source === "csv"
    ? "CSV-created"
    : source === "manual"
      ? "Manually created"
      : "Legacy";
const dateLabel = (value) =>
  value && Number.isFinite(new Date(value).getTime())
    ? new Date(value).toLocaleDateString("en-PH", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "Not recorded";

export default function UserManagement() {
  const toast = useToast();
  const [params] = useSearchParams();
  const linkedUserId = params.getAll("userId").length === 1 && /^[a-f\d]{24}$/i.test(params.get("userId") || "") ? params.get("userId") : null;
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0 });
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    role: "all",
    status: "all",
    source: "all",
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [target, setTarget] = useState(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const inFlight = useRef(false);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);
  const searchId = useId();

  const load = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({
        ...filters,
        page: String(page),
        limit: String(LIMIT),
      });
      const data = await api(`/dean/users?${query}`);
      if (request !== listRequest.current) return;
      setUsers(data.users);
      setPagination(data.pagination);
      if (data.pagination.page !== page) setPage(data.pagination.page);
    } catch {
      if (request === listRequest.current)
        setError("Unable to load users. Please try again.");
    } finally {
      if (request === listRequest.current) setLoading(false);
    }
  }, [filters, page]);
  const latestLoad = useRef(load);
  latestLoad.current = load;
  useEffect(() => {
    void load();
    return () => {
      ++listRequest.current;
    };
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const normalized = search.normalize("NFC").trim().replace(/\s+/g, " ");
      if (normalized === filters.search) return;
      ++listRequest.current;
      setFilters((current) => ({ ...current, search: normalized }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, filters.search]);
  useEffect(
    () => () => {
      ++detailRequest.current;
    },
    [],
  );
  const changeFilter = (key, value) => {
    ++listRequest.current;
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };
  const view = async (user) => {
    const request = ++detailRequest.current;
    setSelected(user);
    setDetailLoading(true);
    try {
      const data = await api(`/dean/users/${user._id}`);
      if (request === detailRequest.current) setSelected(data.user);
    } catch {
      if (request === detailRequest.current) {
        toast.error("Unable to load user details. Please try again.");
        setSelected(null);
      }
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  };
  useEffect(() => {
    if (linkedUserId) void view({ _id: linkedUserId });
    return () => { ++detailRequest.current; };
  }, [linkedUserId]);
  const confirmStatus = async () => {
    if (inFlight.current || !target) return;
    const accountStatus =
      target.accountStatus === "Active" ? "Inactive" : "Active";
    if (accountStatus === "Inactive" && !reason.trim()) {
      toast.error("A deactivation reason is required.");
      return;
    }
    inFlight.current = true;
    setBusy(true);
    try {
      const data = await api(`/dean/users/${target._id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          accountStatus,
          expectedStatus: target.accountStatus,
          version: target.version,
          ...(accountStatus === "Inactive" && { reason: reason.trim() }),
        }),
      });
      setTarget(null);
      setReason("");
      setSelected(null);
      ++detailRequest.current;
      toast.success(data.message);
      await latestLoad.current();
    } catch (requestError) {
      const messages = {
        STATUS_CONFLICT:
          "This account has changed. Refresh the user list before trying again.",
        REGISTRATION_CONFLICT:
          "This account cannot be activated because its legacy access state is incompatible with sign-in.",
        STATUS_CHANGE_UNCERTAIN:
          "Unable to confirm the status change. Refresh the user list before trying again.",
      };
      toast.error(
        messages[requestError.code] ||
          "Unable to update the account. Check the reason and try again.",
      );
      if (
        requestError.status === 409 ||
        requestError.code === "STATUS_CHANGE_UNCERTAIN" ||
        requestError.status === 404
      ) {
        setTarget(null);
        setReason("");
        setSelected(null);
        ++detailRequest.current;
        await latestLoad.current();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const confirmReset = async () => {
    if (inFlight.current || !resetTarget) return;
    inFlight.current = true;
    setBusy(true);
    try {
      await api(`/dean/users/${resetTarget._id}/reset-password`, {
        method: "POST", headers: { "If-Match": JSON.stringify(resetTarget.version ?? "null") },
      });
      toast.success("Password reset successfully.");
    } catch (error) {
      const messages = {
        PASSWORD_RESET_CONFLICT: "This account has changed. Refresh the user list before trying again.",
        PASSWORD_RESET_INELIGIBLE: "This account is not eligible for password reset.",
        INVALID_INSTITUTIONAL_ID: "This account does not have a valid institutional ID.",
        PASSWORD_RESET_UNCERTAIN: "Unable to confirm the password reset. Refresh the user list before trying again.",
      };
      toast.error(messages[error.code] || "Unable to reset the password. Refresh the user list before trying again.");
    } finally {
      setResetTarget(null);
      setSelected(null);
      ++detailRequest.current;
      await latestLoad.current();
      inFlight.current = false;
      setBusy(false);
    }
  };
  const requestStatus = (user) => {
    setReason("");
    setTarget(user);
  };
  const actions = (user) => (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="btn-action-sm"
        disabled={busy}
        onClick={() => void view(user)}
      >
        View Details
      </button>
      {["student", "faculty"].includes(user.role) && ["Active", "Inactive"].includes(user.accountStatus) && (
        <button type="button" className="btn-action-sm" disabled={busy}
          onClick={() => { if (!inFlight.current) setResetTarget(user); }}>
          Reset Password
        </button>
      )}
      {["Active", "Inactive"].includes(user.accountStatus) && (
        <button
          type="button"
          className="btn-action-sm"
          disabled={busy}
          onClick={() => requestStatus(user)}
        >
          {user.accountStatus === "Active" ? "Deactivate" : "Activate"}
        </button>
      )}
    </div>
  );

  return (
    <div className="w-full min-w-0 space-y-5 pb-16">
      <div>
        <h1 className="text-2xl font-bold text-maroon-900">User Accounts</h1>
        <details className="text-sm"><summary className="cursor-pointer">Advanced</summary><Link className="text-maroon-800 underline" to="/dean/audit-logs">Audit Logs</Link></details>
        <p className="mt-2 text-sm text-slate-500">
          Search and manage Student and Faculty accounts.
        </p>
        <button
          type="button"
          className="btn-primary mt-4"
          disabled={busy}
          onClick={() => setManualOpen(true)}
        >
          Create User Manually
        </button>
      </div>
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2 xl:grid-cols-4">
        <label
          htmlFor={searchId}
          className="text-sm font-semibold text-slate-700"
        >
          Search accounts
          <input
            id={searchId}
            className="field mt-2"
            value={search}
            maxLength={200}
            disabled={busy}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, institutional ID, or official email"
            type="search"
          />
        </label>
        <Filter
          label="Role"
          value={filters.role}
          disabled={busy}
          onChange={(value) => changeFilter("role", value)}
          options={[
            ["all", "All users"],
            ["student", "Students"],
            ["faculty", "Faculty"],
          ]}
        />
        <Filter
          label="Account status"
          value={filters.status}
          disabled={busy}
          onChange={(value) => changeFilter("status", value)}
          options={[
            ["all", "All statuses"],
            ["Active", "Active"],
            ["Inactive", "Inactive"],
          ]}
        />
        <Filter
          label="Account source"
          value={filters.source}
          disabled={busy}
          onChange={(value) => changeFilter("source", value)}
          options={[
            ["all", "All sources (including legacy)"],
            ["csv", "CSV-created"],
            ["manual", "Manually created"],
          ]}
        />
      </div>
      <div aria-busy={loading}>
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : loading ? (
          <Loading />
        ) : users.length === 0 ? (
          <EmptyState
            title="No users found."
            text="Try a different search or filter."
          />
        ) : (
          <>
            <div className="space-y-3 lg:hidden">
              {users.map((user) => (
                <article
                  key={user._id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <AccountDetails user={user} />
                  <div className="mt-4">{actions(user)}</div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 lg:block">
              <table className="w-full bg-white text-left text-sm">
                <thead className="bg-maroon-800 text-white">
                  <tr>
                    {[
                      "Institutional ID",
                      "Full name",
                      "Official email",
                      "Role",
                      "Account source",
                      "Account status",
                      "Date created",
                      "Actions",
                    ].map((label) => (
                      <th key={label} className="px-3 py-3">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user._id} className="border-t border-slate-200">
                      <td className="px-3 py-3">
                        {user.institutionalId || "Not recorded"}
                      </td>
                      <td className="px-3 py-3">
                        {user.name || "Unnamed user"}
                      </td>
                      <td className="px-3 py-3 [overflow-wrap:anywhere]">
                        {user.email || "Not recorded"}
                      </td>
                      <td className="px-3 py-3 capitalize">{user.role}</td>
                      <td className="px-3 py-3">
                        {sourceLabel(user.accountSource)}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge
                          status={user.accountStatus || "Not recorded"}
                          compact
                        />
                      </td>
                      <td className="px-3 py-3">{dateLabel(user.createdAt)}</td>
                      <td className="px-3 py-3">{actions(user)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              currentPage={pagination.page}
              totalItems={pagination.total}
              itemsPerPage={LIMIT}
              itemLabel="users"
              onPageChange={(value) => {
                ++listRequest.current;
                setPage(value);
              }}
            />
          </>
        )}
      </div>
      {manualOpen && (
        <ManualAccountForm
          onClose={() => setManualOpen(false)}
          onSuccess={() => {
            setManualOpen(false);
            toast.success("User account created successfully.");
            void latestLoad.current();
          }}
        />
      )}
      {selected && (
        <UserDetails
          user={selected}
          loading={detailLoading}
          onClose={() => {
            ++detailRequest.current;
            setSelected(null);
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(resetTarget)}
        title="Reset password"
        message="This will reset the user's password to their institutional ID. The user may change it later from Account Settings."
        confirmLabel="Reset Password"
        loadingLabel="Resetting..."
        loading={busy}
        onConfirm={confirmReset}
        onCancel={() => { if (!inFlight.current) setResetTarget(null); }}
      />
      <ConfirmDialog
        open={Boolean(target)}
        title={
          target?.accountStatus === "Active"
            ? "Deactivate account"
            : "Activate account"
        }
        message={
          target?.accountStatus === "Active"
            ? "Deactivate this account? The user will lose access to SOCConsult."
            : "Activate this account? The user will regain access if the account is eligible."
        }
        supportingText="The account and its consultation records will be preserved."
        confirmLabel={
          target?.accountStatus === "Active" ? "Deactivate" : "Activate"
        }
        loadingLabel="Saving..."
        loading={busy}
        variant={target?.accountStatus === "Active" ? "danger" : "primary"}
        inputLabel={
          target?.accountStatus === "Active"
            ? "Deactivation reason (required)"
            : undefined
        }
        inputValue={reason}
        onInputChange={setReason}
        inputMaxLength={500}
        onConfirm={confirmStatus}
        onCancel={() => {
          if (!inFlight.current) {
            setTarget(null);
            setReason("");
          }
        }}
      />
    </div>
  );
}
function Filter({ label, value, onChange, options, disabled }) {
  return (
    <label className="text-sm font-semibold text-slate-700">
      {label}
      <select
        className="field mt-2"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}
function AccountDetails({ user }) {
  return (
    <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
      {[
        ["Institutional ID", user.institutionalId || "Not recorded"],
        ["Full name", user.name || "Unnamed user"],
        ["Official email", user.email || "Not recorded"],
        ["Role", user.role],
        ["Account source", sourceLabel(user.accountSource)],
        ["Account status", user.accountStatus || "Not recorded"],
        ["Date created", dateLabel(user.createdAt)],
      ].map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-semibold text-slate-500">{label}</dt>
          <dd className="mt-1 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
function UserDetails({ user, loading, onClose }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.querySelector("button")?.focus();
    const keydown = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        event.preventDefault();
        dialogRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keydown);
      previousFocus?.focus?.();
    };
  }, []);
  return createPortal(
    <div
      className="fixed inset-0 z-[10000] grid place-items-center bg-slate-950/55 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={loading}
        className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 id={titleId} className="text-xl font-bold text-maroon-900">
            Account details
          </h2>
          <button
            type="button"
            aria-label="Close account details"
            className="btn-action-sm"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        {loading ? <Loading /> : <AccountDetails user={user} />}
      </section>
    </div>,
    document.body,
  );
}

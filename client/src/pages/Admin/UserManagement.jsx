import { ChevronRight, ChevronUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, StatusBadge } from "../../components/UI";
import { useToast } from "../../context/ToastContext";
import Pagination from "../../components/Pagination";
import { formatPersonName } from "../../utils/formatPersonName";

const tabs = [
  "All Users",
  "Students",
  "Faculty",
  "Pending Registrations",
  "Active",
  "Inactive",
];
const passwordRule =
  "Password must be at least 8 characters and include one uppercase letter and one number. Spaces are not allowed.";
const USERS_PER_PAGE = 6;

export default function UserManagement({ initialTab = "All Users" }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState(initialTab);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedUserId, setExpandedUserId] = useState(null);

  const load = () => {
    setError("");
    setLoading(true);
    return Promise.all([
      api("/admin/users"),
      api("/admin/registrations?status=Pending"),
    ])
      .then(([accountsResponse, registrationsResponse]) => {
        const accounts = Array.isArray(accountsResponse?.users)
          ? accountsResponse.users
          : [];
        const registrations = Array.isArray(
          registrationsResponse?.registrations,
        )
          ? registrationsResponse.registrations
          : [];
        setUsers([
          ...accounts,
          ...registrations.filter(
            (pending) =>
              !accounts.some((account) => account._id === pending._id),
          ),
        ]);
      })
      .catch(() => setError("Unable to load users. Please try again."))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    void load();
  }, []);

  const view = async (user) => {
    setSelected(user);
    setDetailLoading(true);
    try {
      const data = await api(`/admin/users/${user._id}`);
      setSelected(data.user);
    } catch (requestError) {
      toast.error(requestError.message || "Unable to load user details.");
      setSelected(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const action = async (user, type) => {
    try {
      const data =
        type === "approve" || type === "reject"
          ? await api(`/admin/registrations/${user._id}/${type}`, {
              method: "PUT",
              body: "{}",
            })
          : await api(`/admin/users/${user._id}/status`, {
              method: "PUT",
              body: JSON.stringify({ accountStatus: type }),
            });
      toast.success(data.message || "User account updated.");
      setSelected(null);
      await load();
    } catch (requestError) {
      toast.error(requestError.message || "Unable to update the user account.");
    }
  };

  const shown = users.filter(
    (user) =>
      tab === "All Users" ||
      (tab === "Students" && user.role === "student") ||
      (tab === "Faculty" && user.role === "faculty") ||
      (tab === "Pending Registrations" &&
        user.registrationStatus === "Pending") ||
      (tab === "Active" && user.accountStatus === "Active") ||
      (tab === "Inactive" && user.accountStatus === "Inactive"),
  );
  const totalPages = Math.max(1, Math.ceil(shown.length / USERS_PER_PAGE));
  const validPage = Math.min(currentPage, totalPages);
  const pageUsers = shown.slice(
    (validPage - 1) * USERS_PER_PAGE,
    validPage * USERS_PER_PAGE,
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  useEffect(() => {
    setExpandedUserId(null);
  }, [tab, validPage]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (loading)
    return (
      <div className="grid min-h-48 place-items-center">
        <div className="flex items-center gap-3 text-sm font-semibold text-maroon-800">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-maroon-200 border-t-maroon-800" />
          Loading users...
        </div>
      </div>
    );
  return (
    <div className="w-full min-w-0 max-w-full space-y-5 pb-20 md:pb-16">
      <div>
        <h1 className="text-2xl font-bold text-maroon-900">User Management</h1>
        <p className="mt-2 text-sm text-slate-500">
          Review registrations and manage Student and Faculty accounts.
        </p>
      </div>
      <div className="flex max-w-full gap-2 overflow-x-auto pb-1 min-[900px]:flex-wrap min-[900px]:overflow-visible">
        {tabs.map((name) => (
          <button
            key={name}
            onClick={() => {
              setTab(name);
              setCurrentPage(1);
            }}
            className={`h-9 shrink-0 rounded-lg border px-3 text-[13px] font-semibold transition ${tab === name ? "border-maroon-800 bg-maroon-800 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-maroon-300 hover:bg-maroon-50"}`}
          >
            {name}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <EmptyState
          title={
            tab === "Pending Registrations"
              ? "No pending registrations."
              : "No users found."
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 min-[900px]:hidden">
            {pageUsers.map((user) => {
              const expanded = expandedUserId === user._id;
              const detailsId = `mobile-user-details-${user._id}`;
              const displayUserName =
                formatPersonName(user.name) || "Unnamed user";
              return (
                <article
                  key={user._id}
                  className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <div className="grid min-h-[96px] min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-start gap-3 p-3.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-maroon-800 text-sm font-bold text-white">
                      {displayUserName.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="break-words text-sm font-bold text-slate-900">
                        {displayUserName}
                      </p>
                      <p className="mt-0.5 [overflow-wrap:anywhere] text-xs lowercase leading-4 text-slate-600">
                        {user.email?.toLowerCase() || "Email unavailable"}
                      </p>
                      <p className="mt-1 text-xs capitalize text-slate-500">
                        {user.role}
                      </p>
                      <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
                        <StatusBadge status={user.accountStatus} compact />
                        <StatusBadge status={user.registrationStatus} compact />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedUserId((current) =>
                          current === user._id ? null : user._id,
                        )
                      }
                      aria-expanded={expanded}
                      aria-controls={detailsId}
                      aria-label={`${expanded ? "Collapse" : "Expand"} actions for ${displayUserName}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-maroon-800 transition hover:bg-maroon-50 focus-visible:ring-2 focus-visible:ring-maroon-300"
                    >
                      {expanded ? (
                        <ChevronUp size={18} aria-hidden="true" />
                      ) : (
                        <ChevronRight size={18} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {expanded && (
                    <div id={detailsId} className="border-t border-slate-200 bg-slate-50/70 p-3.5">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-gold-600">
                        Account Details
                      </p>
                      <dl className="mt-3 grid min-w-0 grid-cols-2 gap-3">
                        <MobileDetail label="Role" value={user.role} capitalize />
                        <MobileDetail label="Registration" value={user.registrationStatus} />
                        <MobileDetail label="Account" value={user.accountStatus} />
                        <MobileDetail
                          label="Registered"
                          value={
                            user.createdAt
                              ? new Date(user.createdAt).toLocaleDateString()
                              : "Not available"
                          }
                        />
                        <MobileDetail
                          label="Email"
                          value={user.email?.toLowerCase() || "Not available"}
                          className="col-span-2"
                        />
                      </dl>
                      <UserActions
                        user={user}
                        onView={view}
                        onReset={setResetTarget}
                        onAction={action}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <div className="responsive-table-shell hidden min-[900px]:block">
            <table className="responsive-table text-xs 2xl:text-sm">
              <colgroup>
                <col className="w-[15%]" />
                <col className="w-[23%]" />
                <col className="w-[9%]" />
                <col className="w-[11%]" />
                <col className="w-[13%]" />
                <col className="w-[11%]" />
                <col className="w-[18%]" />
              </colgroup>
              <thead className="bg-maroon-800 text-[11px] uppercase tracking-wide text-white 2xl:text-xs">
                <tr>
                  {[
                    "Name",
                    "Email",
                    "Role",
                    "Registered",
                    "Registration",
                    "Account",
                    "Actions",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="whitespace-nowrap px-1.5 py-3 font-semibold min-[1200px]:px-2.5 2xl:px-3"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageUsers.map((user) => (
                  <tr
                    key={user._id}
                    className="border-t border-slate-200 align-middle transition-colors hover:bg-slate-50"
                  >
                    <td className="min-w-0 px-1.5 py-2 min-[1200px]:px-2.5 2xl:px-3">
                      <p
                        className="whitespace-normal break-words font-semibold leading-4"
                        title={formatPersonName(user.name)}
                      >
                        {formatPersonName(user.name) || "—"}
                      </p>
                    </td>
                    <td className="min-w-0 px-1.5 py-2 min-[1200px]:px-2.5 2xl:px-3">
                      <p
                        className="[overflow-wrap:anywhere] lowercase leading-4"
                        title={user.email?.toLowerCase()}
                      >
                        {user.email?.toLowerCase() || "—"}
                      </p>
                    </td>
                    <td className="px-1.5 py-2 capitalize min-[1200px]:px-2.5 2xl:px-3">
                      {user.role}
                    </td>
                    <td className="whitespace-nowrap px-1.5 py-2 text-[10px] min-[1200px]:px-2.5 min-[1200px]:text-[11px] 2xl:px-3 2xl:text-xs">
                      {user.createdAt
                        ? new Date(user.createdAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-1 py-2 min-[1200px]:px-2 2xl:px-3">
                      <div className="flex items-center justify-center">
                        <StatusBadge status={user.registrationStatus} compact />
                      </div>
                    </td>
                    <td className="px-1 py-2 min-[1200px]:px-2 2xl:px-3">
                      <div className="flex items-center justify-center">
                        <StatusBadge status={user.accountStatus} compact />
                      </div>
                    </td>
                    <td className="px-1 py-2 pr-2 min-[1200px]:px-2 2xl:px-3">
                      <UserActions
                        user={user}
                        onView={view}
                        onReset={setResetTarget}
                        onAction={action}
                        compact
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-hidden rounded-b-2xl border border-t-0 border-slate-200">
            <Pagination
              currentPage={validPage}
              totalItems={shown.length}
              itemsPerPage={USERS_PER_PAGE}
              itemLabel="users"
              onPageChange={setCurrentPage}
            />
          </div>
        </>
      )}
      {selected && (
        <UserDetails
          user={selected}
          loading={detailLoading}
          onClose={() => setSelected(null)}
          onReset={(user) => {
            setSelected(null);
            setResetTarget(user);
          }}
          onAction={action}
        />
      )}
      {resetTarget && (
        <ResetPassword
          user={resetTarget}
          onClose={() => setResetTarget(null)}
          onSuccess={(successMessage) => {
            setResetTarget(null);
            toast.success(successMessage || "Password reset successfully.");
          }}
        />
      )}
    </div>
  );
}

function UserActions({ user, onView, onReset, onAction, compact = false }) {
  if (compact)
    return (
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onView(user)}
          className="btn-action-sm h-8 px-1.5 text-[10px] min-[1200px]:px-2 min-[1200px]:text-xs"
        >
          View
        </button>
        <details className="group relative">
          <summary className="btn-action-sm h-8 list-none px-1.5 text-[10px] min-[1200px]:px-2 min-[1200px]:text-xs [&::-webkit-details-marker]:hidden">
            Actions <span aria-hidden="true">▾</span>
          </summary>
          <div className="absolute right-0 z-20 mt-1.5 min-w-40 rounded-lg border border-slate-200 bg-white p-1.5 shadow-lg">
            <button
              type="button"
              onClick={() => onReset(user)}
              className="w-full rounded-md px-2.5 py-2 text-left text-xs font-semibold text-maroon-800 hover:bg-maroon-50"
            >
              Reset Password
            </button>
            {user.registrationStatus === "Pending" ? (
              <>
                <button
                  type="button"
                  onClick={() => onAction(user, "approve")}
                  className="w-full rounded-md px-2.5 py-2 text-left text-xs font-semibold text-green-700 hover:bg-green-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onAction(user, "reject")}
                  className="w-full rounded-md px-2.5 py-2 text-left text-xs font-semibold text-red-700 hover:bg-red-50"
                >
                  Reject
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() =>
                  onAction(
                    user,
                    user.accountStatus === "Active" ? "Inactive" : "Active",
                  )
                }
                className={`w-full rounded-md px-2.5 py-2 text-left text-xs font-semibold ${user.accountStatus === "Active" ? "text-red-700 hover:bg-red-50" : "text-green-700 hover:bg-green-50"}`}
              >
                {user.accountStatus === "Active" ? "Deactivate" : "Activate"}
              </button>
            )}
          </div>
        </details>
      </div>
    );
  return (
    <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 min-[360px]:grid-cols-2">
      <button
        type="button"
        onClick={() => onView(user)}
        className="btn-action-sm h-9 w-full"
      >
        View
      </button>
      <button
        type="button"
        onClick={() => onReset(user)}
        className="btn-action-sm h-9 w-full"
      >
        Reset Password
      </button>
      {user.registrationStatus === "Pending" ? (
        <>
          <button
            type="button"
            onClick={() => onAction(user, "approve")}
            className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-green-200 bg-white px-2.5 text-xs font-semibold text-green-700 hover:bg-green-50"
          >
            Approve
          </button>
          <button
            type="button"
            onClick={() => onAction(user, "reject")}
            className="btn-danger-action-sm h-9 w-full"
          >
            Reject
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() =>
            onAction(
              user,
              user.accountStatus === "Active" ? "Inactive" : "Active",
            )
          }
          className={
            user.accountStatus === "Active"
              ? "btn-danger-action-sm h-9 w-full"
              : "inline-flex h-9 w-full items-center justify-center rounded-lg border border-green-200 bg-white px-2.5 text-xs font-semibold text-green-700 hover:bg-green-50"
          }
        >
          {user.accountStatus === "Active" ? "Deactivate" : "Activate"}
        </button>
      )}
    </div>
  );
}

function MobileDetail({ label, value, capitalize = false, className = "" }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd
        className={`mt-1 [overflow-wrap:anywhere] text-xs font-medium text-slate-800 ${capitalize ? "capitalize" : ""}`}
      >
        {value || "Not available"}
      </dd>
    </div>
  );
}

function UserDetails({ user, loading, onClose, onReset, onAction }) {
  const account = [
    ["Full Name", formatPersonName(user.name)],
    [
      user.role === "student"
        ? "Official HAU Student Email"
        : "Official HAU Faculty Email",
      user.email?.toLowerCase(),
      "email",
    ],
    ["Role", user.role],
    ["Registration Status", user.registrationStatus],
    ["Account Status", user.accountStatus],
    [
      "Date Registered",
      user.createdAt ? new Date(user.createdAt).toLocaleString() : null,
    ],
    [
      "Last Login",
      user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : null,
    ],
  ];
  const profile =
    user.role === "student"
      ? [
          ["Student ID", user.studentId],
          ["Program", user.program],
          ["Year Level", user.yearLevel],
          ["Section", user.section],
          ["Contact Number", user.contactNumber],
        ]
      : [
          ["Employee ID", user.employeeId],
          ["Position / Designation", user.position || "Position not provided"],
          ["Specialization", user.specialization],
          ["Office Location", user.office],
          ["Contact Number", user.contactNumber],
        ];
  return (
    <Modal title="User Details" onClose={onClose}>
      {loading ? (
        <p className="py-10 text-center font-semibold text-maroon-800">
          Loading account details...
        </p>
      ) : (
        <>
          <div className="flex items-center gap-4 border-b border-slate-200 pb-5">
            {user.profilePicture ? (
              <img
                src={user.profilePicture}
                alt=""
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              <span className="grid h-16 w-16 place-items-center rounded-full bg-maroon-800 text-2xl font-bold text-white">
                {user.name?.[0] || "U"}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-bold text-slate-900">
                {formatPersonName(user.name)}
              </p>
              <p className="[overflow-wrap:anywhere] text-sm lowercase text-slate-600">
                {user.email?.toLowerCase()}
              </p>
            </div>
          </div>
          <Details title="Account Information" values={account} />
          <Details
            title={
              user.role === "student"
                ? "Student Information"
                : "Faculty Information"
            }
            values={profile}
          />
          <div className="mt-6 border-t border-slate-200 pt-5">
            <p className="text-xs font-extrabold uppercase tracking-wider text-gold-600">
              Account Actions
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                className="btn-secondary py-2"
                onClick={() =>
                  onAction(
                    user,
                    user.accountStatus === "Active" ? "Inactive" : "Active",
                  )
                }
              >
                {user.accountStatus === "Active"
                  ? "Deactivate Account"
                  : "Activate Account"}
              </button>
              <button
                type="button"
                className="btn-primary py-2"
                onClick={() => onReset(user)}
              >
                Reset Password
              </button>
              <button
                type="button"
                className="btn-secondary py-2"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

function Details({ title, values }) {
  return (
    <section className="mt-6">
      <h3 className="text-xs font-extrabold uppercase tracking-wider text-gold-600">
        {title}
      </h3>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {values.map(([label, value, format]) => (
          <div key={label} className="min-w-0 rounded-lg bg-slate-50 p-3">
            <dt className="text-xs font-semibold text-slate-500">{label}</dt>
            <dd
              className={`mt-1 text-sm font-medium text-slate-800 ${format === "email" ? "[overflow-wrap:anywhere] lowercase" : "break-words capitalize"}`}
            >
              {value || "Not available"}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ResetPassword({ user, onClose, onSuccess }) {
  const toast = useToast();
  const [form, setForm] = useState({ newPassword: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (form.newPassword !== form.confirmPassword)
      return setError("Passwords do not match.");
    if (!/^(?=.*[A-Z])(?=.*[0-9])\S{8,}$/.test(form.newPassword))
      return setError(passwordRule);
    setBusy(true);
    try {
      const data = await api(`/admin/users/${user._id}/reset-password`, {
        method: "PUT",
        body: JSON.stringify(form),
      });
      onSuccess(data.message);
    } catch (requestError) {
      toast.error(requestError.message || "Unable to reset the password.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Reset Password"
      subtitle={`Set a new password for ${formatPersonName(user.name)}. The existing password cannot be viewed.`}
      onClose={onClose}
      compact
    >
      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <div className="space-y-5 py-5">
          <label className="block text-sm font-semibold">
            New Password
            <input
              className="field mt-2 w-full"
              type="password"
              required
              value={form.newPassword}
              onChange={(event) =>
                setForm({
                  ...form,
                  newPassword: event.target.value.replace(/\s/g, ""),
                })
              }
            />
          </label>
          <label className="block text-sm font-semibold">
            Confirm New Password
            <input
              className="field mt-2 w-full"
              type="password"
              required
              value={form.confirmPassword}
              onChange={(event) =>
                setForm({
                  ...form,
                  confirmPassword: event.target.value.replace(/\s/g, ""),
                })
              }
            />
          </label>
          <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            {passwordRule}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-3 border-t border-slate-200 pt-5 sm:flex-row sm:justify-end">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="btn-primary">
            {busy ? "Resetting..." : "Reset Password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, children, compact = false }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-3 sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={`max-h-[calc(100dvh-1.5rem)] w-full min-w-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl sm:max-h-[90vh] sm:p-6 ${compact ? "max-w-lg" : "max-w-2xl"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-maroon-900">{title}</h2>
            {subtitle && (
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-slate-500"
          >
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

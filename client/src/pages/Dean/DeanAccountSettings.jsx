import { formatManilaDisplay } from "../../utils/formatDateTime";
import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/apiClient";
import { useToast } from "../../context/ToastContext";
import { useLocation } from "react-router-dom";
import { deanWorkspace } from "../../utils/deanWorkspace";
import DeanPrivilegeTransfer from "./DeanPrivilegeTransfer";
import { SecuritySettings } from "../../components/profile/ProfileForm";
import ProfilePictureEditor from "../../components/profile/ProfilePictureEditor";
import {
  formatPersonName,
  validatePersonNameFields,
} from "../../utils/formatPersonName";

const editable = ["firstName", "middleName", "lastName", "office", "contactNumber"];
const profileValues = user => Object.fromEntries(editable.map(key => [key, user[key] || ""]));

function ReadOnlyDetails({ items }) {
  return (
    <dl className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.filter(([, value]) => value != null && String(value).trim() !== "").map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-sm text-slate-500">{label}</dt>
          <dd className="mt-1 break-words text-sm font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SignInUsername() {
  const { user, updateUser } = useAuth();
  const [username, setUsername] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const submit = async event => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setSubmitting(true);
    setFeedback(null);
    try {
      const data = await api("/auth/me/username", {
        method: "PUT",
        body: JSON.stringify({ username, currentPassword }),
      });
      if (!mounted.current) return;
      updateUser(data.user);
      setUsername("");
      setFeedback({ message: "Sign-in username updated. Use it the next time you sign in." });
    } catch (error) {
      if (mounted.current)
        setFeedback({ error: true, message: deanUiError(error, "username") });
    } finally {
      pending.current = false;
      if (mounted.current) {
        setCurrentPassword("");
        setSubmitting(false);
      }
    }
  };

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="sign-in-username-title">
      <h2 id="sign-in-username-title" className="text-lg font-bold text-maroon-900">Sign-in Username</h2>
      <div className="mt-2"><ReadOnlyDetails items={[["Current username", user.username]]} /></div>
      <p id="username-requirements" className="mt-3 text-sm text-slate-500">
        Choose 3–100 characters, such as dean.reyes or an institutional email address.
        Use the Change Password section below to update your password.
      </p>
      <form aria-labelledby="sign-in-username-title" aria-busy={submitting} onSubmit={submit} className="mt-4 space-y-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <label className="min-w-0 text-sm font-semibold text-slate-700">
            New username
            <input className="field mt-1.5" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
              aria-describedby="username-requirements" required maxLength={100} disabled={submitting}
              value={username} onChange={event => setUsername(event.target.value)} />
          </label>
          <label className="min-w-0 text-sm font-semibold text-slate-700">
            Current password
            <input className="field mt-1.5" name="currentPassword" type="password" autoComplete="current-password"
              required disabled={submitting} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
          </label>
        </div>
        {feedback && <p role={feedback.error ? "alert" : "status"} className={feedback.error ? "text-sm text-red-700" : "text-sm text-green-800"}>{feedback.message}</p>}
        <div className="flex justify-end">
          <button type="submit" className="btn-primary w-full text-sm sm:w-auto" disabled={submitting}>
            {submitting ? "Saving username..." : "Save Username"}
          </button>
        </div>
      </form>
    </section>
  );
}

export default function DeanAccountSettings() {
  const { user, updateUser } = useAuth();
  const { pathname, search } = useLocation();
  const toast = useToast();
  const [form, setForm] = useState(() => profileValues(user));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  const { usernamePending, passwordPending } = user.initialCredentials ?? {};
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const save = async event => {
    event.preventDefault();
    if (pending.current) return;
    const validation = validatePersonNameFields(form);
    setErrors(validation.errors);
    if (!validation.valid) return;
    pending.current = true;
    setSaving(true);
    try {
      const data = await api("/auth/me", {
        method: "PUT",
        body: JSON.stringify({ ...form, ...validation.values }),
      });
      if (!mounted.current) return;
      updateUser(data.user);
      setForm(profileValues(data.user));
      toast.success("Profile updated successfully.");
    } catch (error) {
      if (!mounted.current) return;
      setErrors(error.errors || {});
      toast.error(deanUiError(error, "profile"));
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const refreshSecurity = () => {
    api("/auth/me").then(data => { if (mounted.current) updateUser(data.user); }).catch(() => {});
  };
  const field = (key, label, name = false) => (
    <label key={key} className="min-w-0 text-sm font-semibold text-slate-700">
      {label}
      <input
        className="field mt-1.5"
        autoComplete={({ firstName: "given-name", middleName: "additional-name", lastName: "family-name", contactNumber: "tel" })[key]}
        type={key === "contactNumber" ? "tel" : "text"}
        required={name && key !== "middleName"}
        maxLength={name ? 80 : 100}
        value={form[key]}
        disabled={saving}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `dean-profile-${key}-error` : undefined}
        onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))}
      />
      {errors[key] && <span id={`dean-profile-${key}-error`} role="alert" className="text-red-700">{errors[key]}</span>}
    </label>
  );

  return (
    <div className="w-full min-w-0 space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-maroon-900">Account Settings</h1>
        <p className="mt-1 text-sm text-slate-600">Manage your SOCConsult profile and sign-in details.</p>
      </header>
      {(usernamePending || passwordPending) && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="dean-initial-setup-title">
          <h2 id="dean-initial-setup-title" className="text-lg font-bold text-maroon-900">Set Up Your Dean Account</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Update your personal information and contact details.</li>
            {usernamePending && <li>Choose your sign-in username.</li>}
            {passwordPending && <li>Change your temporary password.</li>}
            <li>Review your account information for accuracy.</li>
          </ol>
        </section>
      )}
      <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="dean-profile-title">
        <div className="flex min-w-0 flex-wrap items-center gap-5 border-b border-slate-200 pb-5">
          <ProfilePictureEditor compact />
          <div className="min-w-0 flex-1 basis-40">
            <h2 id="dean-profile-title" className="break-words text-xl font-bold text-maroon-900">{formatPersonName(user)}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-slate-600">Dean</span>
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${user.accountStatus === "Active" ? "border-gold-200 bg-gold-50 text-maroon-900" : "border-red-200 bg-red-50 text-red-800"}`}>
                {user.accountStatus || "Status unavailable"}
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">JPG, PNG, or WebP. Maximum 4 MB.</p>
          </div>
        </div>
        <form aria-labelledby="personal-information-title" aria-busy={saving} onSubmit={save} className="mt-5 space-y-4">
          <h3 id="personal-information-title" className="text-lg font-bold text-maroon-900">Personal Information</h3>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {field("firstName", "First name", true)}
            {field("middleName", "Middle name (optional)", true)}
            {field("lastName", "Last name", true)}
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            {field("office", "Office")}
            {field("contactNumber", "Contact number")}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {saving && <p role="status" className="text-sm text-slate-600">Saving profile...</p>}
            <button className="btn-primary w-full text-sm sm:w-auto" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
          </div>
        </form>
      </section>
      <SignInUsername />
      <SecuritySettings compact onPasswordChanged={refreshSecurity} />
      <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="account-information-title">
        <h2 id="account-information-title" className="text-lg font-bold text-maroon-900">Account Information</h2>
        <div className="mt-4"><ReadOnlyDetails items={[
          ["Username", user.username], ["Official email", user.email],
          ["Institutional ID", user.institutionalId], ["Employee ID", user.employeeId],
          ["Position / Designation", user.position], ["Specialization", user.specialization],
          ["Program", user.program], ["Account source", user.accountSource],
          ["Last password change (Asia/Manila)", user.passwordChangedAt ? formatManilaDisplay(new Date(user.passwordChangedAt), undefined, "timestamp") : "No password change recorded"],
        ]} /></div>
        <p className="mt-4 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
          Password changes do not sign out existing sessions. Sessions remain valid until their normal eight-hour expiration.
        </p>
      </section>
      {deanWorkspace(pathname, search) === "management" && <DeanPrivilegeTransfer />}
    </div>
  );
}

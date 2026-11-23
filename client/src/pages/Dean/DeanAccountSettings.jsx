import { formatManilaDisplay } from "../../utils/formatDateTime";
import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/apiClient";
import { useToast } from "../../context/ToastContext";
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

export default function DeanAccountSettings() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(() => profileValues(user));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
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
        <p className="mt-1 text-sm text-slate-600">Manage your SOCConsult profile and password.</p>
      </header>
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
      <SecuritySettings compact onPasswordChanged={refreshSecurity} />
      <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 sm:p-6" aria-labelledby="account-information-title">
        <h2 id="account-information-title" className="text-lg font-bold text-maroon-900">Account Information</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">Sign-in and institutional details are read-only.</p>
        <ReadOnlyDetails items={[
          ["Username", user.username], ["Official email", user.email],
          ["Institutional ID", user.institutionalId], ["Employee ID", user.employeeId],
          ["Position / Designation", user.position], ["Specialization", user.specialization],
          ["Program", user.program], ["Account source", user.accountSource],
          ["Last password change (Asia/Manila)", user.passwordChangedAt ? formatManilaDisplay(new Date(user.passwordChangedAt), undefined, "timestamp") : "No password change recorded"],
        ]} />
        <p className="mt-4 border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">
          Password changes do not sign out existing sessions. Sessions remain valid until their normal eight-hour expiration.
        </p>
      </section>
    </div>
  );
}

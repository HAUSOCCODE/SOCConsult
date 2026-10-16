import { useRef, useState } from "react";
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
    <dl className="mt-4 grid gap-4 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm text-slate-500">{label}</dt>
          <dd className="break-words font-semibold">{value || "Not recorded"}</dd>
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
      updateUser(data.user);
      setForm(profileValues(data.user));
      toast.success(data.message);
    } catch (error) {
      setErrors(error.errors || {});
      toast.error(error.message || "Unable to update profile.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const refreshSecurity = () => {
    api("/auth/me").then(data => updateUser(data.user)).catch(() => {});
  };
  const field = (key, label, name = false) => (
    <label key={key} className="text-sm font-semibold">
      {label}
      <input
        className="field mt-2"
        type={key === "contactNumber" ? "tel" : "text"}
        required={name && key !== "middleName"}
        maxLength={name ? 80 : 100}
        value={form[key]}
        disabled={saving}
        aria-invalid={Boolean(errors[key])}
        onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))}
      />
      {errors[key] && <span role="alert" className="text-red-700">{errors[key]}</span>}
    </label>
  );

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Account</p>
        <h1 className="page-title mt-1">Account Settings</h1>
      </header>
      <section className="panel" aria-labelledby="dean-profile-title">
        <h2 id="dean-profile-title" className="text-xl font-bold text-maroon-900">Dean profile</h2>
        <ReadOnlyDetails items={[
          ["Name", formatPersonName(user)], ["Role", "Dean"],
          ["Username", user.username], ["Official email", user.email],
          ["Institutional ID", user.institutionalId], ["Employee ID", user.employeeId],
          ["Student ID", user.studentId], ["Position / Designation", user.position],
          ["Specialization", user.specialization], ["Program", user.program],
          ["Year level", user.yearLevel],
        ]} />
        <p className="mt-4 text-sm text-slate-500">Institutional identity and designation are read-only.</p>
        <form onSubmit={save} className="mt-6 space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("firstName", "First name", true)}
            {field("middleName", "Middle name (optional)", true)}
            {field("lastName", "Last name", true)}
          </div>
          <h3 className="text-lg font-bold text-maroon-900">Contact details</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("office", "Office")}
            {field("contactNumber", "Contact number")}
          </div>
          <button className="btn-primary" disabled={saving}>{saving ? "Saving..." : "Save profile"}</button>
        </form>
      </section>
      <section className="panel" aria-labelledby="picture-title">
        <h2 id="picture-title" className="mb-4 text-xl font-bold text-maroon-900">Profile picture</h2>
        <ProfilePictureEditor />
        <p className="mt-3 text-sm text-slate-500">JPG, PNG, or WebP. Maximum 4 MB.</p>
      </section>
      <SecuritySettings onPasswordChanged={refreshSecurity} />
      <section className="panel" aria-labelledby="account-security-title">
        <h2 id="account-security-title" className="text-xl font-bold text-maroon-900">Account security</h2>
        <ReadOnlyDetails items={[
          ["Account source", user.accountSource], ["Account status", user.accountStatus],
          ["Last password change", user.passwordChangedAt ? new Date(user.passwordChangedAt).toLocaleString() : "Not recorded"],
        ]} />
        <p className="mt-4 text-sm text-slate-600">
          Password changes do not sign out existing sessions. Sessions remain valid until their normal eight-hour expiration.
        </p>
      </section>
    </div>
  );
}

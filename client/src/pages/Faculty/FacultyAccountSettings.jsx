import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import ProfilePictureEditor from "../../components/profile/ProfilePictureEditor";
import { SecuritySettings } from "../../components/profile/ProfileForm";
import { FACULTY_POSITIONS, OTHER_POSITION } from "../../config/facultyPositions";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { deanUiError } from "../../utils/deanUiErrors";
import { formatPersonName, validatePersonNameFields } from "../../utils/formatPersonName";

const tabs = [{ id: "profile", label: "Profile" }, { id: "password", label: "Password" }];
const editable = ["firstName", "middleName", "lastName", "position", "office", "specialization", "contactNumber"];
const valuesFor = (user) => {
  const knownPosition = FACULTY_POSITIONS.includes(user.position);
  return {
    ...Object.fromEntries(editable.map((key) => [key, user[key] || ""])),
    position: knownPosition ? user.position : user.position ? OTHER_POSITION : "",
    customPosition: !knownPosition && user.position ? user.position : "",
  };
};

function ReadOnlyIdentity({ user }) {
  const items = [
    ["Name", formatPersonName(user)],
    ["Institutional Faculty ID", user.institutionalId || user.employeeId],
    ["Official Email Address", user.email],
    ["Role", "Faculty"],
  ];
  return <dl className="mt-5 grid gap-4 sm:grid-cols-2">{items.map(([label, value]) => (
    <div key={label} className="min-w-0 rounded-xl bg-slate-50 p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words font-semibold text-slate-900">{value || "Not recorded"}</dd>
    </div>
  ))}</dl>;
}

function FacultyProfileSettings() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(() => valuesFor(user));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => setForm(valuesFor(user)), [user]);

  const field = (key, label, options = {}) => <label key={key} className="min-w-0 text-sm font-semibold">
    {label}{options.optional && <span className="font-normal text-slate-500"> (optional)</span>}
    <input id={`faculty-account-${key}`} className="field mt-2" type={options.type || "text"}
      autoComplete={options.autoComplete} required={options.required} maxLength={options.maxLength || 100}
      disabled={saving} value={form[key]} aria-invalid={Boolean(errors[key])}
      aria-describedby={errors[key] ? `faculty-account-${key}-error` : undefined}
      onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} />
    {errors[key] && <span id={`faculty-account-${key}-error`} role="alert" className="mt-1 block text-sm text-red-700">{errors[key]}</span>}
  </label>;

  const save = async (event) => {
    event.preventDefault();
    if (pending.current) return;
    const name = validatePersonNameFields(form);
    const position = form.position === OTHER_POSITION ? form.customPosition.trim() : form.position;
    const nextErrors = { ...name.errors };
    if (!position) nextErrors.position = "Position / Designation is required.";
    setErrors(nextErrors);
    if (!name.valid || !position) return;
    pending.current = true;
    setSaving(true);
    try {
      const data = await api("/auth/me", {
        method: "PUT",
        body: JSON.stringify({ ...name.values, position, office: form.office.trim(),
          specialization: form.specialization.trim(), contactNumber: form.contactNumber.trim() }),
      });
      if (!mounted.current) return;
      updateUser(data.user);
      setForm(valuesFor(data.user));
      setErrors({});
      toast.success("Profile updated successfully.");
    } catch (error) {
      if (!mounted.current) return;
      if (error.errors) setErrors(error.errors);
      toast.error(deanUiError(error, "profile"));
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return <div className="space-y-6">
    <section className="panel" aria-labelledby="faculty-institutional-title">
      <h2 id="faculty-institutional-title" className="text-xl font-bold text-maroon-900">Institutional Information</h2>
      <p className="mt-2 text-sm text-slate-600">These identity fields are managed by the institution and cannot be changed here.</p>
      <ReadOnlyIdentity user={user} />
    </section>
    <section className="panel" aria-labelledby="faculty-profile-title">
      <h2 id="faculty-profile-title" className="text-xl font-bold text-maroon-900">Editable Profile Information</h2>
      <div className="mt-5 grid min-w-0 gap-6 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start">
        <div><h3 className="mb-3 text-sm font-semibold text-slate-700">Profile picture</h3><ProfilePictureEditor />
          <p className="mt-3 text-xs text-slate-500">JPG, PNG, or WebP. Maximum 4 MB.</p></div>
        <form onSubmit={save} aria-busy={saving} className="min-w-0 space-y-5">
          <fieldset disabled={saving}>
            <legend className="text-base font-bold text-maroon-900">Name and professional information</legend>
            <p className="mt-1 text-xs text-slate-500">Profile changes are recorded in the account audit log.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {field("firstName", "First name", { required: true, maxLength: 80, autoComplete: "given-name" })}
              {field("middleName", "Middle name", { optional: true, maxLength: 80, autoComplete: "additional-name" })}
              {field("lastName", "Last name", { required: true, maxLength: 80, autoComplete: "family-name" })}
              <label className="min-w-0 text-sm font-semibold">Position / Designation
                <select id="faculty-account-position" className="field mt-2" required value={form.position}
                  aria-invalid={Boolean(errors.position)} aria-describedby={errors.position ? "faculty-account-position-error" : undefined}
                  onChange={(event) => setForm((current) => ({ ...current, position: event.target.value }))}>
                  <option value="">Select position / designation</option>
                  {FACULTY_POSITIONS.map((position) => <option key={position} value={position}>{position}</option>)}
                  <option value={OTHER_POSITION}>Other</option>
                </select>
                {errors.position && <span id="faculty-account-position-error" role="alert" className="mt-1 block text-sm text-red-700">{errors.position}</span>}
              </label>
              {form.position === OTHER_POSITION && field("customPosition", "Other position / designation", { required: true })}
              {field("office", "Office", { optional: true })}
              {field("specialization", "Specialization", { optional: true, maxLength: 500 })}
              {field("contactNumber", "Contact number", { optional: true, type: "tel", autoComplete: "tel" })}
            </div>
          </fieldset>
          {saving && <p role="status" className="text-sm text-slate-600">Saving profile...</p>}
          <button type="submit" disabled={saving} className="btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">{saving ? "Saving..." : "Save Changes"}</button>
        </form>
      </div>
    </section>
  </div>;
}

export default function FacultyAccountSettings() {
  const { updateUser, recommendPasswordChange } = useAuth();
  const [activeTab, setActiveTab] = useState("profile");
  const selectTabFromKeyboard = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
      : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIndex].id);
    window.requestAnimationFrame(() => document.getElementById(`faculty-account-${tabs[nextIndex].id}-tab`)?.focus());
  };
  const refreshAccount = () => api("/auth/me").then(({ user }) => updateUser(user)).catch(() => {});
  return <div className="space-y-6">
    <header><p className="eyebrow">Account</p><h1 className="page-title mt-1">Account Settings</h1>
      <p className="mt-2 text-sm text-slate-500">Manage your Faculty profile, profile picture, and password.</p></header>
    {recommendPasswordChange && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">For account security, consider changing your initial password.</p>}
    <div role="tablist" aria-label="Faculty account settings" className="flex border-b border-slate-200">
      {tabs.map((tab, index) => <button key={tab.id} id={`faculty-account-${tab.id}-tab`} type="button" role="tab"
        aria-selected={activeTab === tab.id} aria-controls={`faculty-account-${tab.id}-panel`}
        tabIndex={activeTab === tab.id ? 0 : -1} onClick={() => setActiveTab(tab.id)}
        onKeyDown={(event) => selectTabFromKeyboard(event, index)}
        className={`min-h-11 border-b-2 px-4 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon-700 ${activeTab === tab.id ? "border-maroon-800 text-maroon-900" : "border-transparent text-slate-500 hover:text-maroon-800"}`}>{tab.label}</button>)}
    </div>
    <div id={`faculty-account-${activeTab}-panel`} role="tabpanel" aria-labelledby={`faculty-account-${activeTab}-tab`}>
      {activeTab === "profile" ? <FacultyProfileSettings /> : <SecuritySettings onPasswordChanged={refreshAccount} />}
    </div>
  </div>;
}

import { useEffect, useRef, useState } from "react";
import { SecuritySettings } from "../../components/profile/ProfileForm";
import ProfilePictureEditor from "../../components/profile/ProfilePictureEditor";
import { api } from "../../api/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { formatPersonName } from "../../utils/formatPersonName";

const tabs = [
  { id: "profile", label: "Profile" },
  { id: "password", label: "Password" },
];

function ReadOnlyDetails({ user }) {
  const items = [
    ["Name", formatPersonName(user)],
    ["Institutional ID", user.institutionalId || user.studentId],
    ["Official email", user.email],
    ["Role", "Student"],
    ["Program", user.program],
    ["Year level", user.yearLevel],
  ];

  return (
    <dl className="mt-5 grid gap-4 sm:grid-cols-2">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0 rounded-xl bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </dt>
          <dd className="mt-1 break-words font-semibold text-slate-900">
            {value || "Not recorded"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StudentProfileSettings() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [contactNumber, setContactNumber] = useState(user.contactNumber || "");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => setContactNumber(user.contactNumber || ""), [user.contactNumber]);

  const normalized = contactNumber.trim();
  const dirty = normalized !== (user.contactNumber || "").trim();
  const save = async (event) => {
    event.preventDefault();
    if (pending.current || !dirty) return;
    pending.current = true;
    setSaving(true);
    try {
      const data = await api("/auth/me", {
        method: "PUT",
        body: JSON.stringify({ contactNumber: normalized }),
      });
      if (!mounted.current) return;
      updateUser(data.user);
      setContactNumber(data.user.contactNumber || "");
      toast.success("Profile updated successfully.");
    } catch {
      if (mounted.current)
        toast.error("Unable to update your profile. Check the contact number and try again.");
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="panel" aria-labelledby="institutional-information-title">
        <h2 id="institutional-information-title" className="text-xl font-bold text-maroon-900">
          Institutional Information
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          If your institutional information is incorrect, please contact the Dean.
        </p>
        <ReadOnlyDetails user={user} />
      </section>

      <section className="panel" aria-labelledby="editable-profile-title">
        <h2 id="editable-profile-title" className="text-xl font-bold text-maroon-900">
          Editable Profile Information
        </h2>
        <div className="mt-5 grid min-w-0 gap-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-start">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Profile picture</h3>
            <ProfilePictureEditor />
            <p className="mt-3 text-xs text-slate-500">JPG, PNG, or WebP. Maximum 4 MB.</p>
          </div>
          <form onSubmit={save} aria-busy={saving} className="min-w-0">
            <label htmlFor="student-contact-number" className="text-sm font-semibold text-slate-800">
              Contact number <span className="font-normal text-slate-500">(optional)</span>
            </label>
            <input
              id="student-contact-number"
              type="tel"
              autoComplete="tel"
              maxLength={100}
              disabled={saving}
              value={contactNumber}
              onChange={(event) => setContactNumber(event.target.value)}
              className="field mt-2 w-full"
            />
            <p className="mt-2 text-xs text-slate-500">Enter a phone number where you can be contacted.</p>
            {saving && <p className="mt-3 text-sm" role="status">Saving profile...</p>}
            <button
              type="submit"
              disabled={saving || !dirty}
              className="btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

export default function StudentAccountSettings() {
  const [activeTab, setActiveTab] = useState("profile");
  const selectTabFromKeyboard = (event, index) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    setActiveTab(next.id);
    window.requestAnimationFrame(() =>
      document.getElementById(`student-account-${next.id}-tab`)?.focus(),
    );
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Account</p>
        <h1 className="page-title mt-1">Account Settings</h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage your contact information, profile picture, and password.
        </p>
      </header>
      <div role="tablist" aria-label="Account settings" className="flex border-b border-slate-200">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`student-account-${tab.id}-tab`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`student-account-${tab.id}-panel`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => selectTabFromKeyboard(event, index)}
            className={`min-h-11 border-b-2 px-4 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maroon-700 ${activeTab === tab.id ? "border-maroon-800 text-maroon-900" : "border-transparent text-slate-500 hover:text-maroon-800"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`student-account-${activeTab}-panel`}
        role="tabpanel"
        aria-labelledby={`student-account-${activeTab}-tab`}
      >
        {activeTab === "profile" ? <StudentProfileSettings /> : <SecuritySettings />}
      </div>
    </div>
  );
}

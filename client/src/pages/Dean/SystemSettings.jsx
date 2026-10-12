import { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/apiClient";
import { useToast } from "../../context/ToastContext";

export default function SystemSettings() {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirm: "",
  });
  const [validationError, setValidationError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setValidationError("New passwords do not match.");
      return;
    }
    setValidationError("");
    try {
      const d = await api("/dean/settings/password", {
        method: "PUT",
        body: JSON.stringify(form),
      });
      toast.success(d.message || "Password changed successfully.");
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
    } catch (e) {
      toast.error(e.message || "Unable to change password.");
    }
  };
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="min-w-0 rounded-2xl border bg-white p-4 sm:p-6">
        <h1 className="text-xl font-bold text-maroon-900">
          Account Information
        </h1>
        <dl className="mt-6 space-y-4 text-sm">
          <div>
            <dt className="text-slate-500">Username</dt>
            <dd className="mt-1 [overflow-wrap:anywhere] font-semibold">{user.username}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Role</dt>
            <dd className="mt-1 font-semibold capitalize">{user.role}</dd>
          </div>
        </dl>
      </section>
      <section className="min-w-0 rounded-2xl border bg-white p-4 sm:p-6">
        <h2 className="text-xl font-bold text-maroon-900">Change Password</h2>
        {validationError && (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {validationError}
          </p>
        )}
        <form onSubmit={submit} className="mt-6 space-y-4">
          {[
            ["Current password", "currentPassword"],
            ["New password", "newPassword"],
            ["Confirm new password", "confirm"],
          ].map(([label, key]) => (
            <label key={key} className="block text-sm font-semibold">
              {label}
              <input
                className="field mt-2"
                type="password"
                required
                minLength="8"
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            </label>
          ))}
          <button className="btn-primary w-full sm:w-auto">
            Change password
          </button>
        </form>
      </section>
    </div>
  );
}

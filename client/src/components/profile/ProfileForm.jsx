import { useState } from "react";
import {
  Badge,
  CalendarDays,
  Eye,
  EyeOff,
  GraduationCap,
  Mail,
  Phone,
  UserRound,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/apiClient";
import { useToast } from "../../context/ToastContext";
import ProfilePictureEditor from "./ProfilePictureEditor";
import { formatPersonName } from "../../utils/formatPersonName";
import {
  FACULTY_POSITIONS,
  OTHER_POSITION,
} from "../../config/facultyPositions";
export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({
    name: formatPersonName(user.name),
    program: user.program || "",
    position: FACULTY_POSITIONS.includes(user.position)
      ? user.position
      : user.position
        ? OTHER_POSITION
        : "",
    customPosition:
      user.position &&
      user.position !== OTHER_POSITION &&
      !FACULTY_POSITIONS.includes(user.position)
        ? user.position
        : "",
    yearLevel: user.yearLevel || "",
    office: user.office || "",
    specialization: user.specialization || "",
    contactNumber: user.contactNumber || "",
  });
  const save = async (e) => {
    e.preventDefault();
    try {
      if (user.role === "faculty" && !form.position) {
        toast.error("Position / Designation is required.");
        return;
      }
      if (
        user.role === "faculty" &&
        form.position === OTHER_POSITION &&
        !form.customPosition.trim()
      ) {
        toast.error("Position / Designation is required.");
        return;
      }
      const { customPosition, ...profileForm } = form;
      const data = await api("/auth/me", {
        method: "PUT",
        body: JSON.stringify({
          ...profileForm,
          name: formatPersonName(form.name),
          position:
            user.role === "faculty"
              ? form.position === OTHER_POSITION
                ? customPosition.trim()
                : form.position
              : undefined,
        }),
      });
      updateUser(data.user);
      toast.success(data.message || "Profile updated successfully.");
    } catch (error) {
      toast.error(error.message || "Unable to update profile.");
    }
  };
  return (
    <div className={`space-y-4 sm:space-y-6 ${user.role === "student" ? "pb-16 md:pb-0" : ""}`}>
      <div>
        <p className="eyebrow">Account</p>
        <h1 className="page-title mt-1">My Profile</h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage your SOCConsult account information.
        </p>
      </div>
      <form onSubmit={save} className="panel rounded-xl p-4 sm:rounded-2xl sm:p-6">
        <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row sm:items-center">
          <ProfilePictureEditor />
          <div className={`min-w-0 ${user.role === "student" ? "hidden md:block" : ""}`}>
            <h2 className="font-bold">{formatPersonName(user.name)}</h2>
            <p className="[overflow-wrap:anywhere] text-sm text-slate-500">
              {user.email || user.username}
            </p>
          </div>
        </div>
        <div className={`grid gap-4 ${user.role === "student" ? "md:grid-cols-2 md:gap-5" : "sm:grid-cols-2 sm:gap-5"}`}>
          {[
            ["name", "Full Name"],
            ["program", "Program"],
            ["yearLevel", "Year Level"],
            ["office", "Office"],
            ["specialization", "Specialization"],
            ["contactNumber", "Contact Number"],
          ]
            .filter(([key]) => {
              if (key === "name" || key === "contactNumber") return true;
              return user.role === "student"
                ? ["program", "yearLevel"].includes(key)
                : ["office", "specialization"].includes(key);
            })
            .map(([key, label]) => {
              const StudentIcon = {
                name: UserRound,
                program: GraduationCap,
                yearLevel: CalendarDays,
                contactNumber: Phone,
              }[key];
              return (
              <label key={key} className="min-w-0 text-sm font-semibold">
                <span className="flex items-center gap-2">
                  {user.role === "student" && StudentIcon && (
                    <StudentIcon size={16} className="text-slate-500 md:hidden" aria-hidden="true" />
                  )}
                  <span>{label}</span>
                </span>
                {user.role === "student" && key === "program" ? (
                  <>
                    <textarea
                      rows={2}
                      className="field mt-2 min-h-11 resize-none py-2.5 md:hidden"
                      value={form[key]}
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.value })
                      }
                    />
                    <input
                      className="field mt-2 hidden min-h-11 py-2.5 md:block"
                      value={form[key]}
                      onChange={(e) =>
                        setForm({ ...form, [key]: e.target.value })
                      }
                    />
                  </>
                ) : (
                  <input
                    className="field mt-2 min-h-11 py-2.5"
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                  />
                )}
              </label>
              );
            })}
          {user.role === "faculty" && (
            <label className="text-sm font-semibold">
              Position / Designation
              {form.position === OTHER_POSITION ? (
                <span className="mt-2 block">
                  <input
                    className="field"
                    required
                    placeholder="Enter your position or designation"
                    value={form.customPosition}
                    onInvalid={(event) =>
                      event.currentTarget.setCustomValidity(
                        "Position / Designation is required.",
                      )
                    }
                    onChange={(event) => {
                      event.currentTarget.setCustomValidity("");
                      setForm({
                        ...form,
                        customPosition: event.target.value,
                      });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        position: "",
                        customPosition: "",
                      })
                    }
                    className="mt-1.5 text-xs font-semibold text-maroon-800 hover:underline"
                  >
                    Choose from list
                  </button>
                </span>
              ) : (
                <select
                  className="field mt-2"
                  required
                  value={form.position}
                  onInvalid={(event) =>
                    event.currentTarget.setCustomValidity(
                      "Position / Designation is required.",
                    )
                  }
                  onChange={(event) => {
                    event.currentTarget.setCustomValidity("");
                    setForm({
                      ...form,
                      position: event.target.value,
                      customPosition: "",
                    });
                  }}
                >
                  <option value="">Select position / designation</option>
                  {FACULTY_POSITIONS.map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                  <option value={OTHER_POSITION}>{OTHER_POSITION}</option>
                </select>
              )}
            </label>
          )}
          <label className="min-w-0 text-sm font-semibold">
            <span className="flex items-center gap-2">
              {user.role === "student" && <Mail size={16} className="text-slate-500 md:hidden" aria-hidden="true" />}
              <span>Official HAU Email</span>
            </span>
            <input
              className="field mt-2 min-h-11 py-2.5 bg-slate-100"
              value={user.email || ""}
              disabled
            />
          </label>
          <label className="min-w-0 text-sm font-semibold">
            <span className="flex items-center gap-2">
              {user.role === "student" && <Badge size={16} className="text-slate-500 md:hidden" aria-hidden="true" />}
              <span>{user.role === "student" ? "Student ID" : "Employee ID"}</span>
            </span>
            <input
              className="field mt-2 min-h-11 py-2.5 bg-slate-100"
              value={user.studentId || user.employeeId || ""}
              disabled
            />
          </label>
        </div>
        <button className={`btn-primary mt-6 ${user.role === "student" ? "h-11 w-full md:w-auto" : ""}`}>
          Save Profile
        </button>
      </form>
    </div>
  );
}

export function SecuritySettings() {
  const toast = useToast();
  const empty = { currentPassword: "", newPassword: "", confirmPassword: "" };
  const [passwords, setPasswords] = useState(empty);
  const [visible, setVisible] = useState({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [validationError, setValidationError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const change = (key, value) =>
    setPasswords((current) => ({ ...current, [key]: value }));
  const clear = () => {
    setPasswords(empty);
    setVisible({
      currentPassword: false,
      newPassword: false,
      confirmPassword: false,
    });
  };
  const submit = async (event) => {
    event.preventDefault();
    setValidationError("");
    if (passwords.newPassword !== passwords.confirmPassword) {
      setValidationError("New passwords do not match.");
      return;
    }
    if (/\s/.test(passwords.newPassword)) {
      setValidationError("Password cannot contain spaces.");
      return;
    }
    if (!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(passwords.newPassword)) {
      setValidationError(
        "Password must be at least 8 characters and include one uppercase letter and one number.",
      );
      return;
    }
    if (passwords.currentPassword === passwords.newPassword) {
      setValidationError(
        "New password must be different from your current password.",
      );
      return;
    }
    setSubmitting(true);
    try {
      const data = await api("/auth/change-password", {
        method: "PUT",
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
          confirmNewPassword: passwords.confirmPassword,
        }),
      });
      clear();
      toast.success(data.message || "Password changed successfully.");
    } catch (error) {
      toast.error(error.message || "Unable to change password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section aria-labelledby="security-settings-title" className="space-y-4">
      <div>
        <h2
          id="security-settings-title"
          className="text-xl font-bold text-maroon-900"
        >
          Security Settings
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Manage your account password and security.
        </p>
      </div>
      <form onSubmit={submit} className="panel">
        <h3 className="text-lg font-bold text-maroon-900">Change Password</h3>
        <p className="mt-1 text-sm text-slate-500">
          Use at least 8 characters, one uppercase letter, and one number.
          Spaces are not allowed.
        </p>
        {validationError && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {validationError}
          </p>
        )}
        <div className="mt-6 grid gap-5 lg:grid-cols-3">
          {[
            ["currentPassword", "Current Password"],
            ["newPassword", "New Password"],
            ["confirmPassword", "Confirm New Password"],
          ].map(([key, label]) => (
            <label key={key} className="text-sm font-semibold">
              {label}
              <span className="relative mt-2 block">
                <input
                  required
                  type={visible[key] ? "text" : "password"}
                  autoComplete={
                    key === "currentPassword"
                      ? "current-password"
                      : "new-password"
                  }
                  className="field pr-11"
                  value={passwords[key]}
                  onChange={(event) => change(key, event.target.value)}
                />
                <button
                  type="button"
                  onClick={() =>
                    setVisible((current) => ({
                      ...current,
                      [key]: !current[key],
                    }))
                  }
                  aria-label={`${visible[key] ? "Hide" : "Show"} ${label.toLowerCase()}`}
                  className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500"
                >
                  {visible[key] ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => {
              clear();
              setValidationError("");
            }}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Changing Password..." : "Change Password"}
          </button>
        </div>
      </form>
    </section>
  );
}

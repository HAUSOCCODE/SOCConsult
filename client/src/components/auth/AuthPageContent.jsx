import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import Brand from "../Brand";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../api/apiClient";
import {
  FACULTY_POSITIONS,
  OTHER_POSITION,
} from "../../config/facultyPositions";
import { validatePersonNameFields } from "../../utils/formatPersonName";
const labels = {
  student: "Student",
  faculty: "Faculty Member",
  dean: "Dean",
};
const studentPrograms = [
  "Bachelor of Science in Information Technology",
  "Bachelor of Science in Computer Science",
  "Bachelor of Science in Cybersecurity",
  "Bachelor of Science in Data Science",
];
const pendingMessage =
  "Your account has already been created. Please wait for a Dean to approve your registration before you can access SOCConsult. You do not need to register again.";
const rejectedMessage =
  "Your registration was not approved. Please contact the Dean if you believe this requires review.";
const inactiveMessage =
  "Your account is currently inactive. Please contact the Dean for assistance.";
const expiredSessionMessage =
  "Your session has expired. Please log in again.";
const errorTitle = (message) => {
  if (message === pendingMessage) return "Account Pending Approval";
  if (message === rejectedMessage) return "Registration Not Approved";
  if (message === inactiveMessage) return "Account Inactive";
  if (message === expiredSessionMessage) return "Session Expired";
  return "Unable to Continue";
};
export default function AuthPageContent({ mode, role: fixedRole }) {
  const { role: routeRole } = useParams();
  const role = fixedRole || routeRole;
  const navigate = useNavigate();
  const { login } = useAuth();
  const [form, setForm] = useState({
    firstName: "",
    middleName: "",
    lastName: "",
    email: "",
    identifier: "",
    password: "",
    studentId: "",
    employeeId: "",
    program: "",
    position: "",
    customPosition: "",
  });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setSuccess("");
    let sessionMessage = "";
    if (mode === "login" && role === "student") {
      sessionMessage =
        sessionStorage.getItem("socconsult_student_session_message") || "";
      sessionStorage.removeItem("socconsult_student_session_message");
    }
    setError(sessionMessage);
    setFieldErrors({});
  }, [mode, role]);
  if (!labels[role] || (role === "dean" && mode === "register"))
    return <Navigate to="/get-started" replace />;
  const domain = role === "student" ? "student.hau.edu.ph" : "hau.edu.ph";
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setFieldErrors({});
    setBusy(true);
    try {
      if (mode === "register") {
        const nameValidation = validatePersonNameFields(form);
        if (!nameValidation.valid) {
          setFieldErrors(nameValidation.errors);
          setError("Please correct the highlighted name fields.");
          setBusy(false);
          return;
        }
        if (role === "faculty" && !form.position) {
          setError("Position / Designation is required.");
          setBusy(false);
          return;
        }
        if (
          role === "faculty" &&
          form.position === OTHER_POSITION &&
          !form.customPosition.trim()
        ) {
          setError("Position / Designation is required.");
          setBusy(false);
          return;
        }
        const { customPosition, ...registrationForm } = form;
        const normalized = {
          ...registrationForm,
          ...nameValidation.values,
          email: form.email.trim().toLowerCase(),
          position:
            role === "faculty"
              ? form.position === OTHER_POSITION
                ? customPosition.trim()
                : form.position
              : undefined,
        };
        await api(`/auth/register/${role}`, {
          method: "POST",
          body: JSON.stringify(normalized),
        });
        setSuccess(
          "Your account has been created and your registration has been submitted. Please wait for a Dean to approve your account before logging in.",
        );
      } else {
        const logged = await login(role, {
          identifier: form.identifier.trim().toLowerCase(),
          password: form.password,
        });
        navigate(`/${logged.role}/dashboard`, { replace: true });
      }
    } catch (e) {
      setError(e.message);
      if (e.errors) setFieldErrors(e.errors);
    } finally {
      setBusy(false);
    }
  };
  const goToLogin = () => {
    setSuccess("");
    setError("");
    setForm((current) => ({ ...current, password: "", identifier: "" }));
    navigate(`/${role}/login`, { replace: true });
  };
  return (
    <main className="grid min-h-screen grid-cols-1 bg-white lg:grid-cols-2">
      <aside className="flex min-h-64 min-w-0 flex-col justify-between bg-[#6E1423] p-5 text-white sm:p-8 lg:min-h-screen lg:p-12">
        <Brand light />
        <div className="my-10 max-w-md lg:my-0">
          <p className="text-sm font-bold uppercase tracking-[.2em] text-gold-400">
            School of Computing
          </p>
          <h1 className="mt-5 break-words font-display text-3xl font-bold leading-tight sm:text-5xl">
            Consultations made simpler.
          </h1>
          <p className="mt-5 leading-7 text-slate-100">
            Secure scheduling and organized academic support for the HAU
            community.
          </p>
        </div>
        <p className="text-xs text-slate-200">
          Holy Angel University · SOCConsult
        </p>
      </aside>
      <section className="flex min-w-0 items-center justify-center bg-white px-4 py-8 sm:px-8 sm:py-10 lg:px-12">
        <div className="w-full min-w-0 max-w-xl">
          <Link
            to="/get-started"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-maroon-800"
          >
            <ArrowLeft size={17} />
            Back to role selection
          </Link>
          <h2 className="mt-8 break-words font-display text-2xl font-bold text-maroon-900 sm:text-3xl">
            {labels[role]} {mode === "login" ? "Login" : "Registration"}
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            {mode === "login"
              ? "Welcome back. Enter your account details."
              : `Use your official @${domain} email to register.`}
          </p>
          {error && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-bold">{errorTitle(error)}</p>
              <p className="mt-1">{error}</p>
            </div>
          )}
          {success ? (
            <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
              <p className="font-bold">Account Created Successfully</p>
              <p className="mt-2">{success}</p>
              <p className="mt-2">
                You can return to the login page while waiting for approval.
              </p>
              <button
                type="button"
                onClick={goToLogin}
                className="mt-4 font-bold underline"
              >
                Go to Login
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-7">
              <div className="grid gap-5 sm:grid-cols-2">
                {mode === "register" && (
                  <>
                    <fieldset className="min-w-0 sm:col-span-2">
                      <legend className="sr-only">Name</legend>
                      <div className="grid min-w-0 gap-5 sm:grid-cols-2">
                        <Field label="First Name" error={fieldErrors.firstName}>
                          <input
                            className="field"
                            required
                            maxLength="80"
                            autoComplete="given-name"
                            placeholder="Enter your first name"
                            value={form.firstName}
                            aria-invalid={Boolean(fieldErrors.firstName)}
                            onChange={(e) => {
                              setForm({ ...form, firstName: e.target.value });
                              setFieldErrors((current) => ({
                                ...current,
                                firstName: "",
                              }));
                            }}
                          />
                        </Field>
                        <Field label="Last Name" error={fieldErrors.lastName}>
                          <input
                            className="field"
                            required
                            maxLength="80"
                            autoComplete="family-name"
                            placeholder="Enter your last name"
                            value={form.lastName}
                            aria-invalid={Boolean(fieldErrors.lastName)}
                            onChange={(e) => {
                              setForm({ ...form, lastName: e.target.value });
                              setFieldErrors((current) => ({
                                ...current,
                                lastName: "",
                              }));
                            }}
                          />
                        </Field>
                        <Field
                          label={
                            <>
                              Middle Name{" "}
                              <span className="font-normal text-slate-500">
                                (Optional)
                              </span>
                            </>
                          }
                          error={fieldErrors.middleName}
                          wide
                        >
                          <input
                            className="field"
                            maxLength="80"
                            autoComplete="additional-name"
                            placeholder="Enter your middle name"
                            value={form.middleName}
                            aria-invalid={Boolean(fieldErrors.middleName)}
                            onChange={(e) => {
                              setForm({ ...form, middleName: e.target.value });
                              setFieldErrors((current) => ({
                                ...current,
                                middleName: "",
                              }));
                            }}
                          />
                        </Field>
                      </div>
                    </fieldset>
                    <Field
                      label={role === "student" ? "Student ID" : "Employee ID"}
                    >
                      <input
                        className="field"
                        required
                        value={
                          form[role === "student" ? "studentId" : "employeeId"]
                        }
                        onChange={(e) =>
                          setForm({
                            ...form,
                            [role === "student" ? "studentId" : "employeeId"]:
                              e.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field
                      label={
                        role === "student"
                          ? "Program"
                          : "Position / Designation"
                      }
                    >
                      {role === "student" ? (
                        <select
                          className="field"
                          required
                          value={form.program}
                          onInvalid={(e) =>
                            e.currentTarget.setCustomValidity(
                              "Please select your program.",
                            )
                          }
                          onChange={(e) => {
                            e.currentTarget.setCustomValidity("");
                            setForm({ ...form, program: e.target.value });
                          }}
                        >
                          <option value="">Select your program</option>
                          {studentPrograms.map((program) => (
                            <option key={program} value={program}>
                              {program}
                            </option>
                          ))}
                        </select>
                      ) : form.position === OTHER_POSITION ? (
                        <span className="block">
                          <input
                            className="field"
                            required
                            autoFocus
                            placeholder="Enter your position or designation"
                            value={form.customPosition}
                            onInvalid={(e) =>
                              e.currentTarget.setCustomValidity(
                                "Position / Designation is required.",
                              )
                            }
                            onChange={(e) => {
                              e.currentTarget.setCustomValidity("");
                              setForm({
                                ...form,
                                customPosition: e.target.value,
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
                          className="field"
                          required
                          value={form.position}
                          onInvalid={(e) =>
                            e.currentTarget.setCustomValidity(
                              "Position / Designation is required.",
                            )
                          }
                          onChange={(e) => {
                            e.currentTarget.setCustomValidity("");
                            setForm({
                              ...form,
                              position: e.target.value,
                              customPosition: "",
                            });
                          }}
                        >
                          <option value="">
                            Select position / designation
                          </option>
                          {FACULTY_POSITIONS.map((position) => (
                            <option key={position} value={position}>
                              {position}
                            </option>
                          ))}
                          <option value={OTHER_POSITION}>
                            {OTHER_POSITION}
                          </option>
                        </select>
                      )}
                    </Field>
                  </>
                )}
                <Field
                  label={
                    role === "dean"
                      ? "Username"
                      : `Official HAU ${role === "student" ? "Student" : "Faculty"} Email`
                  }
                  wide={mode === "login"}
                >
                  <input
                    className="field"
                    required
                    type={role === "dean" ? "text" : "email"}
                    value={mode === "login" ? form.identifier : form.email}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        [mode === "login" ? "identifier" : "email"]:
                          e.target.value,
                      })
                    }
                    placeholder={
                      role === "dean"
                        ? "Dean username"
                        : `name@${domain}`
                    }
                    pattern={
                      mode === "register"
                        ? `[^@\\s]+@${domain.replaceAll(".", "\\.")}`
                        : undefined
                    }
                  />
                </Field>
                <Field
                  label="Password"
                  wide={
                    mode === "login" ||
                    (mode === "register" && role === "faculty")
                  }
                >
                  <div className="relative">
                    <input
                      className="field pr-12"
                      required
                      minLength={mode === "register" ? 8 : undefined}
                      pattern={mode === "register" ? "(?=.*[A-Z])(?=.*[0-9])\\S{8,}" : undefined}
                      title={mode === "register" ? "Password must be at least 8 characters and include one uppercase letter and one number. Spaces are not allowed." : undefined}
                      type={show ? "text" : "password"}
                      value={form.password}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          password: mode === "login" ? e.target.value : e.target.value.replace(/\s/g, ""),
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setShow(!show)}
                      className="absolute right-4 top-3.5 text-slate-400"
                    >
                      {show ? <EyeOff size={19} /> : <Eye size={19} />}
                    </button>
                  </div>
                </Field>
              </div>
              <button
                disabled={busy}
                className="btn-primary mt-6 w-full disabled:opacity-50"
              >
                {busy
                  ? "Please wait..."
                  : mode === "login"
                    ? "Log In"
                    : "Create Account"}
              </button>
              <p className="mt-5 text-center text-sm text-slate-500">
                {mode === "login" && role === "faculty" ? (
                  <>
                    New to SOCConsult?{" "}
                    <Link
                      className="font-bold text-maroon-800"
                      to={`/${role}/register`}
                    >
                      Register
                    </Link>
                  </>
                ) : mode === "register" ? (
                  <>
                    Already registered?{" "}
                    <Link
                      className="font-bold text-maroon-800"
                      to={`/${role}/login`}
                    >
                      Log in
                    </Link>
                  </>
                ) : (
                  <>Dean accounts are issued privately.</>
                )}
              </p>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
function Field({ label, children, wide = false, error = "" }) {
  return (
    <label
      className={`block text-sm font-semibold ${wide ? "sm:col-span-2" : ""}`}
    >
      <span className="mb-2 block">{label}</span>
      {children}
      {error && (
        <span className="mt-1.5 block text-xs font-medium text-red-700">
          {error}
        </span>
      )}
    </label>
  );
}

import { ArrowLeft, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import Brand from "../Brand";
import { useAuth } from "../../context/AuthContext";
const labels = {
  student: "Student",
  faculty: "Faculty Member",
  dean: "Dean",
};
const inactiveMessage =
  "Your account is currently inactive. Please contact the Dean for assistance.";
const expiredSessionMessage =
  "Your session has expired. Please log in again.";
const errorTitle = (message) => {
  if (message === inactiveMessage) return "Account Inactive";
  if (message === expiredSessionMessage) return "Session Expired";
  return "Unable to Continue";
};
export default function AuthPageContent({ role: fixedRole }) {
  const { role: routeRole } = useParams();
  const role = fixedRole || routeRole;
  const navigate = useNavigate();
  const { login, loading } = useAuth();
  const pending = useRef(false);
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let sessionMessage = "";
    if (role === "student") {
      sessionMessage =
        sessionStorage.getItem("socconsult_student_session_message") || "";
      sessionStorage.removeItem("socconsult_student_session_message");
    }
    setError(sessionMessage);
  }, [role]);
  if (!labels[role])
    return <Navigate to="/get-started" replace />;
  const domain = role === "student" ? "student.hau.edu.ph" : "hau.edu.ph";
  const submit = async (e) => {
    e.preventDefault();
    if (pending.current || (role === "faculty" && loading)) return;
    pending.current = true;
    setError("");
    setBusy(true);
    try {
      const logged = await login(role, {
        identifier: form.identifier.trim().toLowerCase(),
        password: form.password,
      });
      navigate(`/${logged.role}/dashboard`, { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
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
            {labels[role]} Login
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Welcome back. Enter your account details.
          </p>
          {error && (
            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <p className="font-bold">{errorTitle(error)}</p>
              <p className="mt-1">{error}</p>
            </div>
          )}
            <form onSubmit={submit} className="mt-7">
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  label={
                    role === "dean"
                      ? "Username"
                      : `Official HAU ${role === "student" ? "Student" : "Faculty"} Email`
                  }
                  wide
                >
                  <input
                    className="field"
                    required
                    type={role === "dean" ? "text" : "email"}
                    value={form.identifier}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        identifier: e.target.value,
                      })
                    }
                    placeholder={
                      role === "dean"
                        ? "Dean username"
                        : `name@${domain}`
                    }
                  />
                </Field>
                <Field
                  label="Password"
                  wide
                >
                  <div className="relative">
                    <input
                      className="field pr-12"
                      required
                      type={show ? "text" : "password"}
                      value={form.password}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          password: e.target.value,
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
                disabled={busy || (role === "faculty" && loading)}
                className="btn-primary mt-6 w-full disabled:opacity-50"
              >
                {busy ? "Please wait..." : "Log In"}
              </button>
              <p className="mt-5 text-center text-sm text-slate-500">
                Accounts are provided by the School of Computing. Contact the Dean for access assistance.
              </p>
            </form>
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

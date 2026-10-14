import {
  ArrowRight,
  GraduationCap,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Navbar } from "../../components/public/PublicLayout";
const roles = [
  {
    name: "Student",
    icon: GraduationCap,
    text: "Book consultations, view faculty availability, manage appointments, and track consultation activities.",
    base: "/student",
    button: "Continue as Student",
  },
  {
    name: "Faculty Member",
    icon: UserRoundCheck,
    text: "Manage consultation availability, review appointment requests, and handle consultation records.",
    base: "/faculty",
    button: "Continue as Faculty",
    register: true,
  },
  {
    name: "Dean",
    icon: ShieldCheck,
    text: "Monitor consultation activities, manage accounts, review reports, and administer the SOCConsult system.",
    base: "/dean",
    button: "Continue as Dean",
  },
];
export default function GetStartedPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-[calc(100vh-5rem)] bg-[#F7F8FA] py-10 sm:py-16">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-gold-500">
              Get started
            </p>
            <h1 className="mt-3 font-display text-3xl font-bold text-maroon-900 sm:text-4xl">
              Choose your role
            </h1>
            <p className="mt-4 text-slate-600">
              Select the portal that matches your role in the HAU School of
              Computing.
            </p>
          </div>
          <div className="mx-auto mt-8 grid max-w-6xl items-stretch gap-5 sm:mt-12 md:grid-cols-2 lg:grid-cols-3">
            {roles.map(({ name, icon: Icon, text, base, button, register }) => (
              <article
                key={name}
                className="group relative flex h-full min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-soft transition-colors duration-200 hover:border-maroon-300 sm:p-8"
              >
                <span className="absolute inset-x-0 top-0 h-1 bg-gold-400" />
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-maroon-50 text-maroon-800 ring-4 ring-maroon-100 transition-colors duration-200 group-hover:bg-maroon-800 group-hover:text-gold-300">
                  <Icon size={27} />
                </span>
                <h2 className="mt-6 text-xl font-bold text-slate-900">
                  {name}
                </h2>
                <div className="flex-1">
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {text}
                  </p>
                </div>
                <div className="mt-8">
                  <Link
                    to={`${base}/login`}
                    className="btn-primary h-auto min-h-12 w-full gap-2 px-4 text-sm"
                  >
                    {button}
                    <ArrowRight size={17} />
                  </Link>
                  <div className="mt-3 flex h-6 items-center justify-center">
                    {register ? (
                      <Link
                        to={`${base}/register`}
                        className="text-center text-sm font-semibold text-maroon-800 transition-colors duration-200 hover:text-maroon-600 hover:underline"
                      >
                        Create {name === "Student" ? "student" : "faculty"}{" "}
                        account
                      </Link>
                    ) : (
                      <span aria-hidden="true" />
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-8 text-center text-xs text-slate-500">
            Your access permissions are securely verified from your account—not
            from this selection.
          </p>
        </div>
      </main>
    </>
  );
}

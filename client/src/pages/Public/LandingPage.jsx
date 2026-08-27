import { useEffect, useState } from "react";
import {
  ArrowRight,
  Bell,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Globe2,
  Instagram,
  LockKeyhole,
  ShieldCheck,
  Users,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Footer, Navbar } from "../../components/public/PublicLayout";
import SOCConsultPublicAIGuide from "../../components/public/SOCConsultPublicAIGuide";
import { api } from "../../api/apiClient";

const features = [
  [
    CalendarDays,
    "Easy Consultation Scheduling",
    "Book and manage consultation appointments in a few clear steps.",
  ],
  [
    Clock3,
    "Faculty Availability",
    "View current faculty consultation availability in real time.",
  ],
  [
    CheckCircle2,
    "Appointment Monitoring",
    "Track every request, approval, and schedule update.",
  ],
  [
    LockKeyhole,
    "Secure HAU Access",
    "Institutional account rules protect the university community.",
  ],
  [
    Bell,
    "Timely Notifications",
    "Stay informed about decisions and schedule changes.",
  ],
  [
    FileText,
    "Consultation Records",
    "Maintain accessible academic support and consultation records.",
  ],
];
const benefits = [
  [ShieldCheck, "Secure HAU Access"],
  [Zap, "Real-time Updates"],
  [Globe2, "Accessible Anywhere"],
];
const socialPages = [
  {
    title: "HAU School of Computing Student Council",
    description:
      "Official student council page of the HAU School of Computing.",
    image: "/images/social/hausoccouncillogo.jpg",
    alt: "HAU School of Computing Student Council logo",
    href: "https://www.facebook.com/haucscsoc",
    instagramHref: "https://www.instagram.com/haucscsoc/",
  },
  {
    title: "HAU School of Computing",
    description:
      "Official Facebook page of the Holy Angel University School of Computing.",
    image: "/images/social/schoolofcomputinglogo.png",
    alt: "HAU School of Computing logo",
    href: "https://www.facebook.com/haucictofficial",
  },
];

export default function LandingPage() {
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api("/public/stats")
      .then(setStats)
      .catch(() =>
        setStats({
          activeRequests: 0,
          completedConsultations: 0,
          facultyCount: 0,
          nextAvailableSlot: null,
        }),
      );
  }, []);
  const statItems = [
    [Users, stats?.activeRequests, "Active Requests", "Pending faculty action"],
    [
      CheckCircle2,
      stats?.completedConsultations,
      "Completed",
      "Consultations finished",
    ],
    [
      CalendarDays,
      stats?.facultyCount,
      "Participating Faculty",
      "Available in the system",
    ],
    [ShieldCheck, "Secure", "HAU Access", "Protected institutional workspace"],
  ];
  return (
    <div className="min-w-0 bg-white text-slate-800">
      <Navbar />
      <main>
        <section
          id="home"
          className="relative overflow-hidden border-b border-slate-100 bg-[#fbfaf9] py-10 sm:py-14 lg:py-16"
        >
          <div className="pointer-events-none absolute -right-20 top-24 hidden h-72 w-72 rounded-full border border-gold-200/60 lg:block" />
          <div className="pointer-events-none absolute right-[8%] top-1/2 hidden h-28 w-28 bg-[radial-gradient(#d3a62c_1px,transparent_1px)] [background-size:12px_12px] opacity-25 lg:block" />
          <div className="container-page relative grid min-w-0 items-center gap-10 lg:grid-cols-[minmax(0,1.18fr)_minmax(22rem,.82fr)] lg:gap-14">
            <div className="min-w-0">
              <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-gold-300 bg-white/90 px-3 py-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-maroon-800 shadow-sm sm:px-4 sm:text-xs sm:tracking-[0.16em]">
                <ShieldCheck size={13} className="shrink-0 text-gold-600" />
                <span className="min-w-0 break-words">
                  Holy Angel University · School of Computing
                </span>
              </span>
              <h1 className="mt-6 max-w-3xl break-words font-display text-[clamp(2rem,9vw,2.75rem)] font-bold leading-[0.98] tracking-[-0.035em] text-maroon-900 lg:text-[clamp(3rem,4vw,3.75rem)]">
                Smarter consultations.
                <span className="mt-1 block text-gold-500">
                  Stronger connections.
                </span>
              </h1>
              <p className="mt-5 max-w-xl break-words text-lg font-bold leading-6 text-slate-800 sm:text-xl sm:leading-7">
                Faculty–Student Consultation and
                <span className="block">Appointment Scheduling System</span>
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">
                A centralized platform for consultation schedules, appointments,
                records, and notifications — all in one secure workspace.
              </p>
              <div className="mt-6 grid w-full gap-3 min-[420px]:flex min-[420px]:w-auto min-[420px]:flex-wrap">
                <Link
                  to="/get-started"
                  className="btn-primary h-11 w-full gap-2 min-[420px]:w-auto"
                >
                  Get Started <ArrowRight size={17} />
                </Link>
                <a
                  href="#about"
                  className="btn-secondary h-11 w-full min-[420px]:w-auto"
                >
                  Learn More
                </a>
              </div>
              <div className="mt-6 flex min-w-0 flex-wrap gap-2.5">
                {benefits.map(([Icon, label]) => (
                  <span
                    key={label}
                    className="inline-flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 shadow-sm"
                  >
                    <Icon size={14} className="shrink-0 text-maroon-700" />
                    <span className="break-words">{label}</span>
                  </span>
                ))}
              </div>
            </div>
            <LiveOverview stats={stats} />
          </div>
        </section>

        <section id="features" className="py-14 sm:py-16 lg:py-20">
          <div className="container-page">
            <SectionHeading
              eyebrow="Built for campus life"
              title="One place for every consultation"
              centered
            />
            <div className="mt-9 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map(([Icon, title, text], index) => (
                <article
                  key={title}
                  className="group flex min-h-full min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-maroon-200 hover:shadow-card sm:p-6"
                >
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white shadow-sm ${index % 2 === 0 ? "bg-maroon-800" : "bg-gold-500 text-maroon-950"}`}
                  >
                    <Icon size={19} aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 break-words text-base font-bold text-slate-900">
                    {title}
                  </h3>
                  <p className="mt-2 break-words text-sm leading-6 text-slate-600">
                    {text}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-maroon-900 py-8 text-white sm:py-10">
          <div className="container-page grid min-w-0 grid-cols-2 gap-y-7 sm:gap-y-8 lg:grid-cols-4 lg:gap-y-0">
            {statItems.map(([Icon, value, label, supporting], index) => (
              <div
                key={label}
                className={`min-w-0 px-3 text-center sm:px-6 ${index % 2 === 1 ? "border-l border-maroon-600" : ""} lg:border-l lg:first:border-l-0`}
              >
                <Icon size={25} className="mx-auto text-gold-400" />
                <p className="mt-2 break-words text-2xl font-extrabold sm:text-3xl">
                  {value ?? "—"}
                </p>
                <p className="mt-1 break-words text-xs font-bold sm:text-sm">
                  {label}
                </p>
                <p className="mt-1 hidden break-words text-xs text-maroon-100 sm:block">
                  {supporting}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="about" className="bg-[#fbfaf9] py-14 sm:py-16 lg:py-20">
          <div className="container-page grid min-w-0 items-center gap-8 md:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)] md:gap-10 lg:gap-14">
            <div className="relative order-2 min-w-0 overflow-hidden rounded-2xl border border-gold-200 bg-[linear-gradient(135deg,#6e1423,#8a2436)] p-6 shadow-card md:order-1 sm:p-8">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full border border-gold-300/30" />
              <div className="relative flex aspect-[16/10] items-center justify-center rounded-xl border border-white/15 bg-white/95 p-6 sm:p-8">
                <img
                  src="/images/social/hau-building.jpg"
                  alt="Holy Angel University building"
                  className="h-full w-full object-cover"
                />
              </div>
              <p className="relative mt-4 text-center text-xs font-bold uppercase tracking-[0.14em] text-gold-200">
                Holy Angel University · School of Computing
              </p>
            </div>
            <div className="order-1 min-w-0 md:order-2">
              <SectionHeading
                eyebrow="About SOCConsult"
                title="Better access to meaningful academic support."
              />
              <span className="mt-4 block h-0.5 w-10 bg-gold-500" />
              <p className="mt-5 max-w-2xl text-sm leading-7 text-slate-700 sm:text-base sm:leading-8">
                SOCConsult serves the School of Computing of Holy Angel
                University by bringing consultation scheduling, faculty
                availability, appointment monitoring, notifications,
                consultation records, and follow-up activities into one secure
                workspace.
              </p>
            </div>
          </div>
        </section>

        <section
          className="py-14 sm:py-16 lg:py-20"
          aria-labelledby="social-heading"
        >
          <div className="container-page">
            <SectionHeading
              eyebrow="Official school pages"
              title="Connect with the School of Computing"
              centered
              id="social-heading"
            />
            <p className="mx-auto mt-3 max-w-2xl text-center text-sm leading-6 text-slate-600 sm:text-base">
              Stay connected with the official School of Computing and Student
              Council pages.
            </p>
            <div className="mx-auto mt-8 grid w-full max-w-5xl min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
              {socialPages.map((page) => (
                <SocialCard key={page.href} page={page} />
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
      <SOCConsultPublicAIGuide />
    </div>
  );
}

function LiveOverview({ stats }) {
  const nextSlot = stats
    ? stats.nextAvailableSlot
      ? `${stats.nextAvailableSlot.day} · ${stats.nextAvailableSlot.time}`
      : "No schedule currently published"
    : "Loading current availability...";
  return (
    <aside className="relative mx-auto w-full max-w-lg min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6 lg:max-w-none">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <h2 className="min-w-0 break-words text-sm font-extrabold text-slate-900">
          Live Consultation Overview
        </h2>
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-maroon-800 text-gold-300 shadow-sm">
          <CalendarDays size={21} aria-hidden="true" />
        </span>
      </div>
      <div className="mt-4 rounded-xl border border-maroon-100 bg-maroon-50/70 p-4">
        <p className="text-xs font-medium text-slate-600">
          Next available consultation
        </p>
        <div className="mt-2 flex min-w-0 items-center justify-between gap-3">
          <p className="min-w-0 break-words text-sm font-bold text-slate-900">
            {nextSlot}
          </p>
          <CalendarDays size={20} className="shrink-0 text-gold-500" />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <OverviewStat
          icon={Users}
          value={stats?.activeRequests}
          label="Active Requests"
        />
        <OverviewStat
          icon={CheckCircle2}
          value={stats?.completedConsultations}
          label="Completed"
          gold
        />
      </div>
      <p className="mt-4 flex min-w-0 items-center gap-2 break-words text-xs text-slate-600">
        <Users size={15} className="shrink-0 text-maroon-700" />
        {stats
          ? `${stats.facultyCount} participating faculty member${stats.facultyCount === 1 ? "" : "s"}`
          : "Loading faculty..."}
      </p>
    </aside>
  );
}
function OverviewStat({ icon: Icon, value, label, gold = false }) {
  return (
    <div
      className={`min-w-0 rounded-xl border p-4 ${gold ? "border-gold-200 bg-gold-100/80" : "border-slate-200 bg-slate-50"}`}
    >
      <Icon size={19} className={gold ? "text-gold-700" : "text-maroon-700"} />
      <p className="mt-3 break-words text-2xl font-extrabold text-maroon-900">
        {value ?? "—"}
      </p>
      <p className="break-words text-[11px] text-slate-600">{label}</p>
    </div>
  );
}
function SectionHeading({ eyebrow, title, centered = false, id }) {
  return (
    <div
      className={`min-w-0 ${centered ? "mx-auto max-w-3xl text-center" : ""}`}
    >
      <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-gold-600">
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-2 break-words font-display text-3xl font-bold leading-tight tracking-tight text-maroon-900 sm:text-4xl"
      >
        {title}
      </h2>
    </div>
  );
}
function SocialCard({ page }) {
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition duration-200 hover:border-maroon-200 hover:shadow-card sm:p-5">
      <div className="flex min-w-0 items-start gap-4">
        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 sm:h-20 sm:w-20">
          <img
            src={page.image}
            alt={page.alt}
            className="h-full w-full object-contain"
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-bold leading-5 text-maroon-900">
            {page.title}
          </h3>
          <p className="mt-2 break-words text-sm leading-5 text-slate-600">
            {page.description}
          </p>
        </div>
      </div>
      <div className="mt-5 flex min-w-0 flex-wrap gap-2 sm:pl-24">
        <a
          href={page.href}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-secondary min-h-9 min-w-0 gap-1.5 whitespace-nowrap !px-3 !py-2 !text-xs"
          aria-label={`Visit ${page.title} on Facebook (opens in a new tab)`}
        >
          {page.instagramHref ? "Facebook" : "Visit Facebook Page"}
          <ExternalLink size={14} aria-hidden="true" />
        </a>
        {page.instagramHref && (
          <a
            href={page.instagramHref}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary min-h-9 min-w-0 gap-1.5 whitespace-nowrap !px-3 !py-2 !text-xs"
            aria-label={`Visit ${page.title} on Instagram (opens in a new tab)`}
          >
            <Instagram size={14} aria-hidden="true" /> Instagram
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
    </article>
  );
}

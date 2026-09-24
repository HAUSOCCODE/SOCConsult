import {
  CalendarDays,
  ChevronRight,
  FileText,
  Info,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState } from "../../components/UI";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import ProfileImagePreview from "../../components/profile/ProfileImagePreview";
import { useLocation, useNavigate } from "react-router-dom";
import { formatPersonName } from "../../utils/formatPersonName";

const YEAR_LEVELS = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
  "5th Year",
];
const initialForm = (yearLevel = "") => ({
  subject: "",
  reason: "",
  yearLevel: YEAR_LEVELS.includes(yearLevel) ? yearLevel : "",
  documents: [],
  estimatedDurationMinutes: "10",
  customEstimatedDuration: "",
});
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_SIZE = 25 * 1024 * 1024;
const allowedExtensions = new Set([
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "csv",
  "mp4",
  "webm",
]);
const formatSize = (bytes) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
const time = (value) =>
  new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export default function BookPage() {
  const { user } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const reschedule = location.state?.rescheduleAppointment || null;
  const availabilityRequest = useRef(0);
  const scheduleCache = useRef(new Map());
  const rescheduleInitialized = useRef(false);
  const [faculty, setFaculty] = useState(null);
  const [selected, setSelected] = useState(null);
  const [schedules, setSchedules] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [chosenSchedule, setChosenSchedule] = useState(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(() => initialForm(user.yearLevel));
  const [formError, setFormError] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadFaculty = () => {
    setError("");
    return api("/availability/faculty")
      .then((data) =>
        setFaculty(Array.isArray(data?.faculty) ? data.faculty : []),
      )
      .catch(() =>
        setError("Unable to load consultation information. Please try again."),
      );
  };
  useEffect(() => {
    void loadFaculty();
    const refresh = () => void loadFaculty();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => {
    if (!chosenSchedule && !availabilityOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      if (chosenSchedule) setChosenSchedule(null);
      else setAvailabilityOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [availabilityOpen, chosenSchedule]);

  const viewAvailability = async (member) => {
    const requestId = ++availabilityRequest.current;
    setSelected(member);
    setAvailabilityOpen(true);
    setFormError("");
    const cached = scheduleCache.current.get(String(member._id));
    if (cached) {
      setSchedules(cached);
      setScheduleLoading(false);
      return;
    }
    setSchedules([]);
    setScheduleLoading(true);
    try {
      const data = await api(`/availability/faculty/${member._id}`);
      if (requestId === availabilityRequest.current) {
        const loaded = Array.isArray(data?.schedules) ? data.schedules : [];
        const validSchedules = reschedule
          ? loaded.filter(
              (slot) =>
                String(slot.availabilityId || slot._id) !==
                String(reschedule.currentAvailabilityId),
            )
          : loaded;
        scheduleCache.current.set(String(member._id), validSchedules);
        setSchedules(validSchedules);
      }
    } catch {
      if (requestId === availabilityRequest.current)
        toast.error("Unable to load available schedules. Please try again.");
    } finally {
      if (requestId === availabilityRequest.current) setScheduleLoading(false);
    }
  };

  const requestSchedule = (member) => {
    setSelected(member);
    setAvailabilityOpen(false);
    setFormError("");
    setForm(initialForm(user.yearLevel));
    setChosenSchedule({ onDemand: true });
  };

  useEffect(() => {
    if (!reschedule || !faculty || rescheduleInitialized.current) return;
    const originalFaculty = faculty.find(
      (member) => String(member._id) === String(reschedule.facultyId),
    );
    if (!originalFaculty) return;
    rescheduleInitialized.current = true;
    const estimate = Number(reschedule.estimatedDurationMinutes) || 10;
    const standardEstimate = [10, 15, 20, 30, 45, 60].includes(estimate);
    setForm({
      ...initialForm(reschedule.yearLevel || user.yearLevel),
      subject: reschedule.subject || "",
      reason: reschedule.reason || "",
      estimatedDurationMinutes: standardEstimate ? String(estimate) : "custom",
      customEstimatedDuration: standardEstimate ? "" : String(estimate),
    });
    void viewAvailability(originalFaculty);
  }, [faculty, reschedule, user.yearLevel]);

  const visibleFaculty = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (faculty || []).filter((member) =>
      [member.name, member.position, member.specialization].some((value) =>
        value?.toLowerCase().includes(term),
      ),
    );
  }, [faculty, search]);

  const attach = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    const combined = [...form.documents, ...incoming];
    if (combined.length > 5)
      return setFormError("You can upload up to 5 supporting files.");
    if (incoming.some((file) => file.size > MAX_FILE_SIZE))
      return setFormError("Each supporting file must be 10 MB or smaller.");
    if (
      incoming.some(
        (file) =>
          !allowedExtensions.has(file.name.split(".").pop()?.toLowerCase()),
      )
    )
      return setFormError("This file type is not supported.");
    if (combined.reduce((total, file) => total + file.size, 0) > MAX_TOTAL_SIZE)
      return setFormError(
        "Supporting documents must not exceed 25 MB in total.",
      );
    setFormError("");
    setForm({ ...form, documents: combined });
  };

  const removeDocument = (index) =>
    setForm({
      ...form,
      documents: form.documents.filter((_, itemIndex) => itemIndex !== index),
    });

  const submit = async (event) => {
    event.preventDefault();
    if (!selected || !chosenSchedule) return;
    if (!YEAR_LEVELS.includes(form.yearLevel)) {
      setFormError("Please select your year level.");
      return;
    }
    setSubmitting(true);
    setFormError("");
    try {
      const request = new FormData();
      request.append("subject", form.subject);
      request.append("reason", form.reason);
      request.append("yearLevel", form.yearLevel);
      if (!chosenSchedule.onDemand)
        request.append("availabilityId", chosenSchedule.availabilityId);
      else request.append("facultyId", selected._id);
      const estimatedDuration =
        form.estimatedDurationMinutes === "custom"
          ? form.customEstimatedDuration
          : form.estimatedDurationMinutes;
      request.append("estimatedDurationMinutes", estimatedDuration);
      form.documents.forEach((file) => request.append("documents", file));
      const data = reschedule
        ? await api(`/appointments/${reschedule.appointmentId}/reschedule`, {
            method: "PUT",
            body: JSON.stringify({
              availabilityId: chosenSchedule.availabilityId,
            }),
          })
        : chosenSchedule.onDemand
          ? await api("/schedule-requests", {
              method: "POST",
              body: request,
            })
          : await api("/appointments", { method: "POST", body: request });
      if (reschedule) {
        toast.success(data.message || "New schedule submitted successfully.");
        navigate("/student/appointments", { replace: true, state: {} });
        return;
      }
      setChosenSchedule(null);
      setForm(initialForm(user.yearLevel));
      scheduleCache.current.delete(String(selected._id));
      await loadFaculty();
      toast.success(
        data.message || "Consultation request submitted successfully.",
      );
      if (chosenSchedule.onDemand) navigate("/student/appointments");
    } catch (requestError) {
      if (
        requestError.message ===
        "You already have an active consultation request for this faculty schedule."
      ) {
        setChosenSchedule(null);
        scheduleCache.current.delete(String(selected._id));
        await viewAvailability(selected);
      }
      toast.error(
        requestError.message ||
          (reschedule
            ? "Unable to submit the new schedule. Please try again."
            : "Unable to book the consultation. Please try again."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (error) return <ErrorState message={error} onRetry={loadFaculty} />;
  const availabilityMinutes = chosenSchedule?.onDemand
    ? 240
    : chosenSchedule
      ? Math.round(
          (new Date(chosenSchedule.endAt) - new Date(chosenSchedule.startAt)) /
            60000,
        )
      : 0;
  return (
    <div className="w-full min-w-0 max-w-full space-y-4 pb-16 sm:space-y-5 md:pb-0">
      <section className="relative min-w-0 overflow-hidden rounded-xl border border-maroon-100 bg-white p-4 shadow-sm sm:p-5">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full border border-gold-300/40" />
        <div className="pointer-events-none absolute bottom-3 right-16 hidden h-12 w-20 bg-[radial-gradient(#d3a62c_1px,transparent_1px)] [background-size:9px_9px] opacity-25 sm:block" />
        <div className="relative flex min-w-0 items-center justify-between gap-4 sm:gap-6">
          <div className="min-w-0">
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-700">
              Student Consultation
            </p>
            <h1 className="mt-1.5 break-words text-xl font-bold tracking-tight text-maroon-900 sm:text-[26px]">
              {reschedule ? "Choose a New Schedule" : "Book a Consultation"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-5 text-slate-600 sm:text-[15px] sm:leading-6">
              {reschedule
                ? "Select a new schedule for your existing consultation."
                : "Find and connect with a Faculty Member for guidance and support."}
            </p>
            {reschedule && (
              <button
                type="button"
                onClick={() => navigate("/student/appointments")}
                className="mt-3 text-sm font-bold text-maroon-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300"
              >
                Back to My Appointments
              </button>
            )}
          </div>
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-gold-300 bg-maroon-50 text-maroon-800 sm:h-14 sm:w-14">
            <CalendarDays size={23} aria-hidden="true" />
          </span>
        </div>
      </section>

      <label className="relative block w-full min-w-0 max-w-full">
        <span className="sr-only">
          Search faculty name, position, or specialization
        </span>
        <Search
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          size={19}
          aria-hidden="true"
        />
        <input
          className="field h-11 py-2 pl-11 sm:h-12"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search faculty name, position, or specialization..."
        />
      </label>

      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">
            Available Faculty
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Select a Faculty Member to review published schedules.
          </p>
        </div>
        {faculty !== null && (
          <p className="max-w-28 break-words text-right text-xs font-semibold leading-4 text-slate-500 sm:max-w-none">
            {visibleFaculty.length}{" "}
            {visibleFaculty.length === 1 ? "Faculty Member" : "Faculty Members"}
          </p>
        )}
      </div>
      {faculty === null ? (
        <p className="rounded-2xl border border-slate-200 bg-white py-12 text-center font-semibold text-maroon-800 shadow-sm">
          Loading faculty members...
        </p>
      ) : visibleFaculty.length === 0 ? (
        <EmptyState
          title={
            search.trim()
              ? "No Faculty Members found"
              : "No approved Faculty Members are currently available."
          }
          text={
            search.trim()
              ? "Try another Faculty name, position, or specialization."
              : "Approved Faculty Members will appear here when available."
          }
        />
      ) : (
        <div className="space-y-3">
          {visibleFaculty.map((member) => (
            <article
              key={member._id}
              role="button"
              tabIndex={0}
              aria-pressed={selected?._id === member._id}
              onClick={() => void viewAvailability(member)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void viewAvailability(member);
                }
              }}
              className={`min-h-[104px] w-full min-w-0 max-w-full cursor-pointer overflow-hidden rounded-xl border shadow-sm transition-colors duration-150 hover:border-maroon-300 focus:outline-none focus:ring-2 focus:ring-maroon-400 md:min-h-[112px] ${selected?._id === member._id ? "border-maroon-400 bg-maroon-50/40" : "border-slate-200 bg-white"}`}
            >
              <div className="grid min-h-[inherit] min-w-0 grid-cols-[minmax(0,1fr)_8rem] items-stretch min-[360px]:grid-cols-[minmax(0,1fr)_9rem] md:grid-cols-[minmax(0,1fr)_12rem]">
                <div className="flex min-w-0 items-center gap-2.5 p-3 sm:gap-3 sm:p-4 md:gap-4 md:px-5">
                  <span
                    className="shrink-0"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <ProfileImagePreview
                      user={member}
                      className="h-11 w-11 rounded-full bg-maroon-800 text-base font-bold text-white min-[360px]:h-12 min-[360px]:w-12 md:h-16 md:w-16 md:text-lg"
                      buttonClassName="rounded-full"
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="min-w-0">
                      <h3 className="min-w-0 break-words text-sm font-bold leading-5 text-slate-900 sm:text-base md:text-lg">
                        {formatPersonName(member.name)}
                      </h3>
                    </div>
                    <p className="mt-0.5 break-words text-xs font-medium leading-4 text-slate-600 sm:text-sm">
                      {member.position || "Position not provided"}
                    </p>
                    {selected?._id === member._id && (
                      <span className="mt-2 inline-flex w-auto shrink-0 rounded-md bg-maroon-100 px-2 py-1 text-[10px] font-bold leading-none text-maroon-800 sm:text-xs">
                        Selected
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex min-w-0 flex-col justify-center border-l border-slate-200 p-2.5 min-[360px]:p-3 md:px-5 md:py-4">
                  <p className="text-center text-xl font-extrabold leading-none text-maroon-900 md:text-2xl">
                    {member.availableScheduleCount || 0}
                  </p>
                  <p className="mt-1 break-words text-center text-[10px] font-medium leading-3.5 text-slate-600 sm:text-xs sm:leading-4">
                    available{" "}
                    {(member.availableScheduleCount || 0) === 1
                      ? "schedule"
                      : "schedules"}
                  </p>
                  <div className="mt-2.5 flex flex-col gap-2 md:mt-3">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void viewAvailability(member);
                      }}
                      className="inline-flex h-9 w-full items-center justify-center gap-0.5 whitespace-nowrap rounded-md bg-maroon-800 px-1.5 text-[10px] font-bold text-white transition-colors hover:bg-maroon-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300 focus-visible:ring-offset-2 min-[360px]:gap-1 min-[360px]:px-2 min-[360px]:text-xs md:gap-1.5 md:px-3 md:text-sm"
                    >
                      View Schedule
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                    {!reschedule && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          requestSchedule(member);
                        }}
                        className="btn-secondary inline-flex h-9 w-full items-center justify-center whitespace-nowrap px-1.5 text-[10px] min-[360px]:px-2 min-[360px]:text-xs md:px-3 md:text-sm"
                      >
                        Request a Schedule
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </article>
          ))}
          <div className="flex min-w-0 items-start gap-2.5 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs leading-5 text-slate-600 shadow-sm">
            <Info
              size={16}
              className="mt-0.5 shrink-0 text-maroon-700"
              aria-hidden="true"
            />
            <p className="min-w-0 break-words">
              Can&apos;t find the right Faculty Member? Try adjusting your
              search.
            </p>
          </div>
        </div>
      )}
      {selected &&
        availabilityOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/50 p-3 sm:p-4"
            onMouseDown={(event) =>
              event.target === event.currentTarget && setAvailabilityOpen(false)
            }
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="faculty-availability-title"
              onMouseDown={(event) => event.stopPropagation()}
              className="max-h-[90dvh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl"
            >
              <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
                <div className="flex min-w-0 items-center gap-3 sm:gap-4">
                  <ProfileImagePreview
                    user={selected}
                    className="h-12 w-12 shrink-0 rounded-full bg-maroon-800 text-lg font-bold text-white sm:h-14 sm:w-14"
                    buttonClassName="shrink-0 rounded-full"
                  />
                  <div className="min-w-0">
                    <h2
                      id="faculty-availability-title"
                      className="text-xl font-bold text-maroon-900"
                    >
                      Available Schedules
                    </h2>
                    <p className="mt-1 break-words font-bold text-slate-900">
                      {formatPersonName(selected.name)}
                    </p>
                    <p className="break-words text-sm text-slate-600">
                      {selected.position || "Position not provided"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Close faculty availability"
                  onClick={() => setAvailabilityOpen(false)}
                  autoFocus
                  className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  <X />
                </button>
              </header>
              <div className="px-5 py-5 sm:px-6">
                <p className="mb-5 text-sm text-slate-600">
                  Select an available consultation schedule.
                </p>
                {(selected.specialization ||
                  selected.office ||
                  selected.consultationModes?.length > 0) && (
                  <dl className="mb-6 grid gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm sm:grid-cols-2">
                    {selected.specialization && (
                      <div>
                        <dt className="font-semibold text-slate-500">
                          Specialization
                        </dt>
                        <dd className="mt-1 text-slate-800">
                          {selected.specialization}
                        </dd>
                      </div>
                    )}
                    {selected.office && (
                      <div>
                        <dt className="font-semibold text-slate-500">Office</dt>
                        <dd className="mt-1 text-slate-800">
                          {selected.office}
                        </dd>
                      </div>
                    )}
                    {selected.consultationModes?.length > 0 && (
                      <div>
                        <dt className="font-semibold text-slate-500">
                          Consultation Mode
                        </dt>
                        <dd className="mt-1 text-slate-800">
                          {selected.consultationModes.join(", ")}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                {scheduleLoading ? (
                  <p className="py-10 text-center text-sm font-semibold text-maroon-800">
                    Loading consultation schedules...
                  </p>
                ) : schedules.length === 0 ? (
                  <EmptyState
                    title="No available consultation schedules."
                    text="This Faculty member has not published an available schedule yet."
                  />
                ) : (
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    {schedules.map((schedule) => (
                      <article
                        key={schedule._id}
                        className="rounded-xl border border-slate-200 bg-slate-50 p-4"
                      >
                        <p className="font-bold">
                          {new Date(schedule.startAt).toLocaleDateString(
                            undefined,
                            {
                              weekday: "long",
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            },
                          )}
                        </p>
                        <p className="mt-1 text-sm">
                          {time(schedule.startAt)} – {time(schedule.endAt)}
                        </p>
                        <p className="mt-2 text-sm text-slate-600">
                          {schedule.mode} ·{" "}
                          {schedule.mode === "Online"
                            ? schedule.meetingPlatform ||
                              "Meeting platform not provided"
                            : schedule.location || "Location not provided"}
                        </p>
                        {schedule.hasActiveRequest ? (
                          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-center">
                            <p className="font-bold text-green-800">
                              {schedule.requestStatus === "Approved"
                                ? "✓ Consultation Approved"
                                : schedule.requestStatus === "Rescheduled"
                                  ? "✓ Consultation Rescheduled"
                                  : "✓ Request Already Sent"}
                            </p>
                            <p className="mt-1 text-sm text-green-700">
                              Status: {schedule.requestStatus}
                            </p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setAvailabilityOpen(false);
                              setChosenSchedule(schedule);
                              const windowMinutes = Math.round(
                                (new Date(schedule.endAt) -
                                  new Date(schedule.startAt)) /
                                  60000,
                              );
                              const defaultEstimate = [
                                10, 15, 20, 30, 45, 60,
                              ].find((minutes) => minutes <= windowMinutes);
                              setForm({
                                ...initialForm(user.yearLevel),
                                estimatedDurationMinutes: defaultEstimate
                                  ? String(defaultEstimate)
                                  : "custom",
                                customEstimatedDuration: defaultEstimate
                                  ? ""
                                  : "5",
                              });
                            }}
                            className="btn-primary mt-4 w-full py-2"
                          >
                            Select Schedule
                          </button>
                        )}
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )}
      {chosenSchedule &&
        createPortal(
          <div
            className="fixed inset-0 z-[9999] flex h-[100dvh] w-full min-w-0 items-center justify-center overflow-hidden bg-black/50 p-3 sm:p-4"
            onMouseDown={(event) =>
              event.target === event.currentTarget && setChosenSchedule(null)
            }
          >
            <form
              onSubmit={submit}
              role="dialog"
              aria-modal="true"
              aria-labelledby="booking-modal-title"
              onMouseDown={(event) => event.stopPropagation()}
              className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl"
            >
              <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
                <div>
                  <h2
                    id="booking-modal-title"
                    className="text-xl font-bold text-maroon-900"
                  >
                    {reschedule
                      ? "Choose a New Schedule"
                      : chosenSchedule.onDemand
                        ? "Request a Schedule"
                        : "Book Consultation"}
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Faculty: {formatPersonName(selected.name)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setChosenSchedule(null)}
                  autoFocus
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                >
                  <X />
                </button>
              </header>
              <div className="px-5 py-4 sm:px-6">
                {chosenSchedule.onDemand ? (
                  <p className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                    No date or time is selected. Your request will await the
                    Faculty Member's decision.
                  </p>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                    <p className="font-semibold">
                      {new Date(chosenSchedule.startAt).toLocaleDateString(
                        undefined,
                        {
                          weekday: "long",
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        },
                      )}
                    </p>
                    <p>
                      {time(chosenSchedule.startAt)} –{" "}
                      {time(chosenSchedule.endAt)}
                    </p>
                    <p className="mt-1">
                      {chosenSchedule.mode} ·{" "}
                      {chosenSchedule.mode === "Online"
                        ? chosenSchedule.meetingPlatform ||
                          "Meeting platform not provided"
                        : chosenSchedule.location || "Location not provided"}
                    </p>
                  </div>
                )}
                <div className="mt-4 space-y-4">
                  <label className="block text-sm font-semibold">
                    Subject / Topic
                    <input
                      className="field mt-2"
                      required
                      disabled={Boolean(reschedule)}
                      maxLength="150"
                      value={form.subject}
                      onChange={(event) =>
                        setForm({ ...form, subject: event.target.value })
                      }
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    Year Level
                    <select
                      className="field mt-2 w-full"
                      required
                      disabled={Boolean(reschedule)}
                      value={form.yearLevel}
                      onChange={(event) =>
                        setForm({ ...form, yearLevel: event.target.value })
                      }
                    >
                      <option value="">Select year level</option>
                      {YEAR_LEVELS.map((yearLevel) => (
                        <option key={yearLevel} value={yearLevel}>
                          {yearLevel}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold">
                    Estimated Consultation Time
                    <select
                      className="field mt-2"
                      disabled={Boolean(reschedule)}
                      value={form.estimatedDurationMinutes}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          estimatedDurationMinutes: event.target.value,
                        })
                      }
                    >
                      {[10, 15, 20, 30, 45, 60].map((minutes) => (
                        <option
                          key={minutes}
                          value={minutes}
                          disabled={minutes > availabilityMinutes}
                        >
                          {minutes} minutes
                        </option>
                      ))}
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  {form.estimatedDurationMinutes === "custom" && (
                    <label className="block text-sm font-semibold">
                      Custom Estimated Time (minutes)
                      <input
                        className="field mt-2"
                        type="number"
                        min="5"
                        max={availabilityMinutes}
                        required
                        disabled={Boolean(reschedule)}
                        value={form.customEstimatedDuration}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            customEstimatedDuration: event.target.value,
                          })
                        }
                      />
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        Minimum 5 minutes · Maximum {availabilityMinutes}{" "}
                        minutes
                      </span>
                    </label>
                  )}
                  {reschedule && (
                    <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                      Existing consultation details and supporting documents
                      will be preserved.
                    </p>
                  )}
                  {!reschedule && (
                    <label className="block text-sm font-semibold">
                      Supporting Documents{" "}
                      <span className="font-normal text-slate-500">
                        Optional · Up to 5 files · Maximum 10 MB per file · 25
                        MB total
                      </span>
                      <input
                        className="field mt-2"
                        type="file"
                        multiple
                        accept=".jpg,.jpeg,.png,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.mp4,.webm"
                        onChange={(event) => {
                          attach(event.target.files);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  )}
                  {formError && (
                    <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                      {formError}
                    </p>
                  )}
                  {!reschedule && form.documents.length > 0 && (
                    <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-3">
                      {form.documents.map((file, index) => (
                        <div
                          key={`${file.name}-${file.lastModified}-${index}`}
                          className="flex items-center gap-3 text-sm"
                        >
                          <FileText
                            size={18}
                            className="shrink-0 text-maroon-700"
                          />
                          <span
                            className="min-w-0 flex-1 truncate"
                            title={file.name}
                          >
                            {file.name}
                          </span>
                          <span className="shrink-0 text-xs text-slate-500">
                            {formatSize(file.size)}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeDocument(index)}
                            aria-label={`Remove ${file.name}`}
                            className="shrink-0 rounded p-1 text-red-700 hover:bg-red-50"
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      ))}
                      <p className="border-t border-slate-200 pt-2 text-right text-xs font-semibold text-slate-600">
                        Total:{" "}
                        {formatSize(
                          form.documents.reduce(
                            (total, file) => total + file.size,
                            0,
                          ),
                        )}{" "}
                        / 25 MB
                      </p>
                    </div>
                  )}
                  <label className="block text-sm font-semibold">
                    Reason for Consultation
                    <textarea
                      className="field mt-2 min-h-[100px] resize-y"
                      required
                      disabled={Boolean(reschedule)}
                      maxLength="1000"
                      placeholder="Briefly describe why you are requesting this consultation."
                      value={form.reason}
                      onChange={(event) =>
                        setForm({ ...form, reason: event.target.value })
                      }
                    />
                  </label>
                </div>
              </div>
              <footer className="flex flex-col-reverse gap-3 border-t border-slate-200 px-4 py-4 [&>button]:w-full sm:flex-row sm:justify-end sm:px-6 sm:[&>button]:w-auto">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setChosenSchedule(null)}
                >
                  Cancel
                </button>
                <button disabled={submitting} className="btn-primary">
                  {submitting
                    ? "Submitting..."
                    : reschedule
                      ? "Submit New Schedule"
                      : chosenSchedule.onDemand
                        ? "Send Schedule Request"
                        : "Submit Consultation Request"}
                </button>
              </footer>
            </form>
          </div>,
          document.body,
        )}
    </div>
  );
}

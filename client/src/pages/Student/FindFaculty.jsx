import {
  CalendarDays,
  Info,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState } from "../../components/UI";
import { useToast } from "../../context/ToastContext";
import ProfileImagePreview from "../../components/profile/ProfileImagePreview";
import FacultyCard from "../../components/student/FacultyCard";
import ConsultationRequestForm from "../../components/student/ConsultationRequestForm";
import { useLocation, useNavigate } from "react-router-dom";
import { formatPersonName } from "../../utils/formatPersonName";

const time = (value) =>
  new Date(value).toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function FindFaculty() {
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
  const [hasActiveStudentAvailability, setHasActiveStudentAvailability] =
    useState(null);
  const [availabilityOpen, setAvailabilityOpen] = useState(false);
  const [chosenSchedule, setChosenSchedule] = useState(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const loadFaculty = () => {
    setError("");
    scheduleCache.current.clear();
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
    const cached = scheduleCache.current.get(String(member._id));
    if (cached) {
      setSchedules(cached.schedules);
      setHasActiveStudentAvailability(cached.hasActiveStudentAvailability);
      setScheduleLoading(false);
      return;
    }
    setSchedules([]);
    setHasActiveStudentAvailability(null);
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
        const cacheEntry = {
          schedules: validSchedules,
          hasActiveStudentAvailability: Boolean(
            data?.hasActiveStudentAvailability,
          ),
        };
        scheduleCache.current.set(String(member._id), cacheEntry);
        setSchedules(validSchedules);
        setHasActiveStudentAvailability(
          cacheEntry.hasActiveStudentAvailability,
        );
      }
    } catch {
      if (requestId === availabilityRequest.current)
        toast.error("Unable to load available schedules. Please try again.");
    } finally {
      if (requestId === availabilityRequest.current) setScheduleLoading(false);
    }
  };

  useEffect(() => {
    if (!reschedule || !faculty || rescheduleInitialized.current) return;
    const originalFaculty = faculty.find(
      (member) => String(member._id) === String(reschedule.facultyId),
    );
    if (!originalFaculty) return;
    rescheduleInitialized.current = true;
    void viewAvailability(originalFaculty);
  }, [faculty, reschedule]);

  const visibleFaculty = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (faculty || []).filter((member) =>
      [member.name, member.position, member.specialization].some((value) =>
        value?.toLowerCase().includes(term),
      ),
    );
  }, [faculty, search]);

  if (error) return <ErrorState message={error} onRetry={loadFaculty} />;
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
              {reschedule ? "Choose a New Schedule" : "Find Faculty"}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-5 text-slate-600 sm:text-[15px] sm:leading-6">
              {reschedule
                ? "Select a new schedule for your existing consultation."
                : "Browse consultation providers and review their available schedules."}
            </p>
            {reschedule && (
              <button
                type="button"
                onClick={() => navigate("/student/consultations")}
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
            Consultation Providers
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Select a provider to review published schedules.
          </p>
        </div>
        {faculty !== null && (
          <p className="max-w-28 break-words text-right text-xs font-semibold leading-4 text-slate-500 sm:max-w-none">
            {visibleFaculty.length}{" "}
            {visibleFaculty.length === 1 ? "Provider" : "Providers"}
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
            <FacultyCard
              key={member._id}
              provider={member}
              selected={selected?._id === member._id}
              onViewAvailability={(provider) => void viewAvailability(provider)}
            />
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
                {!scheduleLoading &&
                  hasActiveStudentAvailability === false && (
                    <div className="mb-5 rounded-xl border border-gold-200 bg-gold-50 p-3 text-sm text-slate-700">
                      <p>
                        No active availability added. These schedules are based
                        on Faculty availability only.
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate("/student/availability")}
                        className="mt-2 font-bold text-maroon-800 hover:underline"
                      >
                        Manage My Availability
                      </button>
                    </div>
                  )}
                {scheduleLoading ? (
                  <p className="py-10 text-center text-sm font-semibold text-maroon-800">
                    Loading consultation schedules...
                  </p>
                ) : schedules.length === 0 ? (
                  <EmptyState
                    title="No compatible schedules are currently available."
                    text={
                      hasActiveStudentAvailability
                        ? "You may adjust My Availability or check another Faculty provider."
                        : "This provider has no currently bookable Faculty schedules."
                    }
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
                            "en-PH",
                            {
                              timeZone: "Asia/Manila",
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
                        <p className="mt-3 inline-flex max-w-full rounded-full bg-maroon-50 px-2.5 py-1 text-xs font-bold text-maroon-800">
                          {schedule.matchingType}
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
                            disabled={!schedule.bookable}
                            onClick={() => {
                              setAvailabilityOpen(false);
                              setChosenSchedule(schedule);
                            }}
                            className="btn-primary mt-4 w-full py-2 disabled:cursor-not-allowed disabled:opacity-50"
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
            <ConsultationRequestForm
              provider={selected}
              slot={chosenSchedule}
              reschedule={reschedule}
              onCancel={() => setChosenSchedule(null)}
              onSuccess={(data, wasReschedule) => {
                setChosenSchedule(null);
                scheduleCache.current.delete(String(selected._id));
                toast.success(
                  data.message ||
                    (wasReschedule
                      ? "New schedule submitted successfully."
                      : "Consultation request submitted successfully."),
                );
                navigate("/student/consultations", {
                  replace: true,
                  state: {},
                });
              }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

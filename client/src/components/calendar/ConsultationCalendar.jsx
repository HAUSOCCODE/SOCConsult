import "temporal-polyfill/global";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import listPlugin from "@fullcalendar/react/list";
import themePlugin from "@fullcalendar/react/themes/monarch";
import { CalendarDays, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import useDialogFocus from "../../hooks/useDialogFocus";
import { fetchPhilippineHolidays, yearsForCalendarRange } from "../../services/philippineHolidayService";
import { isRecoverableStudentError, safeStudentError } from "../../utils/studentUiErrors";
import "./consultation-calendar.css";

const TIMEZONE = "Asia/Manila";
const PLUGINS = [themePlugin, dayGridPlugin, timeGridPlugin, listPlugin];
const FINAL_STATUSES = new Set(["Completed", "Rejected", "Cancelled", "Expired", "No Show"]);

const dateKey = (value) => String(value || "").slice(0, 10);
const addDays = (key, amount) => {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};
const validInstant = (value) => Number.isFinite(+new Date(value));
const timeLabel = (value) => new Intl.DateTimeFormat("en-PH", { timeZone: TIMEZONE, hour: "numeric", minute: "2-digit" }).format(new Date(value));
const fullDateLabel = (value) => new Intl.DateTimeFormat("en-PH", { timeZone: TIMEZONE, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
const holidayDateLabel = (value) => new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${value}T00:00:00Z`));

export function mapSocConsultEvent(event) {
  if (!event || !validInstant(event.start) || !validInstant(event.end) || +new Date(event.end) <= +new Date(event.start)) return null;
  const isAvailability = event.kind === "availability";
  const isProposal = event.scheduleRole === "proposed" || event.status === "Reschedule Proposed";
  const isFinalized = FINAL_STATUSES.has(event.status);
  const className = isAvailability
    ? event.status === "Available" ? "fc-event-availability" : "fc-event-unavailable"
    : isProposal ? "fc-event-proposal" : isFinalized ? "fc-event-finalized" : "fc-event-consultation";
  const participant = event.participantName || event.facultyName || event.student?.name || "Consultation participant";
  return {
    id: `soc-${event.id || event.appointmentId || event.availabilityId}`,
    title: isAvailability ? event.displayStatus || "Consultation availability" : `${event.displayStatus || event.status}: ${event.topic || event.title || "Consultation"} · ${participant}`,
    start: event.start, end: event.end, classNames: [className], editable: false,
    extendedProps: { kind: event.kind || "appointment", socconsultEvent: event },
  };
}

export function calendarEventOrder(first, second) {
  const firstHoliday = first.extendedProps?.kind === "holiday";
  const secondHoliday = second.extendedProps?.kind === "holiday";
  if (firstHoliday !== secondHoliday) return firstHoliday ? -1 : 1;
  return String(first.startStr || first.start || "").localeCompare(String(second.startStr || second.start || ""));
}

function renderEventContent(info) {
  const { event, timeText, view } = info;
  const details = event.extendedProps;
  if (details.kind === "holiday") return <span className="soc-calendar-holiday-label"><CalendarDays size={12} aria-hidden="true" /><span>{event.title}</span></span>;

  const source = details.socconsultEvent || {};
  const availability = details.kind === "availability";
  const participant = source.participantName || source.facultyName || source.student?.name || "Consultation participant";
  const subject = source.topic || source.title || (availability ? "Consultation availability" : "Consultation");
  const status = source.displayStatus || source.status || (availability ? "Available" : "Scheduled");
  const compact = view.type === "dayGridMonth";
  return <span className={`soc-calendar-event-card ${compact ? "is-month-card" : "is-time-card"}`}>
    <span className="soc-calendar-event-meta"><span>{timeText}</span><span>{status}</span></span>
    <span className="soc-calendar-event-title">{subject}</span>
    {!availability && <span className="soc-calendar-event-participant">{participant}</span>}
  </span>;
}

export default function ConsultationCalendar({ apiPath = "/faculty/calendar", includeAvailability = false,
  consultationsPath = "/faculty/appointments", title = "Consultation Calendar",
  description = "View your confirmed and rescheduled faculty-student consultations by date.", onEventClick,
  showUpcoming = true, emptyMessage, personalCalendar = false, revision = 0 }) {
  const [range, setRange] = useState(null);
  const [events, setEvents] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [showHolidays, setShowHolidays] = useState(true);
  const [holidayWarning, setHolidayWarning] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorRetryable, setErrorRetryable] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [includeFinalized, setIncludeFinalized] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedHoliday, setSelectedHoliday] = useState(null);
  const requestSequence = useRef(0);
  const holidaySequence = useRef(0);

  const handleDatesSet = useCallback((info) => {
    const next = { start: dateKey(info.startStr), endExclusive: dateKey(info.endStr) };
    setRange((current) => current?.start === next.start && current?.endExclusive === next.endExclusive ? current : next);
  }, []);

  useEffect(() => {
    if (!range) return undefined;
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    const end = addDays(range.endExclusive, -1);
    const query = `${apiPath}?start=${range.start}&end=${end}${includeAvailability ? "&includeAvailability=true" : ""}${personalCalendar ? `&includeInactive=${includeInactive}&includeFinalized=${includeFinalized}` : ""}`;
    api(query, { signal: controller.signal, cache: "no-store" }).then((data) => {
      if (controller.signal.aborted || sequence !== requestSequence.current) return;
      setEvents(Array.isArray(data.events) ? data.events : []);
      setUpcoming(Array.isArray(data.upcoming) ? data.upcoming : []);
    }).catch((requestError) => {
      if (requestError.name === "AbortError" || controller.signal.aborted || sequence !== requestSequence.current) return;
      setEvents([]); setUpcoming([]);
      setErrorRetryable(requestError.status === 422 || isRecoverableStudentError(requestError));
      setError(requestError.status === 422 ? "Too many calendar records. Choose a narrower Week or Day view." : safeStudentError(requestError, "We couldn't load the calendar. Please try again."));
    }).finally(() => { if (!controller.signal.aborted && sequence === requestSequence.current) setLoading(false); });
    return () => controller.abort();
  }, [apiPath, includeAvailability, includeFinalized, includeInactive, personalCalendar, range, retryKey, revision]);

  useEffect(() => {
    if (!range || !showHolidays) return undefined;
    const sequence = ++holidaySequence.current;
    setHolidayWarning("");
    Promise.all(yearsForCalendarRange(range.start, range.endExclusive).map(fetchPhilippineHolidays)).then((results) => {
      if (sequence === holidaySequence.current) setHolidays(results.flat());
    }).catch(() => {
      if (sequence !== holidaySequence.current) return;
      setHolidays([]);
      setHolidayWarning("Philippine public holiday information is temporarily unavailable. Consultation schedules are unaffected.");
    });
    return () => { holidaySequence.current += 1; };
  }, [range, showHolidays]);

  useEffect(() => {
    if (!personalCalendar) return undefined;
    const refresh = () => setRetryKey((value) => value + 1);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [personalCalendar]);

  const calendarEvents = useMemo(() => [
    ...events.map(mapSocConsultEvent).filter(Boolean),
    ...(showHolidays ? holidays : []).map((holiday) => ({ ...holiday, classNames: ["fc-event-holiday"] })),
  ], [events, holidays, showHolidays]);

  const openSocConsultEvent = useCallback((event, opener) => {
    if (onEventClick) onEventClick(event, opener); else setSelectedEvent({ event, opener });
  }, [onEventClick]);

  const openEvent = useCallback((info) => {
    const { extendedProps } = info.event;
    if (extendedProps.kind === "holiday") { setSelectedHoliday({ event: info.event, opener: info.el }); return; }
    openSocConsultEvent(extendedProps.socconsultEvent, info.el);
  }, [openSocConsultEvent]);

  return <div className="consultation-calendar w-full min-w-0 space-y-5 sm:space-y-6">
    <header><h1 className="break-words text-2xl font-bold tracking-tight text-maroon-900 sm:text-[30px] sm:leading-9">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-500 sm:text-[15px]">{description}</p></header>
    <div className="flex flex-wrap gap-x-5 gap-y-3 text-sm text-slate-700">
      {personalCalendar && <><Filter checked={includeInactive} onChange={setIncludeInactive}>Show inactive / unavailable slots</Filter><Filter checked={includeFinalized} onChange={setIncludeFinalized}>Show past finalized consultations</Filter></>}
      <Filter checked={showHolidays} onChange={setShowHolidays}>Show Philippine public holidays</Filter>
    </div>
    {error && <CalendarError message={error} retryable={errorRetryable} onRetry={() => setRetryKey((value) => value + 1)} />}
    <div className={`${showUpcoming && !error ? "faculty-calendar-layout" : ""} grid min-w-0 gap-4 xl:gap-5`}>
      <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-2 shadow-sm sm:p-4" aria-busy={loading}>
        {loading && <div className="mb-3 rounded-lg bg-maroon-50 px-3 py-2 text-sm font-semibold text-maroon-800" role="status">Loading consultation calendar…</div>}
        {holidayWarning && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" role="status">{holidayWarning}</div>}
        <div className="socconsult-fullcalendar"><FullCalendar plugins={PLUGINS} themeSystem="monarch" initialView="dayGridMonth" timeZone={TIMEZONE} events={calendarEvents} datesSet={handleDatesSet} eventClick={openEvent} eventContent={renderEventContent} eventOrder={calendarEventOrder} eventOrderStrict editable={false} eventStartEditable={false} eventDurationEditable={false} selectable={false} nowIndicator stickyHeaderDates dayMaxEvents={4} height="auto" expandRows headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,timeGridWeek,timeGridDay,listMonth" }} buttonText={{ today: "Today", month: "Month", week: "Week", day: "Day", list: "List" }} views={{ timeGridWeek: { dayHeaderFormat: { weekday: "short", month: "numeric", day: "numeric" } }, listMonth: { noEventsContent: error ? "Consultations for this view could not be loaded." : emptyMessage || "No consultations are scheduled in this period." } }} slotMinTime="06:00:00" slotMaxTime="22:00:00" eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }} /></div>
        {!loading && !error && events.length === 0 && <p className="mt-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-500">{emptyMessage || "No consultations are scheduled in this period."}</p>}
        <CalendarLegend includeAvailability={includeAvailability} showFinalized={includeFinalized} showHolidays={showHolidays} />
      </section>
      {showUpcoming && !error && <UpcomingPanel consultationsPath={consultationsPath} items={upcoming} loading={loading} onOpenEvent={openSocConsultEvent} />}
    </div>
    {selectedEvent && <CalendarEventModal event={selectedEvent.event} opener={selectedEvent.opener} onClose={() => setSelectedEvent(null)} />}
    {selectedHoliday && <HolidayModal selection={selectedHoliday} onClose={() => setSelectedHoliday(null)} />}
  </div>;
}

function Filter({ checked, onChange, children }) { return <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-maroon-800" />{children}</label>; }

function CalendarLegend({ includeAvailability, showFinalized, showHolidays }) {
  const items = [["bg-maroon-800", "Consultation"], ["bg-amber-600", "Reschedule proposal"], ...(includeAvailability ? [["bg-emerald-600", "Available slot"], ["bg-slate-500", "Inactive / unavailable"]] : []), ...(showFinalized ? [["bg-slate-400", "Past finalized"]] : []), ...(showHolidays ? [["bg-pink-700", "Philippine public holiday"]] : [])];
  return <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 pt-3 text-xs text-slate-600" aria-label="Calendar legend">{items.map(([color, label]) => <span key={label} className="inline-flex items-center gap-1.5"><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{label}</span>)}</div>;
}

function UpcomingPanel({ consultationsPath, items, loading, onOpenEvent }) {
  return <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:p-5"><h2 className="font-bold text-maroon-900">Upcoming consultations</h2>{loading ? <p className="mt-4 text-sm text-slate-500">Loading upcoming consultations…</p> : items.length ? <div className="mt-4 space-y-3">{items.map((event) => <button type="button" key={event.id} onClick={(click) => onOpenEvent(event, click.currentTarget)} className="block w-full rounded-xl border border-slate-200 p-3 text-left hover:border-maroon-300 hover:bg-maroon-50"><p className="truncate font-semibold text-slate-900">{event.topic}</p><p className="mt-1 text-xs text-slate-500">{fullDateLabel(event.start)} · {timeLabel(event.start)}</p></button>)}</div> : <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center"><CalendarDays size={24} className="mx-auto text-maroon-700" /><p className="mt-2 font-bold text-slate-800">No upcoming consultations</p></div>}<Link to={consultationsPath} className="btn-secondary mt-4 flex h-11 w-full">View all appointments</Link></aside>;
}

function CalendarError({ message, onRetry, retryable }) { return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center"><p className="font-bold text-red-800">Unable to load the calendar</p><p className="mt-1 text-sm text-red-700">{message}</p>{retryable && <button type="button" onClick={onRetry} className="btn-secondary mt-4">Retry</button>}</div>; }

function CalendarEventModal({ event, opener, onClose }) {
  const availability = event.kind === "availability";
  const mode = event.mode || event.consultationMode;
  return <ModalShell title={availability ? "Availability Details" : "Consultation Details"} labelledBy="calendar-event-details-title" opener={opener} onClose={onClose}><dl className="grid min-h-0 gap-4 overflow-y-auto p-5 sm:grid-cols-2"><ModalDetail label={availability ? "Availability" : "Subject"} value={event.topic || event.title} wide />{!availability && <ModalDetail label="Participant" value={event.participantName || event.facultyName || event.student?.name} />}<ModalDetail label="Status" value={event.displayStatus || event.status} /><ModalDetail label="Date" value={fullDateLabel(event.start)} /><ModalDetail label="Time (Asia/Manila)" value={`${timeLabel(event.start)} – ${timeLabel(event.end)}`} /><ModalDetail label="Mode" value={mode} /><ModalDetail label={mode === "Online" ? "Meeting platform" : "Location"} value={mode === "Online" ? event.meetingPlatform : event.location} />{!availability && event.reason && <ModalDetail label="Reason / notes" value={event.reason} wide />}</dl></ModalShell>;
}

function HolidayModal({ selection, onClose }) {
  const holiday = selection.event;
  const details = holiday.extendedProps;
  const classification = details.holidayTypes?.length ? details.holidayTypes.join(", ") : "Classification not supplied";
  const scope = details.nationalHoliday ? "National holiday" : details.subdivisionCodes?.length ? `Regional: ${details.subdivisionCodes.join(", ")}` : "Scope not supplied";
  return <ModalShell title="Philippine Public Holiday" labelledBy="holiday-event-title" opener={selection.opener} onClose={onClose}><dl className="grid gap-4 p-5 sm:grid-cols-2"><ModalDetail label="Holiday" value={holiday.title} wide /><ModalDetail label="Calendar date" value={holidayDateLabel(holiday.startStr)} /><ModalDetail label="Scope" value={scope} /><ModalDetail label="Source classification" value={classification} /><ModalDetail label="Source" value="Nager.Holidays" /></dl><p className="px-5 pb-5 text-xs leading-5 text-slate-500">This third-party public-holiday feed does not represent Holy Angel University’s academic calendar and does not automatically block consultation scheduling.</p></ModalShell>;
}

function ModalShell({ title, labelledBy, opener, onClose, children }) {
  const panelRef = useRef(null);
  useDialogFocus(panelRef, { onClose, restoreTarget: opener });
  return createPortal(<div className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={labelledBy} onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[calc(100dvh-32px)] w-[min(680px,calc(100vw-32px))] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none"><header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6"><h2 id={labelledBy} className="break-words text-xl font-bold text-maroon-900">{title}</h2><button type="button" onClick={onClose} aria-label="Close dialog" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={20} aria-hidden="true" /></button></header>{children}<footer className="flex shrink-0 justify-end border-t border-slate-200 bg-white px-4 py-3 sm:px-6"><button type="button" onClick={onClose} className="btn-secondary">Close</button></footer></section></div>, document.body);
}

function ModalDetail({ label, value, wide = false }) { return <div className={`min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 ${wide ? "sm:col-span-2" : ""}`}><dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-sm text-slate-800">{value || "Not provided"}</dd></div>; }

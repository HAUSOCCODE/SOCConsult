import ManageAvailability from "./ManageAvailability";

export default function FacultyAvailabilityCalendar({ routeBase = "/faculty", consultationsPath = "/faculty/consultations" } = {}) {
  return <div className="min-w-0 space-y-6">
    <header>
      <h1 className="text-2xl font-bold text-maroon-900">Availability</h1>
      <p className="mt-1 text-sm text-slate-600">Manage the consultation schedules students can book.</p>
    </header>
    <ManageAvailability routeBase={routeBase} consultationsPath={consultationsPath} showCalendarLink />
  </div>;
}

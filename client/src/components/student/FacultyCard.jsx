import { ChevronRight } from "lucide-react";
import ProfileImagePreview from "../profile/ProfileImagePreview";
import { formatPersonName } from "../../utils/formatPersonName";

export default function FacultyCard({
  provider,
  selected,
  allowScheduleRequest,
  onViewAvailability,
  onRequestSchedule,
}) {
  const count = Number(provider.availableScheduleCount) || 0;
  const details = [provider.specialization, provider.office].filter(Boolean);
  const modes = Array.isArray(provider.consultationModes)
    ? provider.consultationModes
    : [];

  return (
    <article
      className={`w-full min-w-0 overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-maroon-300 sm:p-5 ${selected ? "border-maroon-400 bg-maroon-50/40" : "border-slate-200"}`}
    >
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
          <ProfileImagePreview
            user={provider}
            className="h-14 w-14 shrink-0 rounded-full bg-maroon-800 text-lg font-bold text-white sm:h-16 sm:w-16"
            buttonClassName="rounded-full"
          />
          <div className="min-w-0 flex-1">
            <h3 className="break-words text-base font-bold leading-5 text-slate-900 sm:text-lg">
              {formatPersonName(provider) || "Consultation Provider"}
            </h3>
            <p className="mt-1 break-words text-sm font-medium text-slate-600">
              {provider.position || "Position not provided"}
            </p>
            {details.length > 0 && (
              <p className="mt-1 break-words text-xs leading-5 text-slate-500">
                {details.join(" · ")}
              </p>
            )}
            {modes.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {modes.map((mode) => (
                  <span
                    key={mode}
                    className="rounded-full bg-maroon-50 px-2 py-1 text-[11px] font-semibold text-maroon-800"
                  >
                    {mode}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 border-t border-slate-200 pt-3 sm:w-48 sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
          <p className="text-center text-sm font-bold text-maroon-900">
            {count > 0
              ? `${count} Available ${count === 1 ? "Slot" : "Slots"}`
              : "No Available Slots"}
          </p>
          <button
            type="button"
            onClick={() => onViewAvailability(provider)}
            className="btn-primary inline-flex min-h-10 w-full items-center justify-center gap-1 px-3 text-sm"
          >
            View Availability
            <ChevronRight size={16} aria-hidden="true" />
          </button>
          {allowScheduleRequest && (
            <button
              type="button"
              onClick={() => onRequestSchedule(provider)}
              className="btn-secondary min-h-10 w-full px-3 text-sm"
            >
              Request a Schedule
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

import { ChevronRight } from "lucide-react";
import UserAvatar from "../profile/UserAvatar";

export default function StudentDirectoryCard({ student, selected, onRequestConsultation }) {
  const details = [student.program, student.yearLevel && `Year level: ${student.yearLevel}`].filter(Boolean);
  return <article className={`w-full min-w-0 overflow-hidden rounded-xl border bg-white p-4 shadow-sm transition-colors hover:border-maroon-300 sm:p-5 ${selected ? "border-maroon-400 bg-maroon-50/40" : "border-slate-200"}`}>
    <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <UserAvatar user={student} className="h-14 w-14 shrink-0 rounded-full bg-maroon-800 text-lg font-bold text-white sm:h-16 sm:w-16" />
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-base font-bold leading-5 text-slate-900 sm:text-lg">{student.name || "Student"}</h3>
          <p className="mt-1 break-words text-sm font-medium text-slate-600">{details.length ? details.join(" · ") : "Program and year level not provided"}</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-2 border-t border-slate-200 pt-3 sm:w-48 sm:shrink-0 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
        <p className="text-center text-sm font-bold text-maroon-900">Student</p>
        <button type="button" onClick={() => onRequestConsultation(student)} className="btn-primary inline-flex min-h-10 w-full items-center justify-center gap-1 px-3 text-sm">
          Request Consultation <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  </article>;
}

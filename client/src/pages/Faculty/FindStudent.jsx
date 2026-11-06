import { GraduationCap, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";
import FacultyConsultationRequestModal from "../../components/appointments/FacultyConsultationRequestModal";
import { EmptyState, ErrorState } from "../../components/UI";
import { safeUiError } from "../../utils/safeUiErrors";
import StudentDirectoryCard from "../../components/faculty/StudentDirectoryCard";

export default function FindStudent() {
  const [query, setQuery] = useState(""), [appliedQuery, setAppliedQuery] = useState("");
  const [page, setPage] = useState(1), [result, setResult] = useState({ loading: true });
  const [selected, setSelected] = useState(null), request = useRef(null);
  const load = useCallback(async (searchValue = appliedQuery, requestedPage = page) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setResult({ loading: true });
    const params = new URLSearchParams({ page: String(requestedPage) }); if (searchValue) params.set("q", searchValue);
    try { const data = await api(`/appointments/faculty-request/students?${params}`, { signal: controller.signal, cache: "no-store" });
      if (!controller.signal.aborted) setResult({ students: data.students || [], pagination: data.pagination });
    } catch (error) { if (!controller.signal.aborted) setResult({ error: safeUiError(error, "Unable to load Students. Please try again.") }); }
  }, [appliedQuery, page]);
  useEffect(() => { void load(); return () => request.current?.abort(); }, [load]);
  useEffect(() => {
    const value = query.trim(); if (value.length === 1) return undefined;
    const timer = setTimeout(() => { setPage(1); setAppliedQuery(value); }, 350);
    return () => clearTimeout(timer);
  }, [query]);
  return <div className="w-full min-w-0 max-w-full space-y-4 pb-16 sm:space-y-5 md:pb-0">
    <section className="relative min-w-0 overflow-hidden rounded-xl border border-maroon-100 bg-white p-4 shadow-sm sm:p-5">
      <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full border border-gold-300/40" />
      <div className="pointer-events-none absolute bottom-3 right-16 hidden h-12 w-20 bg-[radial-gradient(#d3a62c_1px,transparent_1px)] [background-size:9px_9px] opacity-25 sm:block" />
      <div className="relative flex min-w-0 items-center justify-between gap-4 sm:gap-6"><div className="min-w-0"><p className="text-xs font-extrabold uppercase tracking-[0.16em] text-gold-700">Faculty Consultation</p><h1 className="mt-1.5 break-words text-xl font-bold tracking-tight text-maroon-900 sm:text-[26px]">Find Student</h1><p className="mt-2 max-w-2xl text-sm leading-5 text-slate-600 sm:text-[15px] sm:leading-6">Browse eligible Students and request consultations.</p></div><span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-gold-300 bg-maroon-50 text-maroon-800 sm:h-14 sm:w-14"><GraduationCap size={23} aria-hidden="true" /></span></div>
    </section>
    <label className="relative block w-full min-w-0 max-w-full"><span className="sr-only">Search Student name, program, or year level</span><Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={19} aria-hidden="true" /><input className="field h-11 py-2 pl-11 sm:h-12" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search Student name, program, or year level..." /></label>
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3"><div className="min-w-0"><h2 className="text-lg font-bold text-slate-900">Students</h2><p className="mt-1 text-xs text-slate-500">Select a Student to request a consultation.</p></div>{!result.loading && !result.error && <p className="max-w-28 break-words text-right text-xs font-semibold leading-4 text-slate-500 sm:max-w-none">{result.pagination?.total ?? result.students?.length ?? 0} {(result.pagination?.total ?? result.students?.length) === 1 ? "Student" : "Students"}</p>}</div>
    {result.loading ? <p className="rounded-2xl border border-slate-200 bg-white py-12 text-center font-semibold text-maroon-800 shadow-sm">Loading Students...</p> : result.error ? <ErrorState message={result.error} onRetry={() => load()} /> : !result.students.length ? <EmptyState title={appliedQuery ? "No Students match your search." : "No eligible Students are currently available."} text={appliedQuery ? "Try another Student name, program, or year level." : "Eligible Students will appear here when available."} /> : <><div className="space-y-3">{result.students.map(student => <StudentDirectoryCard key={student.id} student={student} selected={selected?.id === student.id} onRequestConsultation={setSelected} />)}</div><nav className="flex flex-wrap items-center justify-center gap-3" aria-label="Student directory pagination"><button type="button" className="btn-secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span className="text-sm text-slate-600">Page {page} of {Math.max(1, result.pagination?.totalPages || 1)}</span><button type="button" className="btn-secondary" disabled={page >= (result.pagination?.totalPages || 1)} onClick={() => setPage(value => value + 1)}>Next</button></nav></>}
    <FacultyConsultationRequestModal open={Boolean(selected)} initialStudent={selected} onClose={() => setSelected(null)} onSuccess={() => setSelected(null)} />
  </div>;
}

import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import ConsultationRecordView from "./ConsultationRecordView";

export default function StudentConsultationRecord({ appointmentId }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    setState({ loading: true });
    api(`/appointments/${appointmentId}/consultation-record`, { cache: "no-store" })
      .then(data => active && setState(data))
      .catch(() => active && setState({ error: "Unable to load the consultation record." }));
    return () => { active = false; };
  }, [appointmentId]);
  return <section className="min-w-0 rounded-xl border border-slate-200 p-4 sm:p-5" aria-labelledby="student-consultation-record-heading">
    <h3 id="student-consultation-record-heading" className="font-bold text-maroon-900">Consultation Record</h3>
    <div className="mt-3">{state.loading ? <p role="status" className="text-sm text-slate-600">Loading consultation record...</p>
      : state.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p>
        : <ConsultationRecordView record={state.record} />}</div>
  </section>;
}

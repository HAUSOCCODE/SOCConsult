import { formatManilaDateTime } from "../../utils/formatDateTime";

export default function ConsultationRecordView({ record, emptyMessage = "No consultation record has been added yet." }) {
  if (!record) return <p className="text-sm text-slate-600">{emptyMessage}</p>;
  return <div className="min-w-0 space-y-4">
    {record.notes && <Field label="Consultation Notes / Summary" value={record.notes} />}
    {record.recommendations && <Field label="Recommendations" value={record.recommendations} />}
    <dl className="grid min-w-0 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-3">
      <Meta label="Recorded by" value={record.author?.name || "Assigned consultant"} />
      <Meta label="Date recorded" value={formatManilaDateTime(record.dateRecorded, "Not available")} />
      <Meta label="Last updated" value={formatManilaDateTime(record.updatedAt, "Not available")} />
    </dl>
  </div>;
}

function Field({ label, value }) {
  return <div className="min-w-0"><h4 className="text-sm font-bold text-slate-800">{label}</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{value}</p></div>;
}
function Meta({ label, value }) {
  return <div className="min-w-0"><dt className="font-semibold text-slate-600">{label}</dt><dd className="mt-0.5 break-words text-slate-800">{value}</dd></div>;
}

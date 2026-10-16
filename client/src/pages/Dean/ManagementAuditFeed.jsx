import { useEffect, useState } from "react";
import { api } from "../../api/apiClient";
const initial = { startDate: "", endDate: "", action: "", actorRole: "", targetId: "" };
export default function ManagementAuditFeed() {
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    const query = new URLSearchParams({ page, limit: 20 });
    Object.entries(filters).forEach(([key, value]) => { if (value) query.set(key, value); });
    api("/dean/audit-logs?" + query).then(result => { if (current) setData(result); })
      .catch(() => { if (current) { setData(null); setError("Unable to load audit records. Check the filters and try again."); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [filters, page]);
  const field = (key, value) => setDraft(previous => ({ ...previous, [key]: value }));
  return <section className="space-y-3 rounded-2xl border bg-white p-4" aria-label="Management audit records">
    <h2 className="font-semibold">Management Audit Records</h2>
    <p className="text-sm text-slate-600">Account, authentication, consultation and report events. Defaults to the past year; each date range may span at most 366 days.</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); setPage(1); setFilters({ ...draft }); }}>
      <label>From<input className="block rounded border p-2" type="date" value={draft.startDate} onChange={e => field("startDate", e.target.value)} /></label>
      <label>Through<input className="block rounded border p-2" type="date" value={draft.endDate} onChange={e => field("endDate", e.target.value)} /></label>
      <label>Action<input className="block rounded border p-2" maxLength={100} value={draft.action} placeholder="e.g. accounts_imported" onChange={e => field("action", e.target.value)} /></label>
      <label>Actor role<select className="block rounded border p-2" value={draft.actorRole} onChange={e => field("actorRole", e.target.value)}><option value="">All roles</option>{["dean", "student", "faculty", "system"].map(role => <option key={role}>{role}</option>)}</select></label>
      <label>Target reference<input className="block rounded border p-2" maxLength={24} value={draft.targetId} onChange={e => field("targetId", e.target.value)} /></label>
      <button className="rounded border px-3 py-2" type="submit">Apply filters</button>
    </form>
    {loading ? <p role="status">Loading audit records?</p> : error ? <p role="alert">{error}</p> : <>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Timestamp", "Actor / role", "Action", "Target", "Details"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
      <tbody>{data?.logs.map(log => <tr className="border-t" key={log.id}><td className="p-2">{new Date(log.createdAt).toLocaleString("en-PH", { timeZone: "Asia/Manila" })}</td><td className="p-2">{log.actor.id || log.actor.name}<br />{log.actor.role}</td><td className="p-2">{log.action}</td><td className="p-2">{log.relatedRecord ? log.relatedRecord.type + " " + log.relatedRecord.id : "Not recorded"}</td><td className="p-2"><pre className="whitespace-pre-wrap">{JSON.stringify({ ...log.metadata, ...log.changes }, null, 2)}</pre></td></tr>)}</tbody></table></div>
      {!data?.logs.length && <p>No audit records in this range.</p>}
      <div className="flex items-center gap-3"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {data?.pagination.pages || 1}</span><button disabled={page >= (data?.pagination.pages || 1)} onClick={() => setPage(page + 1)}>Next</button></div>
    </>}
  </section>;
}

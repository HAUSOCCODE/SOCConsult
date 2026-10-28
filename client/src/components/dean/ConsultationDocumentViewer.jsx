import { deanUiError } from "../../utils/deanUiErrors";
import { useEffect, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
export default function ConsultationDocumentViewer({ recordId, documents }) {
  const [state, setState] = useState({});
  const current = useRef(null);
  const urls = useRef([]);
  useEffect(() => { setState({}); return () => { current.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; }; }, [recordId]);
  async function view(document) {
    current.current?.abort();
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = [];
    const controller = new AbortController(); current.current = controller;
    setState({ loading: true, name: document.name });
    try {
      const path = document.documentId ? `documents/${document.documentId}` : "document";
      const response = await fetch(`${API_URL}/dean/consultations/${recordId}/${path}`, {
        headers: { Authorization: `Bearer ${sessionStorage.getItem("consultio_token") || ""}` }, signal: controller.signal,
      });
      if (!response.ok) throw Object.assign(new Error(), { status: response.status });
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob); urls.current.push(url);
      const type = blob.type;
      const text = type === "text/plain" ? await blob.text() : null;
      if (!controller.signal.aborted) setState({ url, name: document.name, type, text });
    } catch (error) { if (!controller.signal.aborted) setState({ error: deanUiError(error, "document") }); }
  }
  return <section aria-label="Supporting documents" className="space-y-3">
    <h3 className="font-bold">Supporting documents</h3>
    {!documents.length && <p>No supporting documents were provided.</p>}
    {documents.map((document, index) => <div key={document.documentId || index} className="flex flex-wrap items-center gap-3 rounded border p-3">
      <span className="break-all">{document.name}</span>
      <button type="button" className="btn-secondary" onClick={() => view(document)} disabled={state.loading}>View document</button>
    </div>)}
    {state.loading && <p role="status">Loading document…</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.url && state.type?.startsWith("image/") && <img src={state.url} alt={state.name} className="max-h-96 max-w-full object-contain" />}
    {state.url && state.type === "application/pdf" && <iframe sandbox="" referrerPolicy="no-referrer" title={state.name} src={state.url} className="h-96 w-full" />}
    {state.text !== null && state.text !== undefined && <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words">{state.text}</pre>}
    {state.url && <p><a className="font-semibold text-maroon-800 underline" href={state.url} download={state.name}>Download {state.name}</a> — authorized copy ready.</p>}
  </section>;
}

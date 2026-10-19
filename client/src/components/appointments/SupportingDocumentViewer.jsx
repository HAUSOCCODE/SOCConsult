import { isDeanManagementPath } from "../../utils/deanWorkspace";
import { useLocation } from "react-router-dom";
import { Download, Eye, FileText, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { useToast } from "../../context/ToastContext";
import { safeStudentError } from "../../utils/studentUiErrors";

const extension = (name = "") => name.split(".").pop()?.toLowerCase() || "";
const imageExtensions = new Set(["jpg", "jpeg", "png", "webp", "gif"]);
const videoExtensions = new Set(["mp4", "webm"]);

const previewKind = (mimeType = "", name = "") => {
  const mime = mimeType.toLowerCase();
  const ext = extension(name);
  if (mime.startsWith("image/") || imageExtensions.has(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === "text/plain" || ext === "txt") return "text";
  if (["video/mp4", "video/webm"].includes(mime) || videoExtensions.has(ext))
    return "video";
  return "unsupported";
};

const fileType = (mimeType = "", name = "") => {
  const ext = extension(name);
  const kind = previewKind(mimeType, name);
  const imageNames = {
    jpg: "JPEG Image",
    jpeg: "JPEG Image",
    png: "PNG Image",
    webp: "WebP Image",
    gif: "GIF Image",
  };
  if (kind === "image") return imageNames[ext] || "Image";
  if (kind === "pdf") return "PDF Document";
  if (kind === "text") return "Text Document";
  if (kind === "video") return ext === "webm" ? "WebM Video" : "MP4 Video";
  if (["doc", "docx"].includes(ext)) return "Microsoft Word Document";
  if (["xls", "xlsx"].includes(ext)) return "Microsoft Excel Workbook";
  if (["ppt", "pptx"].includes(ext)) return "Microsoft PowerPoint Presentation";
  if (ext === "csv") return "CSV Document";
  return mimeType || `${ext.toUpperCase() || "File"} Document`;
};

const formatSize = (size = 0) =>
  size < 1024 * 1024
    ? `${Math.max(1, Math.round(size / 1024))} KB`
    : `${(size / (1024 * 1024)).toFixed(2)} MB`;

const metadataFor = (appointment, management) =>
  appointment.supportingDocuments?.length
    ? appointment.supportingDocuments.map((document) => ({
        id: document._id,
        name: document.originalName,
        mimeType: document.mimeType,
        size: document.size,
        endpoint: `${management ? "/dean" : ""}/appointments/${appointment._id}/documents/${document._id}`,
      }))
    : appointment.supportingDocument?.name
      ? [
          {
            ...appointment.supportingDocument,
            endpoint: `${management ? "/dean" : ""}/appointments/${appointment._id}/document`,
          },
        ]
      : [];

export default function SupportingDocumentViewer({
  appointment,
  emptyMessage = "No supporting documents were provided.",
  wrapFileNames = false,
}) {
  const toast = useToast();
  const { pathname } = useLocation();
  const management = isDeanManagementPath(pathname);
  const documents = useMemo(() => metadataFor(appointment, management), [appointment, management]);
  const cache = useRef(new Map());
  const [previewTarget, setPreviewTarget] = useState(null);
  const [previewDocument, setPreviewDocument] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const load = async (document) => {
    if (cache.current.has(document.endpoint))
      return cache.current.get(document.endpoint);
    const response = await api(document.endpoint);
    const loaded = { ...document, ...response.supportingDocument };
    cache.current.set(document.endpoint, loaded);
    return loaded;
  };

  const preview = async (document) => {
    setPreviewTarget(document);
    setPreviewDocument(null);
    setPreviewError("");
    setPreviewLoading(true);
    try {
      setPreviewDocument(await load(document));
    } catch (error) {
      if (error.message === "Document is no longer available.")
        toast.error("Document is no longer available.");
      setPreviewError(
        error.message === "Document is no longer available."
          ? "Document is no longer available."
          : safeStudentError(error, "Unable to preview this file."),
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const download = async (document) => {
    try {
      const loaded = await load(document);
      const link = window.document.createElement("a");
      link.href = loaded.data;
      link.download = loaded.name || document.name || "consultation-document";
      if (/^https?:\/\//i.test(loaded.data)) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      link.click();
    } catch (error) {
      toast.error(
        error.message === "Document is no longer available."
          ? "Document is no longer available."
          : "Unable to download this file.",
      );
    }
  };

  const closePreview = () => {
    setPreviewTarget(null);
    setPreviewDocument(null);
    setPreviewError("");
  };

  if (!documents.length)
    return <p className="text-sm text-slate-600">{emptyMessage}</p>;
  return (
    <>
      <div className="space-y-3">
        {documents.map((document, index) => {
          const kind = previewKind(document.mimeType, document.name);
          return (
            <article
              key={document.id || `${document.name}-${index}`}
              className="flex min-w-0 flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center"
            >
              <FileText className="shrink-0 text-maroon-700" size={24} />
              <div className="min-w-0 flex-1">
                <p
                  className={`${wrapFileNames ? "whitespace-normal [overflow-wrap:anywhere]" : "truncate"} font-semibold text-slate-900`}
                  title={document.name}
                >
                  {documents.length > 1 ? `${index + 1}. ` : ""}
                  {document.name}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {fileType(document.mimeType, document.name)} ·{" "}
                  {formatSize(document.size)}
                </p>
                {kind === "unsupported" && (
                  <p className="mt-1 text-xs text-slate-500">
                    Preview not available for this file type.
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {kind !== "unsupported" && (
                  <button
                    type="button"
                    onClick={() => preview(document)}
                    className="btn-secondary inline-flex items-center gap-2"
                  >
                    <Eye size={16} />
                    Preview
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => download(document)}
                  className="btn-secondary inline-flex items-center gap-2"
                >
                  <Download size={16} />
                  {kind === "unsupported" ? "Download Document" : "Download"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {previewTarget && (
        <DocumentPreviewModal
          metadata={previewTarget}
          document={previewDocument}
          loading={previewLoading}
          error={previewError}
          onClose={closePreview}
          onDownload={() => download(previewTarget)}
        />
      )}
    </>
  );
}

function DocumentPreviewModal({
  metadata,
  document,
  loading,
  error,
  onClose,
  onDownload,
}) {
  const kind = previewKind(metadata.mimeType, metadata.name);
  useEffect(() => {
    const previousOverflow = window.document.body.style.overflow;
    const escape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.document.body.style.overflow = "hidden";
    window.document.addEventListener("keydown", escape, true);
    return () => {
      window.document.body.style.overflow = previousOverflow;
      window.document.removeEventListener("keydown", escape, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/70 p-0 sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="document-preview-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="flex h-full w-full flex-col overflow-hidden bg-white sm:max-h-[95vh] sm:max-w-6xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h3
              id="document-preview-title"
              className="truncate font-bold text-maroon-900"
              title={metadata.name}
            >
              {metadata.name}
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {fileType(metadata.mimeType, metadata.name)} ·{" "}
              {formatSize(metadata.size)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close document preview"
            className="shrink-0 rounded-lg p-1 text-slate-500 hover:bg-slate-100"
          >
            <X />
          </button>
        </header>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-900 p-3 sm:p-5">
          {loading ? (
            <p className="font-semibold text-white">Loading preview...</p>
          ) : error ? (
            <p className="rounded-xl bg-white p-5 text-red-700">
              Unable to preview this file.
            </p>
          ) : document ? (
            <PreviewContent kind={kind} document={document} />
          ) : null}
        </div>
        <footer className="flex shrink-0 justify-end border-t border-slate-200 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={onDownload}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Download size={16} />
            {kind === "image"
              ? "Download Image"
              : kind === "pdf"
                ? "Download PDF"
                : kind === "video"
                  ? "Download Video"
                  : "Download Text File"}
          </button>
        </footer>
      </section>
    </div>,
    window.document.body,
  );
}

function PreviewContent({ kind, document }) {
  if (kind === "image")
    return (
      <img
        src={document.data}
        alt={document.name}
        className="max-h-[80vh] max-w-full object-contain"
      />
    );
  if (kind === "pdf")
    return (
      <iframe
        title={document.name || "PDF document"}
        src={document.data}
        className="h-full min-h-[70vh] w-full rounded-lg bg-white"
      />
    );
  if (kind === "video")
    return (
      <video
        controls
        preload="metadata"
        className="max-h-[80vh] max-w-full rounded-xl"
      >
        <source src={document.data} type={document.mimeType} />
      </video>
    );
  if (kind === "text") {
    if (/^https?:\/\//i.test(document.data))
      return (
        <iframe
          title={document.name || "Text document"}
          src={document.data}
          className="h-full min-h-[70vh] w-full rounded-lg bg-white"
        />
      );
    try {
      const encoded = document.data.split(",")[1] || "";
      const bytes = Uint8Array.from(atob(encoded), (character) =>
        character.charCodeAt(0),
      );
      const text = new TextDecoder().decode(bytes);
      return (
        <pre className="max-h-[80vh] w-full overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-white p-6 font-mono text-sm text-slate-900">
          {text}
        </pre>
      );
    } catch {
      return (
        <p className="rounded-xl bg-white p-5 text-red-700">
          Unable to preview this file.
        </p>
      );
    }
  }
  return null;
}

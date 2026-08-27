import { Pencil, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import ProfileImagePreview from "./ProfileImagePreview";

const MAX_SIZE = 4 * 1024 * 1024;
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const allowedExtensions = new Set(["jpg", "jpeg", "png", "webp"]);

export default function ProfilePictureEditor() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const inputRef = useRef(null);
  const [selection, setSelection] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(
    () => () => selection?.preview && URL.revokeObjectURL(selection.preview),
    [selection],
  );

  const resetDialog = () => {
    setSelection(null);
    setRemoving(false);
    if (inputRef.current) inputRef.current.value = "";
  };
  const close = () => {
    if (!busy) resetDialog();
  };
  const choose = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!allowedTypes.has(file.type) || !allowedExtensions.has(extension)) {
      toast.error("Please select a valid image file.");
      event.target.value = "";
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error("Profile picture must be 4 MB or smaller.");
      event.target.value = "";
      return;
    }
    setSelection({ file, preview: URL.createObjectURL(file) });
  };
  const save = async () => {
    if (!selection || busy) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.append("photo", selection.file);
      const data = await api("/auth/me/profile-picture", {
        method: "PATCH",
        body,
      });
      updateUser(data.user);
      toast.success("Profile picture updated successfully.");
      setBusy(false);
      resetDialog();
    } catch (error) {
      toast.error(error.message || "Unable to upload profile picture.");
      setBusy(false);
    }
  };
  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await api("/auth/me/profile-picture", { method: "DELETE" });
      updateUser(data.user);
      toast.success("Profile picture removed successfully.");
      setBusy(false);
      resetDialog();
    } catch (error) {
      toast.error(error.message || "Unable to remove profile picture.");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex shrink-0 flex-col items-center gap-3">
        <div className="relative">
          <ProfileImagePreview
            user={user}
            className="h-24 w-24 rounded-2xl bg-maroon-800 text-3xl font-bold text-gold-300 shadow-lg ring-4 ring-maroon-100 md:h-20 md:w-20"
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            aria-label="Change profile photo"
            className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border border-slate-200 bg-white text-maroon-800 shadow-md md:hidden"
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="btn-action-sm gap-1.5"
        >
          <Pencil size={13} aria-hidden="true" className="md:hidden" />
          Change Photo
        </button>
        {user.profilePicture && (
          <button
            type="button"
            onClick={() => setRemoving(true)}
            className="btn-danger-action-sm"
          >
            Remove Photo
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          onChange={choose}
          className="sr-only"
        />
      </div>
      {(selection || removing) &&
        createPortal(
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 p-3 sm:p-4"
            onMouseDown={(event) =>
              event.target === event.currentTarget && close()
            }
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="profile-picture-title"
              onMouseDown={(event) => event.stopPropagation()}
              className="max-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-md overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl sm:max-h-[90vh] sm:p-6"
            >
              <div className="flex items-start justify-between gap-4">
                <h2
                  id="profile-picture-title"
                  className="text-xl font-bold text-maroon-900"
                >
                  {removing
                    ? "Remove Profile Picture?"
                    : "Change Profile Picture"}
                </h2>
                <button
                  type="button"
                  aria-label="Close profile picture dialog"
                  disabled={busy}
                  onClick={() => close()}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                >
                  <X />
                </button>
              </div>
              {removing ? (
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  Your profile will return to the default initial avatar.
                </p>
              ) : (
                <div className="mt-6 grid place-items-center">
                  <img
                    src={selection.preview}
                    alt="Selected profile preview"
                    className="h-56 w-56 max-w-full rounded-2xl object-cover shadow-md ring-1 ring-slate-200"
                  />
                </div>
              )}
              <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => close()}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={removing ? remove : save}
                  className={
                    removing
                      ? "rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
                      : "btn-primary disabled:opacity-60"
                  }
                >
                  {busy
                    ? removing
                      ? "Removing..."
                      : "Uploading..."
                    : removing
                      ? "Remove"
                      : "Save Photo"}
                </button>
              </div>
            </section>
          </div>,
          window.document.body,
        )}
    </>
  );
}

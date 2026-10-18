import useDialogFocus from "../../hooks/useDialogFocus";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import UserAvatar from "./UserAvatar";
import { formatPersonName } from "../../utils/formatPersonName";

export default function ProfileImagePreview({
  user,
  className = "",
  buttonClassName = "",
}) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);
  const source = user?.profilePicture;

  useDialogFocus(dialogRef, { open, onClose: () => setOpen(false) });

  if (!source) return <UserAvatar user={user} className={className} />;

  return (
    <>
      <button
        type="button"
        aria-label={`View ${formatPersonName(user) || "user"} profile picture`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={`shrink-0 cursor-pointer rounded-xl focus:outline-none focus:ring-2 focus:ring-maroon-400 ${buttonClassName}`}
      >
        <UserAvatar user={user} className={className} />
      </button>
      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[10020] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/80 p-3 sm:p-6"
            onMouseDown={(event) =>
              event.target === event.currentTarget && setOpen(false)
            }
          >
            <section
              ref={dialogRef} tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={`${formatPersonName(user) || "User"} profile picture preview`}
              className="relative flex max-h-[92vh] max-w-[94vw] items-center justify-center rounded-2xl bg-slate-950/80 p-3 shadow-2xl sm:p-5"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                aria-label="Close profile picture preview"
                onClick={() => setOpen(false)}
                className="absolute right-2 top-2 z-10 grid h-10 w-10 place-items-center rounded-full bg-white text-slate-800 shadow-lg hover:bg-slate-100 sm:right-3 sm:top-3"
              >
                <X aria-hidden="true" size={22} />
              </button>
              <img
                src={source}
                alt={`${formatPersonName(user) || "User"} profile`}
                className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain"
              />
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}

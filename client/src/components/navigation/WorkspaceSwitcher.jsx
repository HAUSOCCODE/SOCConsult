import { useLocation, useNavigate } from "react-router-dom";
import { deanWorkspace } from "../../utils/deanWorkspace";

export default function WorkspaceSwitcher() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return (
    <label className="block min-w-0 text-xs font-semibold text-slate-600">
      Workspace
      <select
        className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-maroon-900 focus-visible:ring-2 focus-visible:ring-gold-400"
        value={deanWorkspace(pathname, search)}
        onChange={(event) =>
          navigate(
            event.target.value === "faculty"
              ? "/dean/faculty/dashboard"
              : "/dean/dashboard",
          )
        }
      >
        <option value="management">Dean Management</option>
        <option value="faculty">My Faculty Workspace</option>
      </select>
    </label>
  );
}

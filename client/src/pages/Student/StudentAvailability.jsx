import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/apiClient";
import StudentAvailabilityForm from "../../components/student/StudentAvailabilityForm";
import StudentAvailabilityList from "../../components/student/StudentAvailabilityList";
import { ErrorState, Loading } from "../../components/UI";
import { useToast } from "../../context/ToastContext";

export default function StudentAvailability() {
  const toast = useToast();
  const [availability, setAvailability] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [editing, setEditing] = useState(null);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api("/student-availability");
      setAvailability(Array.isArray(data?.availability) ? data.availability : []);
      setLoadError("");
    } catch {
      setAvailability([]);
      setLoadError("Unable to load your availability. Please try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateActive = async (item) => {
    setBusyId(item._id);
    try {
      const data = await api(`/student-availability/${item._id}`, {
        method: "PUT",
        body: JSON.stringify({ isActive: !item.isActive }),
      });
      toast.success(data.message);
      await load();
    } catch (error) {
      toast.error(error.message || "Unable to update availability.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (item) => {
    setBusyId(item._id);
    try {
      const data = await api(`/student-availability/${item._id}`, {
        method: "DELETE",
      });
      if (editing?._id === item._id) setEditing(null);
      toast.success(data.message);
      await load();
    } catch (error) {
      toast.error(error.message || "Unable to delete availability.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="w-full min-w-0 space-y-5 pb-16">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">My Availability</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Your availability is private and is used only to suggest compatible
          Faculty consultation schedules. You may still book a Faculty slot
          even if you do not provide availability.
        </p>
      </header>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)] lg:items-start">
        <StudentAvailabilityForm
          editing={editing}
          onCancel={() => setEditing(null)}
          onSaved={async (message) => {
            setEditing(null);
            toast.success(message);
            await load();
          }}
        />
        {availability === null ? (
          <Loading />
        ) : loadError ? (
          <ErrorState message={loadError} onRetry={load} />
        ) : (
          <StudentAvailabilityList
            availability={availability}
            busyId={busyId}
            onEdit={setEditing}
            onToggle={updateActive}
            onDelete={remove}
          />
        )}
      </div>
    </div>
  );
}

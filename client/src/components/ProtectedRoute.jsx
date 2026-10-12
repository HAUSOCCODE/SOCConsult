import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
export default function ProtectedRoute({ role }) {
  const { user, loading } = useAuth();
  const allowedRoles = Array.isArray(role) ? role : [role];
  if (loading)
    return (
      <div className="grid min-h-screen place-items-center text-maroon-800">
        Loading SOCConsult…
      </div>
    );
  if (!user) return <Navigate to={`/${allowedRoles[0]}/login`} replace />;
  if (!allowedRoles.includes(user.role))
    return <Navigate to={`/${user.role}/dashboard`} replace />;
  return <Outlet />;
}

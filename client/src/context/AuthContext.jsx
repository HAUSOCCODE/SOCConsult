import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../api/apiClient";
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    // Remove the legacy persistent ConsultIO token without touching unrelated storage.
    localStorage.removeItem("consultio_token");
    const token = sessionStorage.getItem("consultio_token");
    const storedUser = sessionStorage.getItem("consultio_user");
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    api("/auth/me")
      .then(({ user }) => setUser(user))
      .catch((error) => {
        if (error.status === 401 && storedUser) {
          try {
            if (JSON.parse(storedUser).role === "student")
              sessionStorage.setItem(
                "socconsult_student_session_message",
                "Your session has expired. Please log in again.",
              );
          } catch {
            // Invalid cached user data is cleared with the expired session.
          }
        }
        sessionStorage.removeItem("consultio_token");
        sessionStorage.removeItem("consultio_user");
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);
  const login = async (role, credentials) => {
    const data = await api(`/auth/login/${role}`, {
      method: "POST",
      body: JSON.stringify(credentials),
    });
    sessionStorage.setItem("consultio_token", data.token);
    sessionStorage.setItem("consultio_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  };
  const logout = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await api("/auth/logout", { method: "POST", signal: controller.signal });
    } catch {
      // Local sign-out must complete even when the audit endpoint is unavailable.
    } finally {
      clearTimeout(timeout);
      sessionStorage.removeItem("consultio_token");
      sessionStorage.removeItem("consultio_user");
      setUser(null);
    }
  };
  const updateUser = (nextUser) => {
    sessionStorage.setItem("consultio_user", JSON.stringify(nextUser));
    setUser(nextUser);
  };
  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);

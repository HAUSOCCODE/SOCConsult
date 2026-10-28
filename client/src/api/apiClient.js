const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
const expireSession = (token) => {
  if (!token || sessionStorage.getItem("consultio_token") !== token) return;
  const storedUser = sessionStorage.getItem("consultio_user");
  try {
    if (JSON.parse(storedUser || "null")?.role === "student")
      sessionStorage.setItem(
        "socconsult_student_session_message",
        "Your session has expired. Please sign in again.",
      );
  } catch {
    // Invalid cached identity is removed with the expired session.
  }
  sessionStorage.removeItem("consultio_token");
  sessionStorage.removeItem("consultio_user");
  window.dispatchEvent(new Event("auth:session-expired"));
};
export async function api(path, options = {}) {
  const token = sessionStorage.getItem("consultio_token");
  const isFormData = options.body instanceof FormData;
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(!isFormData && { "Content-Type": "application/json" }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || "Request failed.");
    error.status = response.status;
    error.errors = data.errors || null;
    error.code = data.code || null;
    error.data = data;
    const retryAfter = Number(
      data.retryAfter || response.headers.get("Retry-After"),
    );
    if (Number.isFinite(retryAfter) && retryAfter > 0)
      error.retryAfter = Math.ceil(retryAfter);
    if (response.status === 401) expireSession(token);
    throw error;
  }
  return data;
}

api.download = async function download(path, options = {}) {
  const token = sessionStorage.getItem("consultio_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const contentType = response.headers.get("Content-Type") || "";
    const data = contentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};
    const error = new Error(data.message || "Unable to download the file.");
    error.status = response.status;
    error.code = data.code || null;
    if (response.status === 401) expireSession(token);
    throw error;
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const filenameMatch = disposition.match(/filename="([^"\r\n]+)"/i);
  return {
    blob: await response.blob(),
    filename: filenameMatch?.[1] || "",
    total: response.headers.has("X-Report-Total") ? Number(response.headers.get("X-Report-Total")) : null,
  };
};

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
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
    throw error;
  }
  return data;
}

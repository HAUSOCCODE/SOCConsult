export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";

const DEPRECATED_MODEL_REPLACEMENTS = new Map([
  ["llama-3.3-70b-versatile", DEFAULT_GROQ_MODEL],
  ["llama-3.1-8b-instant", "openai/gpt-oss-20b"],
]);

export function getGroqModel() {
  const configured = String(process.env.GROQ_MODEL || "").trim();
  if (!configured) return DEFAULT_GROQ_MODEL;
  return DEPRECATED_MODEL_REPLACEMENTS.get(configured) || configured;
}

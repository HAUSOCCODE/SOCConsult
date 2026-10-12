import { answerDeanQuestion } from "../services/groqService.js";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 8;

const retryAfterSeconds = (error) => {
  const value = Number(error?.headers?.get?.("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : 30;
};

export function classifyDeanAiError(error) {
  if (error?.status === 429)
    return {
      status: 503,
      code: "GROQ_RATE_LIMIT",
      message:
        "SOCConsult AI Assistant has temporarily reached its AI usage limit. Please wait a moment and try again.",
      retryAfter: retryAfterSeconds(error),
    };
  if (
    [
      "AI_TOOL_LIMIT",
      "AI_TOOL_LOOP",
      "AI_MALFORMED_TOOL_CALL",
      "AI_TOOL_ARGUMENT_ERROR",
    ].includes(error?.code)
  )
    return {
      status: 422,
      code: error.code === "AI_TOOL_LIMIT" ? "AI_TOOL_LIMIT" : "AI_QUERY_ERROR",
      message:
        "I couldn't complete that SOCConsult query. Please rephrase the question and try again.",
    };
  if (error?.code === "AI_UNSUPPORTED_TOOL")
    return {
      status: 422,
      code: "AI_UNSUPPORTED_TOOL",
      message: "I don't currently have a reporting tool for that information.",
    };
  if (error?.code === "AI_DATABASE_ERROR")
    return {
      status: 503,
      code: "AI_DATABASE_ERROR",
      message:
        "I couldn't retrieve SOCConsult data right now. Please try again.",
    };
  if (
    error?.name === "APIConnectionTimeoutError" ||
    error?.code === "ETIMEDOUT" ||
    /timeout/i.test(error?.message || "")
  )
    return {
      status: 504,
      code: "AI_TIMEOUT",
      message: "SOCConsult AI Assistant timed out. Please try again.",
    };
  if (
    error?.code === "AI_NOT_CONFIGURED" ||
    [400, 401, 403, 404].includes(error?.status)
  )
    return {
      status: 503,
      code: "AI_CONFIGURATION_ERROR",
      message: "SOCConsult AI Assistant is temporarily unavailable.",
    };
  return {
    status: 503,
    code: "AI_UPSTREAM_ERROR",
    message: "SOCConsult AI Assistant is temporarily unavailable.",
  };
}

const cleanMessage = (value) => {
  if (typeof value !== "string") return null;
  const content = value.trim();
  return content && content.length <= MAX_MESSAGE_LENGTH ? content : null;
};

const cleanHistory = (value) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_HISTORY_MESSAGES) return null;
  const result = [];
  for (const item of value) {
    if (!item || !["user", "assistant"].includes(item.role)) return null;
    const content = cleanMessage(item.content);
    if (!content) return null;
    result.push({ role: item.role, content });
  }
  return result;
};

export async function chatWithAi(req, res) {
  const message = cleanMessage(req.body?.message);
  const history = cleanHistory(req.body?.history);
  if (!message)
    return res.status(400).json({
      message: `Message is required and must be at most ${MAX_MESSAGE_LENGTH} characters.`,
    });
  if (!history)
    return res.status(400).json({
      message: `History must contain at most ${MAX_HISTORY_MESSAGES} valid user or assistant messages.`,
    });

  try {
    const answer = await answerDeanQuestion({ message, history });
    return res.json({
      success: true,
      answer,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const classified = classifyDeanAiError(error);
    console.warn(`[Dean AI] ${classified.code}`);
    if (classified.retryAfter)
      res.set("Retry-After", String(classified.retryAfter));
    return res.status(classified.status).json({
      message: classified.message,
      ...(classified.retryAfter ? { retryAfter: classified.retryAfter } : {}),
    });
  }
}

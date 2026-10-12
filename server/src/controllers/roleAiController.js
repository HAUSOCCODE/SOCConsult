import { answerRoleQuestion } from "../services/roleAiService.js";
import { classifyDeanAiError } from "./aiController.js";

const cleanMessage = (value) => typeof value === "string" && value.trim() && value.trim().length <= 2000 ? value.trim() : null;
const cleanHistory = (value) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) return null;
  const result = [];
  for (const item of value) {
    const content = cleanMessage(item?.content);
    if (!content || !["user", "assistant"].includes(item?.role)) return null;
    result.push({ role: item.role, content });
  }
  return result;
};

export const chatWithRoleAi = (role) => async (req, res) => {
  const message = cleanMessage(req.body?.message);
  const history = cleanHistory(req.body?.history);
  if (!message) return res.status(400).json({ message: "Message is required and must be at most 2000 characters." });
  if (!history) return res.status(400).json({ message: "History must contain at most 8 valid user or assistant messages." });
  try {
    const answer = await answerRoleQuestion({ role, userId: req.user._id, message, history });
    return res.json({ success: true, answer, generatedAt: new Date().toISOString() });
  } catch (error) {
    const result = classifyDeanAiError(error);
    console.warn(
      `[${role === "student" ? "Student" : "Faculty"} AI] ${result.code}`,
      {
        upstreamStatus: error?.status || null,
        upstreamCode: error?.error?.code || error?.code || null,
        upstreamType: error?.error?.type || error?.name || null,
      },
    );
    if (result.retryAfter) res.set("Retry-After", String(result.retryAfter));
    return res.status(result.status).json({ message: result.message, ...(result.retryAfter ? { retryAfter: result.retryAfter } : {}) });
  }
};

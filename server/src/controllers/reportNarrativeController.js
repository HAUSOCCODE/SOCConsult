import { createNarrative, readNarrative, reviewNarrative } from "../services/reportNarrativeService.js";
const handle = (work) => async (req, res) => {
  try {
    if (Object.keys(req.query).length) return res.status(400).json({ message: "Invalid narrative request." });
    const result = await work(req);
    return res.json(result);
  } catch (error) {
    const status = [400, 403, 404, 409, 413].includes(error.statusCode) ? error.statusCode : 503;
    if (error?.status === 429) res.set("Retry-After", "60");
    return res.status(status).json({ message: status === 409 ? "This narrative has already been reviewed or its version changed. Reload it before continuing." : status === 503 ? "AI summary is temporarily unavailable. PDF reports remain available." : status === 413 ? "Narrative request exceeds safety limits. Narrow the filters." : "Invalid or unauthorized narrative request." });
  }
};
export const postNarrative = handle(req => createNarrative(req.body, req.user));
export const getNarrative = handle(req => { if (req.body !== undefined && Object.keys(req.body).length) throw Object.assign(new Error(), { statusCode: 400 }); return readNarrative(req.params.id, req.user); });
export const postNarrativeReview = handle(req => reviewNarrative(req.params.id, req.body, req.user));

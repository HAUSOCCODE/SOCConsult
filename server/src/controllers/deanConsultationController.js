import { listConsultations, consultationDetails, consultationFilterOptions } from "../services/deanConsultationService.js";
import { authorizedDocument, documentContent, documentHeaders } from "../services/appointmentDocumentAuthorizationService.js";

const handle = work => async (req, res) => {
  res.set("Cache-Control", "no-store");
  try { await work(req, res); }
  catch (error) {
    const status = [400, 404].includes(error.statusCode) ? error.statusCode : 503;
    res.status(status).json({ message: status === 400 ? "Invalid consultation filters or reference." : status === 404 ? "Consultation or document not found or unavailable." : "Consultation monitoring is temporarily unavailable. Please try again." });
  }
};
export const getConsultations = handle(async (req, res) => res.json(await listConsultations(req.query)));
export const getConsultationOptions = handle(async (req, res) => res.json(await consultationFilterOptions(req.query)));
export const getConsultation = handle(async (req, res) => {
  if (Object.keys(req.query).length) throw Object.assign(new Error(), { statusCode: 400 });
  res.json(await consultationDetails(req.params.consultationId));
});
export const getConsultationDocument = handle(async (req, res) => {
  if (Object.keys(req.query).length) throw Object.assign(new Error(), { statusCode: 400 });
  const document = await authorizedDocument({ id: req.params.consultationId || req.params.id, documentId: req.params.documentId, user: req.user, management: true });
  const bytes = await documentContent(document);
  res.set(documentHeaders(document)).send(bytes);
});

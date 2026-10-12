import dotenv from "dotenv";

dotenv.config();

export const env = {
  port: Number(process.env.PORT) || 5000,
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  clientUrl:
    process.env.CLIENT_URL ||
    (process.env.NODE_ENV === "production"
      ? undefined
      : "http://localhost:5173"),
  studentDomain: (
    process.env.STUDENT_EMAIL_DOMAIN || "student.hau.edu.ph"
  )
    .trim()
    .toLowerCase(),
  facultyDomain: (
    process.env.FACULTY_EMAIL_DOMAIN || "hau.edu.ph"
  )
    .trim()
    .toLowerCase(),
  deanUsername: (process.env.DEAN_USERNAME || process.env.ADMIN_USERNAME || "admin").trim().toLowerCase(),
  deanPassword: process.env.DEAN_PASSWORD || process.env.ADMIN_PASSWORD,
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME,
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY,
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET,
};

export function validateEnv() {
  const missing = [
    "mongoUri",
    "jwtSecret",
    "deanPassword",
    "clientUrl",
    "cloudinaryCloudName",
    "cloudinaryApiKey",
    "cloudinaryApiSecret",
  ].filter((key) => !env[key]);
  if (missing.length)
    throw new Error(`Missing server environment values: ${missing.join(", ")}`);
}

# SOCConsult

MERN-based faculty-student consultation and appointment scheduling system.

## CSV account template (DEA-05)

The Dean Import page at `/dean/import` provides the project-defined sample
template for development and testing. The sample is publicly downloadable at
`/templates/socconsult-account-import-template.csv` as a static Vite asset. It
contains only sample data, with no credentials or private records.

The canonical definition is `server/src/config/csvAccountFields.js`. Include
all six header columns in this exact order:

```csv
institutional_id,first_name,middle_name,last_name,official_email,role
202600001,Juan,Dela Cruz,Santos,juansantos@student.hau.edu.ph,student
FAC-001,Maria,,Reyes,mreyes@hau.edu.ph,faculty
```

| Column           | Value requirement | Description                                                           |
| ---------------- | ----------------- | --------------------------------------------------------------------- |
| institutional_id | Required          | Institutional ID stored strictly as a string; preserve leading zeros. |
| first_name       | Required          | First name.                                                           |
| middle_name      | Optional          | Middle name; an empty value is valid.                                 |
| last_name        | Required          | Last name.                                                            |
| official_email   | Required          | Official email address, normalized to lowercase.                      |
| role             | Required          | Only `student` or `faculty`; never `dean` or any unsupported role.    |

Trim surrounding whitespace from headers and values. Header normalization
lowercases names and replaces runs of whitespace or hyphens with underscores
(for example, `Official Email` becomes `official_email`). Unknown columns are
not aliases or replacements for required columns; no camelCase aliases or
external-system mappings are defined. Email addresses and roles are lowercased;
name casing and internal whitespace are preserved. Never parse institutional
IDs as numbers. When editing CSV files in spreadsheet software, keep the ID
column formatted as text to preserve leading zeros before export.

The helpers accept string inputs only and reject unknown value-field names.
Normalization is not row validation: required values containing only whitespace
normalize to an empty string and must be rejected when validation is implemented
in DEA-06. The role membership helper rejects unsupported roles.

This task defines the format and download only. CSV upload parsing, validation,
and preview belong to DEA-06; database writes and bulk account creation belong
to DEA-07. Mapping these six CSV fields to complete User records, generating
initial passwords, and determining account lifecycle behavior belong to DEA-06
and DEA-07. The current model uses `studentId` or `employeeId`, camelCase name
fields, and `email`; it also requires `name` and `password`. Public registration is removed. Student and Faculty accounts are provisioned through CSV import or Dean manual creation. Account sources and approval metadata remain internal legacy compatibility.

SOCConsult does not connect directly to Campus++. Campus++ is only an external
source from which an authorized administrator may export a CSV. Its actual
column names are not assumed; column mapping must be updated after an authorized
sample export becomes available.

DEA-18 removes public account registration. Active accounts can sign in with
Approved or missing/null legacy registration state; explicit Pending, Rejected,
or unknown states are denied. Login, session validation, startup, and account
activation do not fill or approve legacy registration state. Existing accounts
using only old boolean flags need separately reviewed reconciliation. See
[DEA-18](server/DEA18.md) for retained history, aliases, and validation results.

## Setup

1. Open `server/.env` and provide MongoDB and secure secret values.
2. Run `npm install`, `npm install --prefix client`, and `npm install --prefix server`.
3. Run `npm run dev`.

The client runs on `http://localhost:5173` and API on `http://localhost:5000`.

## Dean account and CORE-01 migration

The roles are `student`, `faculty`, and `dean`. Dean sign-in uses a **username** at
`/dean/login`; there is no public Dean registration. The same session can open
the personal consultation workspace at `/faculty/dashboard`. Students can book
a Dean's published availability without changing the Dean's role.

Configure `DEAN_USERNAME` and `DEAN_PASSWORD` in the deployment environment.
`ADMIN_USERNAME` and `ADMIN_PASSWORD` remain temporary fallbacks, independently
for each value; the preferred `DEAN_*` value wins when both are present. Without
either username variable, the legacy default username `admin` is retained.
These variables do not rename an existing account or reset its password.

Before deploying, back up the database and pause application instances while
running the migration. Provide `MONGODB_URI` and the existing account username
through `DEAN_USERNAME` (or `ADMIN_USERNAME`) in the execution environment:

```sh
node server/scripts/migrate-admin-to-dean.mjs
```

The script deliberately does not load `.env` and needs no password variable.
It converts the configured legacy account in place, retaining its ID, username,
password hash, and references. It creates no accounts. If another management
account exists, or the username belongs to another role, it stops before updates;
resolve that conflict manually. An already-Dean account needs no conversion.
Reruns finish any interrupted metadata updates safely. Approval-method metadata
changes to `dean`; historical audit actions, descriptions, and timestamps remain,
with the previous actor role retained in `metadata.legacyActorRole`.

Database initialization uses the same conflict checks and conversion before
creating a configured Dean account when none exists. Production bootstrap also
requires `DEAN_PASSWORD` or its legacy fallback. Keep credentials out of source
control and command output.

Management API consumers must use `/api/dean/*` and `/api/dashboard/dean`.
Old `/api/admin/*` paths return 404, including mutations; no API redirects are
installed. Old frontend `/admin/*` routes are removed. Historical notification destinations are normalized to allowlisted current Dean routes when read; stored records are preserved.
School-wide document access lives under `/api/dean/consultations/*` (read-only `/api/dean/appointments/*` aliases remain temporarily); personal
`/api/appointments/*` document access requires consultation ownership.

### Dean password reset (DEA-10)

An authenticated Dean can POST `/api/dean/users/:id/reset-password` with no body
(or an empty JSON object) and `If-Match: "<version>"`, using the neutral `version`
from the user list. A missing legacy version is sent as `If-Match: "null"`.
The version is for concurrency checks only and is not displayed. Refresh after
conflicts or uncertain commits; do not automatically resubmit a reset.

Only Active or Inactive Student/Faculty accounts with Approved registration or
missing legacy registration state qualify. Registration and account status are
preserved. Inactive accounts remain unable to sign in. The canonical institutional
ID is used exactly as stored; only an absent canonical field permits the matching
legacy studentId/employeeId fallback. Invalid canonical IDs are rejected.

Passwords use bcrypt cost 12 with a maximum of 72 UTF-8 bytes. The reset updates
passwordResetAt and passwordChangedAt together and records a credential-free Dean
audit in the same required MongoDB transaction. There is no standalone fallback,
credential response, email, or forced password change.

Existing JWTs remain valid until their normal eight-hour expiry, subject to the
existing account checks. New sign-ins immediately require the reset password.
Future session revocation should be implemented as a separate authentication task.
Transaction rollback and concurrency should also be verified on an isolated test
replica set; the automated tests simulate transactions without database access.

## Dean Management Dashboard (DEA-04)

`GET /api/dashboard/dean` is a read-only, active-Dean-authorized, no-store summary.
This deployment is exclusively for authorized School of Computing users and
records; the connected SOCConsult database defines that dataset. Optional program
fields are not a reliable school boundary. DEA-04 does not add tenant isolation.

The default period is the current Asia/Manila calendar month. Optional `start`
and `end` must both be valid YYYY-MM-DD dates spanning at most 366 inclusive days.
Appointment totals and exact Pending/Completed counts use request `createdAt`,
including unscheduled requests, with inclusive Manila dates and an exclusive UTC
upper boundary. Confirmed, Awaiting Attendance Update, Attendance Review, and
Expired statistics remain deferred until the revised workflow supports them.

Current account totals require the exact student/faculty role, Active status,
and Approved or missing/null legacy registration status. Pending, Rejected, and
unknown registration statuses are excluded; Dean accounts never count as Faculty.
Recent consultations are the five latest updated records requested within the
period. Recent imports are the five latest completed batches across all dates.
Both lists expose only explicit summary fields, without credentials, uploaded
rows/documents, meeting links, private availability, or preview metadata.

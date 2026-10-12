# SOCConsult

MERN-based faculty-student consultation and appointment scheduling system.

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
installed. Old frontend `/admin/*` links redirect to the matching Dean path.
School-wide document access lives under `/api/dean/appointments/*`; personal
`/api/appointments/*` document access requires consultation ownership.

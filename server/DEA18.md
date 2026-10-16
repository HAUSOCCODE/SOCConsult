# DEA-18: Remove old Admin and registration features

Public Student/Faculty registration is removed. Sign-in pages direct account
access questions to the Dean; CSV and manual provisioning remain available.
Current authorization roles are exactly Student, Faculty, and Dean.

## Removed

- `client/src/pages/Auth/FacultyRegister.jsx` and registration branches in
  `AuthPageContent.jsx`, including forms, validation, API calls, links, and
  pending/rejected approval presentation.
- Frontend `/faculty/register`, `/dean/register`, `/dean/registrations`, and
  `/admin/*`. No Student registration page remains. Removed pages reach the
  existing not-found handling, without a registration compatibility redirect.
- `POST /api/auth/register/:role`, its controller, registration-only validators,
  and the unused `/api/dean/reports/user-registrations` endpoint/controller.
  Removed APIs return 404 for authenticated requests as applicable; no account
  creation or mutation redirects remain.
- Program Chair from suggested Faculty designations. Existing values display
  through the profile's custom designation fallback and are not rewritten.
- Active retired-status wording in Faculty discovery, appointment details,
  schedule participant labels, and obsolete dashboard labels.
- Unreferenced `scripts/e2e.mjs` and `scripts/expiration-e2e.mjs`. These live-DB
  scripts loaded developer configuration, used retired registration/approval
  APIs and appointment transitions, and were not invoked by package scripts.
  The isolated import/manual provisioning, canonical transition, expiration,
  attendance, document, audit, and account suites remain the validation paths.
  Replacement registration rejection and name-validation coverage is isolated.

No duplicate Consultation Overview/Appointments Management implementation or
general AI component remained to delete. DEA-11 and DEA-14 had removed them.

## Eligibility and preserved data

Login and authenticated sessions require an Active account with Approved or
missing/null registration state. Explicit Pending, Rejected, and unknown states
are denied with access-assistance wording. No account eligibility write occurs.
Startup no longer derives registration/account state from legacy boolean flags;
activation changes account status without filling missing registration state.
Old records containing only boolean flags require separately reviewed operator
reconciliation, rather than implicit approval or activation on startup.

`registrationStatus`, approval/rejection metadata, `self_registration` source,
and old boolean fields remain internal compatibility/provenance. Existing
Faculty eligibility queries and audit readers still depend on legacy state;
this cleanup does not globally broaden discovery or rewrite historical data.
Password-reset eligibility retains its existing stricter null-state contract.

## Explicit compatibility exceptions

Temporary until a verified rollout/migration:

- `/dean/appointments` and `/dean/consultation-overview` retain the DEA-11
  validated-query redirect to `/dean/consultations`.
- DEA-11 `/api/dean/appointments` list and document GET/HEAD aliases remain.
  Management mutations are rejected; no mutation alias or redirect is added.
- CORE-02 legacy status arrays, `(Legacy)` badges, filters, serializers,
  migration mappings, and historical status tests remain. Live migration
  completion has not been verified. Generic badges also serve account/import
  statuses, whose Approved value is unrelated to appointment Confirmed.
- `ADMIN_USERNAME`/`ADMIN_PASSWORD`, the default legacy username, and legacy
  management display-name normalization remain deployment compatibility.

Permanent historical/tooling support:

- Admin-to-Dean and appointment/account migration tooling, historical audit
  role/action interpretation, metadata policies, and their tests remain.
- `notificationService.js` maps exact historical Admin notification destinations
  for users/registrations, monitoring, reports, import, and Attendance Review to
  allowlisted current Dean destinations on read only. Unknown URLs, arbitrary
  queries/fragments, cross-role links, and traversal are rejected. Stored notices
  and audits are not rewritten; historical registration notices remain readable.
- Ordinary MongoDB `db.admin()`, access-permission terminology, and historical
  reschedule descriptions are unrelated technical/history usages.
- Dean Reports narrative models, panel, endpoints, aggregate data boundary,
  and the Groq `chat.completions` adapter remain active by design.

Earlier task manifests describe their implementation-time state. This document
supersedes their current registration and Admin frontend compatibility behavior.

## Validation and deployment follow-up

`test/obsoleteFeatures.test.js` verifies removed APIs, no account access/writes
from registration requests, CSV/manual/legacy login and session eligibility,
historical designation display, safe notification normalization, and active-source
assertions with explicit historical/migration/environment exceptions.
Structured-name validation is exercised through actual profile updates, including
optional middle names and field errors before writes. Existing provisioning tests
retain normalized names, ID uniqueness, transaction rollback and credential checks.

Use the isolated server runner and a production client build with `envDir: false`.
No live database, migration, processor, dependency installation, deployment,
commit, push, or pull request is part of this task. Separately verify browser
navigation and staging compatibility before rollout; remove temporary legacy
readers only after reviewed migration evidence establishes they are unnecessary.

Validation results: the complete isolated suite ran once (279 tests, 6 suites):
278 passed, with one stale source assertion expecting the removed registrations
redirect. That assertion was replaced with removal assertions and rendered-route
checks for removed registration/Admin pages. The affected layout/cleanup tests
then passed (10/10). Earlier focused provisioning/authentication/name/account/audit
checks also passed after corrections. The full suite was not repeated.
The client production build ran once and passed with the existing large-chunk
warning. Syntax checks passed for 19 changed JavaScript modules. Source searches
covered 256 code/test/script files; forbidden active registration/Admin redirect,
role authorization, and general AI route checks found no forbidden implementation.
Historical matches are covered by the exceptions above. `git diff --check` passed.

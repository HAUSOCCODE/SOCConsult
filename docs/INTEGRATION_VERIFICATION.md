# SOCConsult integration verification

## Scope and workflows

The public portal offers Student and Faculty sign-in. Dean sign-in is available directly at `/dean/login`. Consultations use participant and provider ownership, and Dean Management uses Dean-only authorization. The Dean's personal Faculty workspace uses the Dean's own user ID for availability, consultations and Faculty PDF reports.

- **Account provisioning** uses Dean Management for manual account creation or CSV preview and confirmation. Map headers where necessary, review invalid rows and conflicts, and confirm a valid Student or Faculty batch. The official email is the login and the institutional ID is the initial password. A Faculty successor must meet eligibility checks and change the initial password before promotion.
- **Consultations** can begin with a Student request or a Faculty invitation. An eligible participant responds and an approved consultation is scheduled. After the consultation, the applicable attendance policy governs reporting and disputes. The assigned provider can maintain a consultation record. History presents **Request Timed Out** for the canonical `Expired` status.
- **Availability and reporting** use Asia/Manila dates. Current and upcoming availability is shown separately from past schedules. End Semester Availability previews an inclusive date range by schedule start, requires confirmation and deactivates eligible schedules sequentially. The server checks ownership, reservations and versions on each update. History and personal PDF exports depend on the consultation's original provider ID.
- **Dean initialization and succession** use an installation marker and an explicit first bootstrap on an authorized empty database. The current Dean initiates succession from Dean Management Account Settings. One transaction updates the roles and session revisions and records the transfer audit. The outgoing Dean may remain active Faculty if eligible or become inactive if obligations permit. Both accounts keep their user IDs, records and passwords.

## Local verification on Windows

Run from the repository root in Windows CMD. Install the locked dependencies if needed. PEI-07 used Node.js 26.13.0 with npm 11.20.0.

```cmd
npm.cmd ci --prefix server
npm.cmd ci --prefix client
npm.cmd test --prefix server
npm.cmd test --prefix server -- test/facultyPdfReports.test.js
npm.cmd run build --prefix client
```

The isolated runner discovers `server/test/*.test.js`. It supplies a test signing key and a loopback placeholder MongoDB URI. The suites include unit, component and Express HTTP coverage with test doubles for persistence where needed. The standalone browser and replica-set scripts are separate commands.

### Headless Chrome and Vite

Install Chrome locally. Both browser scripts default to `C:\Program Files\Google\Chrome\Application\chrome.exe`. Set the executable path if installed elsewhere, then run the scripts one at a time to avoid contention during Vite dependency optimization. Optionally set `DEAN_BROWSER_OUTPUT` to an absolute path to override the Dean screenshots directory, which defaults to `artifacts/dean-account-settings`.

```cmd
set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
node server/test/pei01PortalStatus.browser.mjs
node server/test/deanAccountSettings.browser.mjs
```

The browser scripts exercise the actual React UI with fictional API responses. They check the public portal, sign-in routing, timeout history, semester availability and Dean settings. The Dean settings script checks transfer feedback and screenshots at 375, 768 and 1440 px and covers those viewport widths for layout.

### Disposable MongoDB replica set

Install or extract a local transaction-capable `mongod.exe`. MongoDB Community 8.0.13 was used for PEI-07. Pass the executable path from your installation.

```cmd
node server/test/deanInitialization.replica.mjs "C:\MongoDB\bin\mongod.exe"
```

The harness launches its own single-node replica set on loopback, checks the temporary database path, and removes its database files and processes in cleanup. It uses fictional accounts and disables SMTP. It exercises Express HTTP with real persistence, runs time-gated attendance and record services with a controlled clock, and checks bootstrap, CSV provisioning, consultation booking, availability deactivation, reporting, transfer contention and rollback, token rejection and restart. A passing isolated test for an uncertain commit establishes the application's response to a simulated driver result. The replica-set run establishes rollback and concurrency behavior on a real local database.

## Manual staging checklist

Use an authorized staging replica set, fictional identities and an email sink or disabled SMTP. Use separate browser profiles for each role.

1. Check Student and Faculty login from the public portal and direct Dean login. Check access to the correct workspace, unauthorized navigation, history filters and the **Request Timed Out** explanation at phone, tablet and desktop widths.
2. Preview a representative mapped CSV and verify role counts. Include duplicates, unusable mappings and a stale preview. Confirm a clean batch, sign in with the initial credentials and personalize the Faculty password.
3. Publish Faculty availability, request and approve a consultation, report the outcome after the scheduled end and save a consultation record. Check participant views and generate personal PDFs for both a Faculty account and the Dean. Include an empty range and a multi-page export with long fields and Manila boundary dates.
4. Preview End Semester Availability with eligible and protected slots. Confirm the change, verify any stale-version result and confirm the protected reservation, history and report remain intact.
5. On a fresh disposable installation, verify initial Dean setup and restart with bootstrap credentials removed. In a separate authorized staging session, exercise both outgoing Dean dispositions, check both old sessions, verify the new Dean's two workspaces and inspect the audit after restart. If the outcome is uncertain, reconcile the stored Dean and audit before considering another submission.

## Deployment checks and limitations

- Confirm the target database, required indexes, backups and restoration rehearsal. Keep bootstrap disabled after the authorized first setup. Follow the [README's Dean recovery and deployment guidance](../README.md#initialize-or-recover-dean-access) if startup detects missing or conflicting management accounts.
- Deploy revision-aware authorization on every API instance before allowing a Dean transfer. Review session revocation before rolling back to code that predates revision checks. Verify scheduled attendance, expiration and reminder jobs in the target environment.
- Validate target configuration and access controls for database, file storage, SMTP, HTTPS and application origins. The local verification does not exercise live provider delivery, multi-node replica failover, institutional datasets or staging operations.
- The exact Campus++ export format remains unverified. CSV import accepts mapped files, and an actual export requires separate validation. Local test and build results establish behavior in the tested environments. Production readiness requires staging evidence and operational review.

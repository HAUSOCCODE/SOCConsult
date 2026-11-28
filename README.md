# SOCConsult

**Faculty–Student Consultation and Appointment Scheduling System**

[Project website](https://socconsult.vercel.app/) · [GitHub repository](https://github.com/HAUSOCCODE/SOCConsult)

SOCConsult is a web-based capstone project designed for the **Holy Angel University School of Computing**. It brings consultation requests, faculty availability, appointment schedules, attendance records, and administrative monitoring into one platform.

> **Project status:** Actively under development. Features are being refined and full system verification is still in progress. This is an academic project, not an official university service.

## Features

### Student
- Find faculty members and view consultation availability.
- Request consultations using published schedules or an alternative preferred schedule.
- Track requests, appointments, and consultation history.
- View a consultation calendar and receive notifications.
- Submit consultation outcomes when eligible and review attendance records.

### Faculty
- Manage consultation availability and schedules.
- Review, accept, reject, or propose changes to consultation requests.
- Initiate consultation requests with students.
- Manage consultations, attendance, and consultation records.
- View consultation history and generate PDF reports.

### Dean / Administrator
- Create and manage Student and Faculty accounts, including CSV imports.
- Monitor consultation activity across the system.
- Review and resolve disputed attendance outcomes.
- View reports, analytics, and audit logs.
- Generate optional AI-assisted report summaries for review.

**Account access:** Public Student and Faculty registration is disabled. Accounts are provisioned by an authorized Dean.

## Tech Stack

| Layer | Technologies |
| --- | --- |
| Frontend | React, Vite, Tailwind CSS, FullCalendar |
| Backend | Node.js, Express |
| Database | MongoDB, Mongoose |
| Authentication | JWT, bcrypt |
| File storage | Cloudinary |
| Notifications | In-app notifications; email via SMTP/Nodemailer |
| Reports | PDFKit; optional Groq-assisted summaries |

## Getting Started

### Prerequisites

- Node.js 20+ and npm
- A MongoDB connection (a replica-set deployment, such as MongoDB Atlas, is needed for transaction-based workflows)
- Cloudinary credentials for file uploads
- Environment credentials for a development Dean account

### 1. Clone the repository

```bash
git clone https://github.com/HAUSOCCODE/SOCConsult.git
cd SOCConsult
```

### 2. Install dependencies

Run these commands from the repository root:

```bash
npm install
npm install --prefix client
npm install --prefix server
```

### 3. Configure environment variables

Create `server/.env` and set the required values:

```dotenv
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=replace_with_a_long_random_secret
CLIENT_URL=http://localhost:5173

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

Optional integrations can also be configured in `server/.env`:

```dotenv
# Email notifications
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=

# AI-assisted report summaries
GROQ_API_KEY=
```

The frontend connects to `http://localhost:5000/api` by default. If your API uses a different address, set `VITE_API_URL` in `client/.env`.

**Security:** Never commit `.env` files, real credentials, or private student data. Use a separate development database and test accounts.

#### Initialize or recover Dean access

For an institution-authorized **new installation**, verify that `MONGODB_URI` targets a newly provisioned, empty SOCConsult database. Use a MongoDB replica set or Atlas deployment with transaction support. The application database account needs permission to read and write application data, create the installation-state collection, and ensure the sparse unique username index. Initial bootstrap also lists and checks collections for existing data.

1. Set `DEAN_BOOTSTRAP_ENABLED=true` on the server and supply `DEAN_USERNAME` and `DEAN_PASSWORD` through protected environment configuration. Choose a unique initial username and a temporary password that meets the app’s password policy. `ADMIN_USERNAME` and `ADMIN_PASSWORD` are fallback names for this step.
2. Start the API. This commits the initial Dean and the database’s installation marker together. For Vercel, exercise the API once to trigger and verify runtime initialization.
3. Deliver the temporary credentials through an institution-approved secure channel. The Dean signs in at `/dean/login`, then opens **Dean Management → Account Settings** to update their profile, choose a sign-in username, change the temporary password, and review account details. The username and password are saved in separate forms.
4. Remove `DEAN_BOOTSTRAP_ENABLED`, both Dean bootstrap variables, and any legacy Admin credential variables from the applicable environment scopes. Restart or redeploy and verify sign-in with the stored credentials.

An existing Dean or a sole legacy Admin is recognized by stored role on startup. An inactive Dean remains inactive. Bootstrap environment values are used for initial creation only. Manage current sign-in credentials in Account Settings. Include `installationState` in backups and restores alongside application data.

If startup reports a missing Dean in a populated or initialized database, conflicting management accounts, or unusable Dean access, leave bootstrap disabled. Have the authorized institutional database administrator and security owner verify the deployment target, record the incident, and take a restricted, verified backup before remediation. Rehearse restoration on an isolated copy. Recover the original management record from a trusted backup with its original MongoDB user ID and consult the institution’s access records before resolving roles or account status. If restoration is insufficient, use an approved, reviewed offline repair under institutional change control. Confirm exactly one legitimate management account, preserve consultation and audit references, verify sign-in and both workspaces, and record the outcome.

#### Dean Privilege Transfer and Deployment Safety

The current Dean starts the transfer from **Dean Management → Account Settings**. An eligible Faculty successor must personalize their password before promotion. Both accounts retain their original user IDs and histories. A single transaction changes both roles, records an audit event, and invalidates both accounts’ existing sessions.

- Before authorizing a transfer, update **all running backend API instances** to use revision-aware authentication middleware and remove older instances from service. Do not perform a transfer during a mixed-version backend rollout.
- After a transfer, rolling back to backend code without session-revision verification requires an explicit security and session-revocation review.
- If the transfer outcome is uncertain, verify the stored Dean and transfer audit through authorized database and audit checks before retrying.

### 4. Start the application

```bash
npm run dev
```

| Service | Local URL |
| --- | --- |
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:5000 |

Sign in using accounts provisioned by the Dean. There is no public sign-up page.

## How SOCConsult Works

1. The Dean provisions authorized Student and Faculty accounts.
2. Faculty members publish availability; a Student requests a consultation, or Faculty initiates one.
3. The receiving participant responds, and an approved consultation becomes a scheduled appointment.
4. After the consultation, the eligible participant reports its outcome. Disputed outcomes can be reviewed by the Dean.
5. Consultation records, notifications, and reports support follow-up and monitoring.

## Project Structure

```text
SOCConsult/
├── client/          # React frontend
├── server/          # Express API, MongoDB models, services and tests
├── package.json     # Root development scripts
└── README.md
```

## Useful Commands

Run these commands from the repository root:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start frontend and backend together |
| `npm test --prefix server` | Run backend automated tests |
| `npm run build --prefix client` | Build the frontend for production |

**Operational note:** The backend provides scripts for attendance processing, appointment expiration, and reminders. These need scheduled execution in a deployment environment; the repository does not currently configure a scheduler.

## Development Notes

SOCConsult is being actively improved as a capstone project. The implementation is available for development and review, but a successful local build or automated test run does not by itself establish production readiness.

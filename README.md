# TechProject Backend

Next.js (API routes only) + Firebase (Auth + Firestore), TypeScript. Runs on **http://localhost:3001**.

Frontend alag project hai (`techproject-frontend`, port 3000).

---

## Roles

| Role | Kaun | Kya kar sakta hai |
|---|---|---|
| `super_admin` | Sirf ek, setup script se banta hai | Organizations create / list / delete (soft delete). Har organization ke liye uska admin account banata hai |
| `admin` | Har organization ka ek admin | Apni organization ke users create / list / delete (soft delete) |
| `user` | Admin ke banaye hue users | Login karke apna profile dekh sakte hain |

---

## Setup

```bash
npm install
cp .env.example .env.local      # Windows: copy .env.example .env.local
```

`.env.local` fill karo:

1. Firebase Console → project banao → **Build → Authentication → Get started → Email/Password enable**.
2. **Build → Firestore Database → Create database**.
3. **Project settings → Service accounts → Generate new private key**. JSON file se `project_id`, `client_email`, `private_key` copy karke `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` mein daalo.
   Agar Firestore mein named database banaya hai (jaise InsightX) to uska ID lowercase mein `FIREBASE_DATABASE_ID=insightx` likho. Default database ke liye isay khali chhod do.
4. `FRONTEND_ORIGIN` = frontend ka URL (`http://localhost:3000`).
5. `SUPER_ADMIN_EMAIL` aur `SUPER_ADMIN_PASSWORD` (min 8 characters) apni marzi se likho.

Super admin ek baar banao:

```bash
npm run seed:superadmin
```

Phir server chalao:

```bash
npm run dev
```

Check: http://localhost:3001/api/health → `{"status":"ok"}`

| Command | Kaam |
|---|---|
| `npm run dev` | Development server (port 3001) |
| `npm run build` / `npm run start` | Production build / server |
| `npm run typecheck` | TypeScript errors check |
| `npm test` | Marketplace validation, encryption, and mock-adapter unit tests |
| `npm run seed:superadmin` | Super admin banata / update karta hai |

> **Security:** Super admin ke credentials sirf is project ki `.env.local` mein rahenge. Inhein `.env.example` mein, GitHub par, ya kisi dusre repository mein mat daalna. `.env.local` `.gitignore` mein already blocked hai.

---

## JWT authentication (kaise kaam karta hai)

1. Frontend Firebase Auth se email/password login karta hai aur **ID token (JWT)** leta hai.
2. Har API request mein header jata hai: `Authorization: Bearer <token>`.
3. Backend (`src/lib/api.ts` ka `apiHandler`) token ko Firebase Admin se **verify** karta hai (deleted/disabled users ke tokens bhi reject hote hain).
4. Token ke andar custom claims hain: `role` aur `orgId`. Inhein account banate waqt set kiya jata hai.
5. Agar role route ke liye allowed nahi to `403`, token galat/missing ho to `401`.

---

## API endpoints

Sab endpoints par token chahiye (sirf `/api/health` public hai).

| Method | Endpoint | Role | Body | Kaam |
|---|---|---|---|---|
| GET | `/api/health` | public | - | Server check |
| GET | `/api/me` | koi bhi logged-in | - | Mera role, naam, organization |
| GET | `/api/organizations` | super_admin | - | Saari organizations |
| POST | `/api/organizations` | super_admin | `name, adminName, adminEmail, adminPassword` | Organization + uska admin banao |
| DELETE | `/api/organizations/:id` | super_admin | - | Organization "delete" (soft): organization aur uske saare users ka `isActive` false, login disable. Record database mein rehta hai |
| GET | `/api/users` | admin | - | Meri organization ke users |
| POST | `/api/users` | admin | `name, email, password` | Meri organization mein user banao |
| DELETE | `/api/users/:id` | admin | - | Meri organization ka user "delete" (soft): `isActive` false, login disable. Record database mein rehta hai |

Errors is shape mein aate hain: `{ "error": "message" }`.

### Team A — Marketplace Operations

Marketplace endpoints require a valid Firebase ID token and an active `admin`
profile whose organization matches the verified token claims. All reads and
writes are scoped to that organization.

| Method | Endpoint | Kaam |
|---|---|---|
| GET | `/api/operations/connections` | List organization connections |
| POST | `/api/operations/connections` | Create connection |
| GET | `/api/operations/connections/:id` | Retrieve one owned connection |
| PUT | `/api/operations/connections/:id` | Update name/settings or rotate credentials |
| DELETE | `/api/operations/connections/:id` | Deactivate connection and remove saved credentials |
| POST | `/api/operations/connections/:id/enable` | Enable connection |
| POST | `/api/operations/connections/:id/disable` | Disable connection |
| POST | `/api/operations/connections/:id/test` | Run a safe mock validation |
| POST | `/api/operations/sync` | Run a manual synthetic orders/inventory sync |
| GET | `/api/operations/sync/status` | Read the latest organization sync status |
| GET | `/api/operations/jobs` | Filter and paginate sync history |
| POST | `/api/operations/jobs/:id/retry` | Retry a failed/partial job |

The test adapter and sync currently use synthetic sample records only. They do
not contact Shopify, Amazon, eBay, WooCommerce, Etsy, or another live provider.
Successful connection tests are returned as `status: "mock"` in the settings UI
to distinguish simulation from a live marketplace integration.

Credential fields are encrypted with AES-256-GCM before they are stored in the
backend-only `marketplaceConnectionSecrets` collection. Set a backend-only
`MARKETPLACE_ENCRYPTION_KEY` (64 hex characters) to save non-empty credentials;
generate one with `openssl rand -hex 32`. Never use a committed key or put it in
the frontend environment. Changing the key without re-encrypting existing
records makes those saved credentials unreadable. The mock workflow can be used
without setting this key by leaving all credential fields blank.

Job filtering accepts `page`, `pageSize` (1–100), `status`, `connectionId`,
`dateFrom`, `dateTo` (`YYYY-MM-DD`), and `search`. Mock imports are idempotent
per organization/connection/source ID. Sync locks prevent overlapping runs for
the same connection and expire after five minutes if a process is interrupted.

---

## Folder structure

```
scripts/
└── seed-super-admin.ts           # Super admin banane ki script (sirf tumhari machine par)
src/
├── app/
│   ├── page.tsx                  # "API is running" page
│   └── api/
│       ├── health/route.ts
│       ├── me/route.ts
│       ├── operations/                    # Team A marketplace, sync, and job APIs
│       ├── organizations/route.ts
│       ├── organizations/[id]/route.ts
│       ├── users/route.ts
│       └── users/[id]/route.ts
├── lib/
│   ├── api.ts                    # CORS, JWT verify, role check, error handling
│   ├── accounts.ts               # Auth user + Firestore profile create / soft delete (deactivate)
│   ├── firebaseAdmin.ts          # Firebase Admin init
│   ├── marketplaceAdapters.ts    # Mock adapter interface and test
│   ├── marketplaceSecrets.ts     # AES-256-GCM credential encryption
│   ├── marketplaceSync.ts        # Synthetic sync, dedupe, history, retry
│   ├── validate.ts               # Input validation
│   └── errors.ts                 # HttpError
└── types/index.ts                # Role, UserDoc, OrganizationDoc
firestore.rules                   # Browser se direct Firestore access band
```

### Naya endpoint banane ka tareeqa

```ts
// src/app/api/example/route.ts
import { apiHandler, json, preflight } from "@/lib/api";

export const OPTIONS = preflight;                       // CORS ke liye zaroori

export const GET = apiHandler({ roles: ["admin"] }, async ({ auth }) => {
  return json({ hello: auth.email, org: auth.orgId });
});
```

---

## Firestore data

- `users/{uid}` → `{ name, email, role, orgId, createdAt }`
- `organizations/{orgId}` → `{ name, adminUid, adminName, adminEmail, createdAt }`

Database sirf backend (Admin SDK) se access hota hai. `firestore.rules` mein direct access band hai (Firebase Console mein ye rules publish kar sakte ho).

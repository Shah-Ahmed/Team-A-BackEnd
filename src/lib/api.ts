// Shared API helpers: CORS, JWT verification, role check, error handling.
//
// Auth flow:
//   1. Frontend signs in with Firebase Auth and gets an ID token (a JWT).
//   2. Frontend sends it on every request:  Authorization: Bearer <token>
//   3. apiHandler() verifies the token with Firebase Admin and reads the
//      custom claims { role, orgId } that were set when the user was created.
//   4. If the role is not allowed for the route, a 403 is returned.

import { NextResponse } from "next/server";
import { getAdminAuth } from "./firebaseAdmin";
import { HttpError } from "./errors";
import type { AuthUser, Role } from "@/types";

// ---------- CORS ----------
function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": process.env.FRONTEND_ORIGIN || "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// Return JSON with CORS headers. Use this in every route:  return json({ ... }, 201)
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}

// Answers the browser's CORS preflight request. Export it from every route:
//   export const OPTIONS = preflight;
export function preflight() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

// ---------- JWT verification ----------
export async function authenticate(request: Request): Promise<AuthUser> {
  const header = request.headers.get("authorization") || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new HttpError(401, "Missing or invalid Authorization header");
  }

  const adminAuth = getAdminAuth(); // outside try: a config problem should be a 500, not a 401
  try {
    // 2nd argument true = also reject tokens of deleted/disabled/revoked users.
    const decoded = await adminAuth.verifyIdToken(token, true);
    return {
      uid: decoded.uid,
      email: decoded.email ?? null,
      role: (decoded.role as Role | undefined) ?? null,
      orgId: (decoded.orgId as string | undefined) ?? null,
    };
  } catch {
    throw new HttpError(401, "Invalid or expired token");
  }
}

// Firebase Auth errors -> friendly HTTP errors
const FIREBASE_ERRORS: Record<string, [number, string]> = {
  "auth/email-already-exists": [409, "A user with this email already exists"],
  "auth/invalid-email": [400, "Email address is not valid"],
  "auth/invalid-password": [400, "Password is not valid (minimum 6 characters)"],
};

function toErrorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return json({ error: error.message }, error.status);
  }
  const code = (error as { code?: string } | null)?.code;
  const mapped = code ? FIREBASE_ERRORS[code] : undefined;
  if (mapped) return json({ error: mapped[1] }, mapped[0]);

  // Do not log raw errors: an upstream SDK error may contain request details.
  return json({ error: "Internal server error" }, 500);
}

interface HandlerArgs {
  request: Request;
  params: Record<string, string>;
  auth: AuthUser;
}

// Wrap a route handler:
//   export const GET = apiHandler({ roles: ["admin"] }, async ({ auth }) => {
//     return json({ hello: auth.email });
//   });
// Leave `roles` out to allow any signed-in user that has a role.
export function apiHandler(
  options: { roles?: Role[] },
  handler: (args: HandlerArgs) => Promise<Response>
) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }) => {
    try {
      const auth = await authenticate(request);
      // A valid Firebase token without our role claim (e.g. someone who signed up
      // directly in Firebase) must never get in.
      if (!auth.role || (options.roles && !options.roles.includes(auth.role))) {
        throw new HttpError(403, "You do not have permission to do this");
      }
      const params = context?.params ? await context.params : {};
      return await handler({ request, params, auth });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

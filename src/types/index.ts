// Types shared across the backend.

export type Role = "super_admin" | "admin" | "user";

// Stored in Firestore: users/{uid}   (the document id is the Firebase Auth uid)
export interface UserDoc {
  name: string;
  email: string;
  role: Role;
  orgId: string | null; // null for super_admin
  createdAt: number; // unix ms
  isActive: boolean; // false = "deleted" (soft delete, the record stays in the database)
  deletedAt?: number; // unix ms, set when isActive becomes false
}

// Stored in Firestore: organizations/{orgId}
export interface OrganizationDoc {
  name: string;
  adminUid: string;
  adminName: string;
  adminEmail: string;
  createdAt: number; // unix ms
  isActive: boolean; // false = "deleted" (soft delete, the record stays in the database)
  deletedAt?: number; // unix ms, set when isActive becomes false
}

// What the verified JWT gives us on every request.
export interface AuthUser {
  uid: string;
  email: string | null;
  role: Role | null;
  orgId: string | null;
}
export type MarketplaceProvider =
  | "shopify"
  | "amazon"
  | "ebay"
  | "woocommerce"
  | "etsy"
  | "custom";

export interface MarketplaceConnectionDoc {
  id: string;
  orgId: string;
  provider: MarketplaceProvider;
  name: string;
  settings: Record<string, string>;
  hasSecret: boolean;
  isEnabled: boolean;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}
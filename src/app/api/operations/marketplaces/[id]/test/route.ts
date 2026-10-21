
import {
  apiHandler,
  json,
  preflight,
} from "@/lib/api";
import { getOwnedConnection, docToConnection } from "@/lib/marketplaces";
import {
  createAdapter,
  withTimeout,
} from "@/lib/marketplaceAdapters";

export const OPTIONS = preflight;

// POST /api/operations/marketplaces/:id/test
export const POST = apiHandler(
  { roles: ["admin", "super_admin"] },
  async ({ auth, params }) => {
    const { id } = params;

    // Get the connection owned by the current organization
    const { ref, data } = await getOwnedConnection(
      id,
      auth.orgId
    );

    const connection = docToConnection(id, data);

    // Create the provider adapter
    const adapter = createAdapter(connection.provider);

    // Run the connection test with a 10-second timeout
    let result;

    try {
      result = await withTimeout(
        adapter.testConnection(connection),
        10_000
      );
    } catch (err) {
      // Handle timeout or unexpected adapter errors
      result = {
        success: false,
        message:
          err instanceof Error
            ? err.message
            : "Test failed unexpectedly",
        latencyMs: 10_000,
        provider: connection.provider,
        checkedAt: Date.now(),
      };
    }

    // Save the latest test result
    await ref.update({
      lastTestAt: result.checkedAt,
      lastTestSuccess: result.success,
      lastTestMessage: result.message,
      updatedAt: Date.now(),
    });

    // Return the standardized response
    return json(result);
  }
);

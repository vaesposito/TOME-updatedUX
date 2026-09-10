import { NextRequest } from "next/server";

import {
  ApiError,
  getAuthFromBearerOrSession,
  successResponse,
  withErrorHandler,
} from "@/lib/api-middleware";
import { getProviderConnectionService } from "@/lib/credentials/oauth-service-factory";
import { getCredentialFeatureConfig } from "@/lib/feature-flags/credentials";
import { isProtectedManagedWebexConnection } from "@/lib/tome/managed-webex-config";

interface RouteContext {
  params: Promise<{ connection_id: string }>;
}

function assertFeatureEnabled(): void {
  if (!getCredentialFeatureConfig().enabled) {
    throw new ApiError("Credential features are disabled", 404, "CREDENTIALS_DISABLED");
  }
}

export const DELETE = withErrorHandler(async (request: NextRequest, context: RouteContext) => {
  assertFeatureEnabled();
  const { connection_id: connectionId } = await context.params;
  if (!connectionId?.trim()) {
    throw new ApiError("connection_id is required", 400, "VALIDATION_ERROR");
  }

  const { session } = await getAuthFromBearerOrSession(request);
  const ownerId = typeof session.sub === "string" ? session.sub.trim() : "";
  if (!ownerId) {
    throw new ApiError("Authenticated subject is required", 401, "UNAUTHORIZED");
  }

  const service = await getProviderConnectionService();
  const connection = await service.getConnection(connectionId);
  if (isProtectedManagedWebexConnection(connection)) {
    throw new ApiError(
      "The managed Webex connection cannot be removed from the normal connection screen",
      403,
      "MANAGED_WEBEX_CREDENTIAL_PROTECTED",
    );
  }
  const revoked = await service.revokeConnection({
    connectionId,
    owner: { type: "user", id: ownerId },
  });
  return successResponse(revoked);
});

import {
  normalizeMyAgentConnectors,
  type MyAgentConnector,
} from "@/lib/projects/myagent-source";
import { MYAGENT_BROWSER_ACTION_HEADER } from "@/lib/tome/myagent-interactive";
import type { ProjectSources } from "@/types/projects";

export interface MyAgentConsentSelection {
  connectors: MyAgentConnector[];
  enabled: boolean;
}

/** Normalize the browser's projected consent fields into one durable choice. */
export function myAgentConsentSelection(
  sources: ProjectSources | undefined,
): MyAgentConsentSelection {
  const connectors = normalizeMyAgentConnectors(sources?.myagent_connectors);
  return {
    connectors,
    enabled: sources?.myagent_enabled === true && connectors.length > 0,
  };
}

export function sameMyAgentConsentSelection(
  left: MyAgentConsentSelection,
  right: MyAgentConsentSelection,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.connectors.length === right.connectors.length &&
    left.connectors.every((connector, index) => connector === right.connectors[index])
  );
}

/** Remove caller-projected fields before a normal project PATCH. */
export function withoutMyAgentConsentFields(
  sources: ProjectSources,
): Omit<
  ProjectSources,
  "myagent_connectors" | "myagent_enabled" | "myagent_consent_revision" | "myagent_consents"
> {
  const {
    myagent_connectors: _connectors,
    myagent_enabled: _enabled,
    myagent_consent_revision: _revision,
    myagent_consents: _consents,
    ...safeSources
  } = sources;
  return safeSources;
}

/**
 * Persist only the signed-in user's MyAgent delegation. This endpoint owns a
 * document-atomic, per-subject mutation; do not replace it with project PATCH.
 */
export async function saveMyAgentConsent(
  slug: string,
  sources: ProjectSources,
): Promise<ProjectSources> {
  const selection = myAgentConsentSelection(sources);
  const revision = typeof sources.myagent_consent_revision === "string"
    ? sources.myagent_consent_revision
    : null;
  const response = await fetch(
    `/api/projects/${encodeURIComponent(slug)}/myagent-consent`,
    selection.enabled
      ? {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            [MYAGENT_BROWSER_ACTION_HEADER]: "1",
          },
          body: JSON.stringify({ connectors: selection.connectors, revision }),
        }
      : {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            [MYAGENT_BROWSER_ACTION_HEADER]: "1",
          },
          body: JSON.stringify({ revision }),
        },
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error ?? `MyAgent consent save failed (${response.status})`);
  }
  const projected = body?.data?.sources;
  if (projected && typeof projected === "object") {
    return projected as ProjectSources;
  }
  return {
    ...sources,
    myagent_connectors: [],
    myagent_enabled: false,
    myagent_consent_revision:
      typeof body?.data?.revision === "string" ? body.data.revision : null,
  };
}

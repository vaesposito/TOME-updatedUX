/** Agent-facing research broker. User identity and source scope come only from the run. */
import { ObjectId } from "mongodb";
import { ApiError } from "@/lib/api-error";
import { getCollection } from "@/lib/mongodb";
import { buildMyAgentConsentDelegationClaim, buildMyAgentConsentDelegationConsumptionClaim } from "@/lib/projects/myagent-consent-update";
import { myAgentConnectorsForSubject, myAgentConsentRevisionForSubject } from "@/lib/projects/myagent-source";
import type { ProjectDocument } from "@/types/projects";
import type { IngestRun, ChatRun } from "@/types/tome";
import { canReadTomeProject, isTomeAdminSubject } from "./access";
import { canWriteAs } from "./data-steward";
import { appendMyAgentQuestionEvidence, captureEvidenceBundle } from "./evidence-bundle";
import { getEvidenceBundle } from "./evaluation-store";
import { getTomeIngestRunsCollection, getTomeChatRunsCollection } from "./mongo-collections";
import { requestMyAgentEvidence, resolveMyAgentWebexCredential, type MyAgentEvidence } from "./myagent-webex";

export const MAX_MYAGENT_QUESTIONS = 3;

export async function askMyAgentForRun(
  project: ProjectDocument & { _id: string }, runId: string, question: unknown,
  runKind: "ingest" | "chat" = "ingest",
): Promise<MyAgentEvidence> {
  if (typeof question !== "string" || !question.trim() || question.length > 2_000) {
    throw new ApiError("Ask a specific question of 1–2,000 characters.", 400, "INVALID_MYAGENT_QUESTION");
  }
  const runs = runKind === "chat" ? await getTomeChatRunsCollection() : await getTomeIngestRunsCollection();
  const run = await runs.findOne({ _id: runId, project_id: project._id });
  const dispatch = (run as IngestRun | null)?.dispatch;
  if (!run || run.status !== "running" ||
      !run.myagent_interactive_authorized || !run.myagent_tool_enabled ||
      (runKind === "ingest" && ((run as IngestRun).triggered_by === "auto" ||
        (dispatch?.endpoint ?? "/ingest") !== "/ingest" || dispatch?.sourceScope === "webex_meetings")) ||
      !run.triggered_by_sub) {
    throw new ApiError("MyAgent research is not authorized for this run.", 403, "MYAGENT_NOT_AUTHORIZED");
  }
  const subject = run.triggered_by_sub;
  const canAccess = () => runKind === "chat"
    ? canReadTomeProject(subject, project).then(async (allowed) => allowed || await isTomeAdminSubject(subject))
    : canWriteAs(subject, project);
  if (!await canAccess()) {
    throw new ApiError("The run owner no longer has project access.", 403, "MYAGENT_NOT_AUTHORIZED");
  }
  const capabilities = myAgentConnectorsForSubject(project.sources, subject)
    .filter((source) => run.myagent_allowed_sources?.includes(source));
  const revision = myAgentConsentRevisionForSubject(project.sources, subject);
  if (!capabilities.length || !revision || revision !== run.myagent_consent_revision) {
    throw new ApiError("MyAgent consent changed; start a new manual ingest.", 403, "MYAGENT_CONSENT_CHANGED");
  }
  const credential = await resolveMyAgentWebexCredential(subject);
  if (!credential.available || !credential.accessToken) {
    return { capabilities, status: "unavailable", detail: credential.reason };
  }
  // Atomic across UI replicas: one request at a time and at most three per run.
  // Failed/time-out sends count too; retries must not create an unbounded DM loop.
  const reserved = await runs.updateOne({
    _id: runId, project_id: project._id, status: "running", myagent_tool_enabled: true,
    myagent_question_in_flight: { $ne: true },
    $or: [{ myagent_question_count: { $exists: false } }, { myagent_question_count: { $lt: MAX_MYAGENT_QUESTIONS } }],
  }, {
    $inc: { myagent_question_count: 1 },
    $set: { myagent_question_in_flight: true },
  });
  if (!reserved.matchedCount) {
    throw new ApiError("MyAgent question limit reached, another question is in flight, or the run stopped.", 429, "MYAGENT_QUESTION_LIMIT");
  }
  try {
    const projects = await getCollection<ProjectDocument>("projects");
    const projectMongoId = (ObjectId.isValid(project._id) ? new ObjectId(project._id) : project._id) as unknown as string;
    const claim = buildMyAgentConsentDelegationClaim({ subject, expectedRevision: revision, runId, claimedAt: new Date().toISOString() });
    const claimed = await projects.updateOne({ _id: projectMongoId, ...claim.filter }, claim.update);
    if (!claimed.matchedCount) {
      throw new ApiError("MyAgent consent was revoked before the request.", 403, "MYAGENT_CONSENT_CHANGED");
    }
    const evidence = await requestMyAgentEvidence({
      accessToken: credential.accessToken, capabilities, question: question.trim(),
      context: { projectTitle: project.title || project.name || project.slug, projectDescription: project.description,
        seedInstruction: runKind === "chat" ? (run as ChatRun).myagent_seed : dispatch?.seed },
    });
    if (evidence.status !== "received") return evidence;
    const consume = buildMyAgentConsentDelegationConsumptionClaim({ subject, expectedRevision: revision, runId, consumedAt: new Date().toISOString() });
    const consumed = await projects.updateOne({ _id: projectMongoId, ...consume.filter }, consume.update);
    const activeRun = await runs.findOne({ _id: runId, status: "running" });
    if (!consumed.matchedCount || !activeRun || !await canAccess()) {
      return { capabilities, status: "unavailable", detail: "The run stopped or consent changed; the reply was discarded." };
    }
    // Chat research is read-only and returned only to the owner's private chat.
    // It never writes project pages or creates an ingestion report.
    if (runKind === "chat") return evidence;
    // Apply the private-review gate before returning any evidence to the model.
    const ingestRuns = await getTomeIngestRunsCollection();
    await ingestRuns.updateOne({ _id: runId }, { $set: { myagent_evidence_received: true } });
    const bundleId = (activeRun as IngestRun).evidence_bundle_id;
    const previous = bundleId ? await getEvidenceBundle(bundleId) : null;
    const baseline = previous?.project_id === project._id ? previous : await captureEvidenceBundle({
      project, createdBy: subject, seed: dispatch?.seed,
    });
    const bundle = await appendMyAgentQuestionEvidence(baseline, question.trim(), evidence);
    await ingestRuns.updateOne({ _id: runId }, { $set: { evidence_bundle_id: bundle._id, evidence_hash: bundle.content_hash } });
    return evidence;
  } finally {
    await runs.updateOne({ _id: runId }, { $set: { myagent_question_in_flight: false } });
  }
}

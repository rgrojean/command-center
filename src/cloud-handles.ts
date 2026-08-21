import { Agent } from "@cursor/sdk";
import { cursorApiKey } from "./cursor-auth.js";
import {
  dropCloudHandle,
  listCloudHandles,
  publishCloudHandle,
  type CloudHandle,
} from "./run-store.js";

export type { CloudHandle };

export function trackCloudRun(pipelineRunId: string, handle: CloudHandle): void {
  void publishCloudHandle(pipelineRunId, handle);
}

export function untrackCloudRun(pipelineRunId: string, sdkRunId: string): void {
  void dropCloudHandle(pipelineRunId, sdkRunId);
}

/** Cancel every tracked cloud run for this pipeline run, including leftover agents after the isolate died. */
export async function cancelTrackedCloudRuns(pipelineRunId: string): Promise<number> {
  const handles = await listCloudHandles(pipelineRunId);
  if (handles.length === 0) return 0;
  const apiKey = cursorApiKey();
  const results = await Promise.all(
    handles.map(async (handle) => {
      try {
        const run = (await Agent.getRun(handle.runId, {
          runtime: "cloud",
          agentId: handle.agentId,
          ...(apiKey ? { apiKey } : {}),
        })) as { supports?: (op: "cancel") => boolean; cancel?: () => unknown };
        if (run.supports?.("cancel")) {
          await run.cancel?.();
          return true;
        }
      } catch {
        /* already gone or not cancellable */
      }
      return false;
    }),
  );
  return results.filter(Boolean).length;
}

export type ScheduledTaskRecord = {
  id: string; projectId: string; name: string; description: string; groupName: string; cronExpression: string; timezone: string;
  script: string; environmentNames: string[]; options: ScheduledTaskOption[]; timeoutSeconds: number; enabled: boolean; scheduleEnabled: boolean;
  lastRunAt: string | null; createdAt: string; updatedAt: string;
};
export type ScheduledTaskOption = { name: string; label: string; description: string; inputType: "text" | "password" | "date"; required: boolean; hidden: boolean; allowedValues: string[]; storagePath?: string };
export type ScheduledTaskRuntime = ScheduledTaskRecord & { environment: Record<string, string>; projectName: string; storageValues: Record<string, string> };
export type ScheduledJobProject = { id: string; name: string; description: string; createdAt: string; updatedAt: string; taskCount: number; keyCount: number };
export type ScheduledJobProjectKey = { name: string; updatedAt: string };
export type ScheduledJobKey = { name: string; updatedAt: string; scope: "global" | "project" };
export type ScheduledTaskRun = {
  id: string; taskId: string; taskName: string; trigger: "manual" | "schedule";
  status: "running" | "succeeded" | "failed"; exitCode: number | null;
  output: string; error: string | null; startedAt: string; finishedAt: string | null; startedBy: string | null;
};
export type ScheduledTaskActivity = ScheduledTaskRun & { projectId: string | null; projectName: string | null; startedBy: string | null; durationSeconds: number };


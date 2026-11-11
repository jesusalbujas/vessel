export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startGitSourcePoller } = await import("@/lib/git-deployments");
    startGitSourcePoller();
    const { startScheduledTaskScheduler } = await import("@/lib/scheduled-tasks");
    startScheduledTaskScheduler();
    const { startProjectScheduler } = await import("@/lib/project-scheduler");
    startProjectScheduler();
    const { startResourceAlertMonitor } = await import("@/lib/resource-alerts");
    startResourceAlertMonitor();
  }
}

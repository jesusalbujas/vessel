import { claimScheduledTaskMinute, listScheduledTasks, recoverInterruptedScheduledTaskRuns } from "@/lib/scheduled-task-store";
import { matchesCronSchedule } from "@/lib/cron-schedule";
import { isScheduledTaskRunning, scheduledTaskRunnerStatus, startScheduledTaskRun } from "@/lib/scheduled-task-runner";

const schedulerGlobal = globalThis as typeof globalThis & { __vesselScheduledTaskSchedulerStarted?: boolean };

function schedulerTick() {
  const now = new Date();
  for (const task of listScheduledTasks()) {
    const runner = scheduledTaskRunnerStatus();
    if (runner.running >= runner.maxConcurrent) break;
    if (!task.enabled || !task.scheduleEnabled || isScheduledTaskRunning(task.id) || !matchesCronSchedule(task.cronExpression, now, task.timezone)) continue;
    const minuteKey = String(Math.floor(now.getTime() / 60_000));
    if (!claimScheduledTaskMinute(task.id, minuteKey)) continue;
    try { startScheduledTaskRun(task.id, "schedule"); } catch { /* A later scheduled minute can retry capacity-limited work. */ }
  }
}

export function startScheduledTaskScheduler() {
  if (schedulerGlobal.__vesselScheduledTaskSchedulerStarted || process.env.NODE_ENV === "test") return;
  schedulerGlobal.__vesselScheduledTaskSchedulerStarted = true;
  recoverInterruptedScheduledTaskRuns();
  const timer = setInterval(() => {
    try { schedulerTick(); } catch (error) { console.error("Vessel scheduled-task scheduler tick failed", error); }
  }, 10_000);
  timer.unref?.();
  setTimeout(() => { try { schedulerTick(); } catch (error) { console.error("Vessel scheduled-task scheduler tick failed", error); } }, 2_000).unref?.();
}

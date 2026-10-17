import { UserRequestCost, MeterReading } from '../types.js';

interface PendingTask {
  turnId: string;
  sessionId?: string;
  startTs: string;
  startUsedPercent: number;
  startResetsAt: number;
  model?: string | null;
  callsCount: number;
  tokensCount: number;
}

export class RequestCostTracker {
  private pendingTasks = new Map<string, PendingTask>();
  private lastStartedTask: PendingTask | null = null;

  public onTaskStarted(
    turnId: string | undefined,
    ts: string,
    currentReading: MeterReading,
    model?: string | null,
    sessionId?: string
  ): void {
    const task: PendingTask = {
      turnId: turnId || `task-${Date.now()}`,
      sessionId,
      startTs: ts,
      startUsedPercent: currentReading.usedPercent,
      startResetsAt: currentReading.resetsAt,
      model,
      callsCount: 0,
      tokensCount: 0
    };

    if (turnId) {
      this.pendingTasks.set(turnId, task);
    }
    this.lastStartedTask = task;
  }

  public recordCall(turnId: string | undefined, tokens: number): void {
    if (turnId && this.pendingTasks.has(turnId)) {
      const task = this.pendingTasks.get(turnId)!;
      task.callsCount++;
      task.tokensCount += tokens;
    } else if (this.lastStartedTask) {
      this.lastStartedTask.callsCount++;
      this.lastStartedTask.tokensCount += tokens;
    }
  }

  public onTaskComplete(
    turnId: string | undefined,
    ts: string,
    currentReading: MeterReading
  ): UserRequestCost | null {
    let task: PendingTask | undefined;
    if (turnId && this.pendingTasks.has(turnId)) {
      task = this.pendingTasks.get(turnId);
      this.pendingTasks.delete(turnId);
    } else if (this.lastStartedTask) {
      task = this.lastStartedTask;
      this.lastStartedTask = null;
    }

    if (!task) {
      return null;
    }

    // Check if the request spanned a quota reset
    const spannedReset =
      currentReading.resetsAt !== task.startResetsAt ||
      currentReading.usedPercent < task.startUsedPercent - 2.0;

    const deltaPercent = Math.max(0, currentReading.usedPercent - task.startUsedPercent);

    // Format: "<1%" or "about +N%"
    const costDisplay = deltaPercent < 1.0
      ? '<1%'
      : `about +${Math.round(deltaPercent)}%`;

    return {
      turnId: task.turnId,
      startTs: task.startTs,
      completeTs: ts,
      startUsedPercent: task.startUsedPercent,
      endUsedPercent: currentReading.usedPercent,
      deltaPercent,
      costDisplay,
      spannedReset,
      model: task.model,
      callsCount: task.callsCount,
      tokensCount: task.tokensCount
    };
  }

  public clear(): void {
    this.pendingTasks.clear();
    this.lastStartedTask = null;
  }
}

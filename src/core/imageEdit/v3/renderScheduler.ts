export type ImageEditRenderLane = 'gpu' | 'cpu';
export type ImageEditRenderTaskKind = 'preview' | 'export' | 'prefetch';

export const IMAGE_EDIT_RENDER_PRIORITY = {
  interactionDraft: 500,
  viewportStable: 400,
  otherVisibleEditor: 300,
  export: 200,
  prefetch: 100,
} as const;

export interface ImageEditRenderTaskContext {
  signal: AbortSignal;
  /** 长任务在每个瓦片或 pass 后调用，主动把执行权还给事件循环。 */
  yieldAfterAtomicUnit(): Promise<void>;
}

export interface ImageEditRenderTask<T> {
  id: string;
  sessionId: string;
  revision: number;
  kind: ImageEditRenderTaskKind;
  lane: ImageEditRenderLane;
  priority: number;
  run(context: ImageEditRenderTaskContext): Promise<T>;
}

interface ScheduledTask<T = unknown> {
  task: ImageEditRenderTask<T>;
  controller: AbortController;
  sequence: number;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export class ImageEditTaskSupersededError extends Error {
  constructor(taskId: string) {
    super(`图片编辑任务已被更新版本替代：${taskId}`);
    this.name = 'ImageEditTaskSupersededError';
  }
}

export class ImageEditTaskCancelledError extends Error {
  constructor(taskId: string) {
    super(`图片编辑任务已取消：${taskId}`);
    this.name = 'ImageEditTaskCancelledError';
  }
}

export interface ImageEditRenderSchedulerOptions {
  cpuConcurrency?: number;
}

export interface ImageEditRenderSchedulerSnapshot {
  runningGpu: number;
  runningCpu: number;
  pendingPreviewSessions: number;
  pendingOtherTasks: number;
  activePreviewSessions: number;
}

export class ImageEditRenderScheduler {
  private readonly cpuConcurrency: number;
  private readonly pendingPreviews = new Map<string, ScheduledTask>();
  private readonly pendingTasks: ScheduledTask[] = [];
  private readonly activeTasks = new Map<string, ScheduledTask>();
  private readonly activePreviewSessions = new Set<string>();
  private sequence = 0;
  private runningGpu = 0;
  private runningCpu = 0;

  constructor(options: ImageEditRenderSchedulerOptions = {}) {
    const cpuConcurrency = options.cpuConcurrency ?? 2;
    if (!Number.isSafeInteger(cpuConcurrency) || cpuConcurrency < 1 || cpuConcurrency > 8) {
      throw new Error('CPU 解码并发必须是 1～8 的整数');
    }
    this.cpuConcurrency = cpuConcurrency;
  }

  schedule<T>(task: ImageEditRenderTask<T>): Promise<T> {
    if (!task.id || !task.sessionId || !Number.isSafeInteger(task.revision) || task.revision < 0) {
      return Promise.reject(new Error('图片编辑任务身份无效'));
    }
    return new Promise<T>((resolve, reject) => {
      const scheduled: ScheduledTask<T> = {
        task,
        controller: new AbortController(),
        sequence: ++this.sequence,
        resolve,
        reject,
      };
      if (task.kind === 'preview') this.enqueuePreview(scheduled);
      else this.pendingTasks.push(scheduled as ScheduledTask);
      this.pump();
    });
  }

  cancelSession(sessionId: string): void {
    const pendingPreview = this.pendingPreviews.get(sessionId);
    if (pendingPreview) {
      this.pendingPreviews.delete(sessionId);
      pendingPreview.controller.abort();
      pendingPreview.reject(new ImageEditTaskCancelledError(pendingPreview.task.id));
    }
    for (let index = this.pendingTasks.length - 1; index >= 0; index -= 1) {
      const pending = this.pendingTasks[index];
      if (pending.task.sessionId !== sessionId) continue;
      this.pendingTasks.splice(index, 1);
      pending.controller.abort();
      pending.reject(new ImageEditTaskCancelledError(pending.task.id));
    }
    for (const active of this.activeTasks.values()) {
      if (active.task.sessionId === sessionId) active.controller.abort();
    }
  }

  snapshot(): ImageEditRenderSchedulerSnapshot {
    return {
      runningGpu: this.runningGpu,
      runningCpu: this.runningCpu,
      pendingPreviewSessions: this.pendingPreviews.size,
      pendingOtherTasks: this.pendingTasks.length,
      activePreviewSessions: this.activePreviewSessions.size,
    };
  }

  private enqueuePreview<T>(scheduled: ScheduledTask<T>): void {
    const sessionId = scheduled.task.sessionId;
    const pending = this.pendingPreviews.get(sessionId);
    if (pending) {
      pending.controller.abort();
      pending.reject(new ImageEditTaskSupersededError(pending.task.id));
    }
    const active = [...this.activeTasks.values()].find((candidate) => (
      candidate.task.kind === 'preview' && candidate.task.sessionId === sessionId
    ));
    if (active && scheduled.task.revision > active.task.revision) active.controller.abort();
    this.pendingPreviews.set(sessionId, scheduled as ScheduledTask);
  }

  private pump(): void {
    let candidate = this.nextRunnable();
    while (candidate) {
      this.removePending(candidate);
      this.start(candidate);
      candidate = this.nextRunnable();
    }
  }

  private nextRunnable(): ScheduledTask | null {
    const candidates = [
      ...this.pendingTasks,
      ...[...this.pendingPreviews.values()].filter((candidate) => (
        !this.activePreviewSessions.has(candidate.task.sessionId)
      )),
    ].filter((candidate) => this.hasLaneCapacity(candidate.task.lane));
    candidates.sort((left, right) => (
      right.task.priority - left.task.priority || left.sequence - right.sequence
    ));
    return candidates[0] ?? null;
  }

  private hasLaneCapacity(lane: ImageEditRenderLane): boolean {
    return lane === 'gpu' ? this.runningGpu < 1 : this.runningCpu < this.cpuConcurrency;
  }

  private removePending(scheduled: ScheduledTask): void {
    if (scheduled.task.kind === 'preview') {
      if (this.pendingPreviews.get(scheduled.task.sessionId) === scheduled) {
        this.pendingPreviews.delete(scheduled.task.sessionId);
      }
      return;
    }
    const index = this.pendingTasks.indexOf(scheduled);
    if (index >= 0) this.pendingTasks.splice(index, 1);
  }

  private start(scheduled: ScheduledTask): void {
    this.activeTasks.set(scheduled.task.id, scheduled);
    if (scheduled.task.lane === 'gpu') this.runningGpu += 1;
    else this.runningCpu += 1;
    if (scheduled.task.kind === 'preview') {
      this.activePreviewSessions.add(scheduled.task.sessionId);
    }
    const context: ImageEditRenderTaskContext = {
      signal: scheduled.controller.signal,
      yieldAfterAtomicUnit: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      },
    };
    void scheduled.task.run(context).then(
      (value) => scheduled.resolve(value),
      (error: unknown) => scheduled.reject(error),
    ).finally(() => {
      this.activeTasks.delete(scheduled.task.id);
      if (scheduled.task.lane === 'gpu') this.runningGpu -= 1;
      else this.runningCpu -= 1;
      if (scheduled.task.kind === 'preview') {
        this.activePreviewSessions.delete(scheduled.task.sessionId);
      }
      this.pump();
    });
  }
}

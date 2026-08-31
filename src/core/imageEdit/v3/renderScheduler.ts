export type ImageEditRenderLane = 'gpu' | 'cpu';
export type ImageEditRenderTaskKind = 'preview' | 'export' | 'prefetch';
export type ImageEditRenderPurpose = 'display' | 'thumbnail' | 'export' | 'prefetch';

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
  /** 同一会话内可以互相替代的画面流；未提供时默认为 display。 */
  coalescingKey?: string;
  revision: number;
  kind: ImageEditRenderTaskKind;
  purpose?: ImageEditRenderPurpose;
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
  private readonly taskIds = new Set<string>();
  private sequence = 0;
  private runningGpu = 0;
  private runningCpu = 0;
  private runningCpuExports = 0;

  constructor(options: ImageEditRenderSchedulerOptions = {}) {
    const cpuConcurrency = options.cpuConcurrency ?? 2;
    if (!Number.isSafeInteger(cpuConcurrency) || cpuConcurrency < 1 || cpuConcurrency > 8) {
      throw new Error('CPU 解码并发必须是 1～8 的整数');
    }
    this.cpuConcurrency = cpuConcurrency;
  }

  schedule<T>(task: ImageEditRenderTask<T>): Promise<T> {
    if (
      !task.id
      || !task.sessionId
      || !Number.isSafeInteger(task.revision)
      || task.revision < 0
      || !Number.isFinite(task.priority)
      || (task.lane !== 'gpu' && task.lane !== 'cpu')
      || !['preview', 'export', 'prefetch'].includes(task.kind)
    ) {
      return Promise.reject(new Error('图片编辑任务身份无效'));
    }
    if (this.taskIds.has(task.id)) {
      return Promise.reject(new Error(`图片编辑任务 ID 重复：${task.id}`));
    }
    return new Promise<T>((resolve, reject) => {
      const scheduled: ScheduledTask<T> = {
        task,
        controller: new AbortController(),
        sequence: ++this.sequence,
        resolve,
        reject,
      };
      this.taskIds.add(task.id);
      if (task.kind === 'preview') this.enqueuePreview(scheduled);
      else this.pendingTasks.push(scheduled as ScheduledTask);
      this.pump();
    });
  }

  cancelSession(sessionId: string): void {
    for (const [key, pendingPreview] of this.pendingPreviews) {
      if (pendingPreview.task.sessionId !== sessionId) continue;
      this.pendingPreviews.delete(key);
      const error = new ImageEditTaskCancelledError(pendingPreview.task.id);
      pendingPreview.controller.abort(error);
      this.taskIds.delete(pendingPreview.task.id);
      pendingPreview.reject(error);
    }
    for (let index = this.pendingTasks.length - 1; index >= 0; index -= 1) {
      const pending = this.pendingTasks[index];
      if (pending.task.sessionId !== sessionId) continue;
      this.pendingTasks.splice(index, 1);
      const error = new ImageEditTaskCancelledError(pending.task.id);
      pending.controller.abort(error);
      this.taskIds.delete(pending.task.id);
      pending.reject(error);
    }
    for (const active of this.activeTasks.values()) {
      if (active.task.sessionId === sessionId) {
        active.controller.abort(new ImageEditTaskCancelledError(active.task.id));
      }
    }
  }

  cancelTask(taskId: string): void {
    const pendingPreview = [...this.pendingPreviews.entries()].find(([, candidate]) => (
      candidate.task.id === taskId
    ));
    if (pendingPreview) {
      this.pendingPreviews.delete(pendingPreview[0]);
      this.cancelPending(pendingPreview[1]);
      return;
    }
    const pendingIndex = this.pendingTasks.findIndex((candidate) => candidate.task.id === taskId);
    if (pendingIndex >= 0) {
      const [pending] = this.pendingTasks.splice(pendingIndex, 1);
      if (pending) this.cancelPending(pending);
      return;
    }
    const active = this.activeTasks.get(taskId);
    if (active) active.controller.abort(new ImageEditTaskCancelledError(taskId));
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
    const flowKey = this.previewFlowKey(scheduled.task);
    const pending = this.pendingPreviews.get(flowKey);
    const active = [...this.activeTasks.values()].find((candidate) => (
      candidate.task.kind === 'preview'
      && this.previewFlowKey(candidate.task) === flowKey
    ));
    const newestRevision = Math.max(
      pending?.task.revision ?? -1,
      active?.task.revision ?? -1,
    );
    if (scheduled.task.revision < newestRevision) {
      const error = new ImageEditTaskSupersededError(scheduled.task.id);
      scheduled.controller.abort(error);
      this.taskIds.delete(scheduled.task.id);
      scheduled.reject(error);
      return;
    }
    if (pending) {
      const error = new ImageEditTaskSupersededError(pending.task.id);
      pending.controller.abort(error);
      this.taskIds.delete(pending.task.id);
      pending.reject(error);
    }
    // 同 revision 的 PreviewOverride 也代表更新帧；协作取消旧任务，并在其返回时
    // 再检查 signal，保证旧帧绝不覆盖已经排队的新帧。
    if (active) active.controller.abort(new ImageEditTaskSupersededError(active.task.id));
    this.pendingPreviews.set(flowKey, scheduled as ScheduledTask);
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
        !this.activePreviewSessions.has(this.previewFlowKey(candidate.task))
      )),
    ].filter((candidate) => this.hasLaneCapacity(candidate.task));
    candidates.sort((left, right) => (
      right.task.priority - left.task.priority || left.sequence - right.sequence
    ));
    return candidates[0] ?? null;
  }

  private hasLaneCapacity(task: ImageEditRenderTask<unknown>): boolean {
    if (task.lane === 'gpu') return this.runningGpu < 1;
    if (this.runningCpu >= this.cpuConcurrency) return false;
    // 两条同时导出的像素流水线不能吃光解码池；始终给交互读取/分析留一个 CPU 槽。
    return task.kind !== 'export' || this.runningCpuExports < 1;
  }

  private removePending(scheduled: ScheduledTask): void {
    if (scheduled.task.kind === 'preview') {
      const flowKey = this.previewFlowKey(scheduled.task);
      if (this.pendingPreviews.get(flowKey) === scheduled) {
        this.pendingPreviews.delete(flowKey);
      }
      return;
    }
    const index = this.pendingTasks.indexOf(scheduled);
    if (index >= 0) this.pendingTasks.splice(index, 1);
  }

  private start(scheduled: ScheduledTask): void {
    this.activeTasks.set(scheduled.task.id, scheduled);
    if (scheduled.task.lane === 'gpu') this.runningGpu += 1;
    else {
      this.runningCpu += 1;
      if (scheduled.task.kind === 'export') this.runningCpuExports += 1;
    }
    if (scheduled.task.kind === 'preview') {
      this.activePreviewSessions.add(this.previewFlowKey(scheduled.task));
    }
    const context: ImageEditRenderTaskContext = {
      signal: scheduled.controller.signal,
      yieldAfterAtomicUnit: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      },
    };
    void scheduled.task.run(context).then(
      (value) => {
        if (scheduled.controller.signal.aborted) {
          scheduled.reject(this.abortReason(scheduled));
        } else {
          scheduled.resolve(value);
        }
      },
      (error: unknown) => scheduled.reject(
        scheduled.controller.signal.aborted ? this.abortReason(scheduled) : error,
      ),
    ).finally(() => {
      this.activeTasks.delete(scheduled.task.id);
      this.taskIds.delete(scheduled.task.id);
      if (scheduled.task.lane === 'gpu') this.runningGpu -= 1;
      else {
        this.runningCpu -= 1;
        if (scheduled.task.kind === 'export') this.runningCpuExports -= 1;
      }
      if (scheduled.task.kind === 'preview') {
        this.activePreviewSessions.delete(this.previewFlowKey(scheduled.task));
      }
      this.pump();
    });
  }

  private abortReason(scheduled: ScheduledTask): unknown {
    return scheduled.controller.signal.reason
      ?? new ImageEditTaskCancelledError(scheduled.task.id);
  }

  private cancelPending(scheduled: ScheduledTask): void {
    const error = new ImageEditTaskCancelledError(scheduled.task.id);
    scheduled.controller.abort(error);
    this.taskIds.delete(scheduled.task.id);
    scheduled.reject(error);
  }

  private previewFlowKey(task: ImageEditRenderTask<unknown>): string {
    return `${task.sessionId}:${task.coalescingKey?.trim() || 'display'}`;
  }
}

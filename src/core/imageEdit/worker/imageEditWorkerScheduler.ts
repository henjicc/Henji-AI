interface ScheduledTask {
  readonly run: () => Promise<void>
  readonly onDropped: () => void
}

/**
 * 图片编辑 Worker 的单设备调度器：控制任务优先，其次是最新预览，最后才是导出。
 * 同一 previewScope 只保留一个运行中任务和一个 latest-pending，避免滑杆产生 FIFO 积压。
 */
export class ImageEditWorkerScheduler {
  private readonly controls: ScheduledTask[] = []
  private readonly exports: ScheduledTask[] = []
  private readonly previews = new Map<string, ScheduledTask>()
  private active = false
  private destroyed = false

  enqueueControl(task: ScheduledTask): void {
    this.enqueue(this.controls, task)
  }

  enqueueExport(task: ScheduledTask): void {
    this.enqueue(this.exports, task)
  }

  enqueuePreview(scopeId: string, task: ScheduledTask): void {
    if (this.destroyed) {
      task.onDropped()
      return
    }
    this.previews.get(scopeId)?.onDropped()
    this.previews.set(scopeId, task)
    void this.drain()
  }

  invalidatePending(): void {
    this.dropTasks(this.controls)
    this.dropTasks(this.exports)
    for (const task of this.previews.values()) task.onDropped()
    this.previews.clear()
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.invalidatePending()
  }

  private enqueue(queue: ScheduledTask[], task: ScheduledTask): void {
    if (this.destroyed) {
      task.onDropped()
      return
    }
    queue.push(task)
    void this.drain()
  }

  private async drain(): Promise<void> {
    if (this.active || this.destroyed) return
    this.active = true
    try {
      while (!this.destroyed) {
        const task = this.takeNext()
        if (!task) return
        await task.run()
      }
    } finally {
      this.active = false
      if (!this.destroyed && this.hasPending()) void this.drain()
    }
  }

  private takeNext(): ScheduledTask | undefined {
    const control = this.controls.shift()
    if (control) return control
    const preview = this.previews.entries().next().value as
      | [string, ScheduledTask]
      | undefined
    if (preview) {
      this.previews.delete(preview[0])
      return preview[1]
    }
    return this.exports.shift()
  }

  private hasPending(): boolean {
    return this.controls.length > 0
      || this.previews.size > 0
      || this.exports.length > 0
  }

  private dropTasks(tasks: ScheduledTask[]): void {
    for (const task of tasks) task.onDropped()
    tasks.length = 0
  }
}

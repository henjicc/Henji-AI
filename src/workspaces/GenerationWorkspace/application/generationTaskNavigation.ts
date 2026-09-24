type RevealTask = (taskId: string) => void
let revealTask: RevealTask | undefined

/** 列表拥有滚动实现；调用方只传任务身份，不依赖离屏卡片是否已经挂载。 */
export function registerGenerationTaskReveal(handler: RevealTask): () => void {
  revealTask = handler
  return () => { if (revealTask === handler) revealTask = undefined }
}

export function revealGenerationTask(taskId: string): void {
  revealTask?.(taskId)
}

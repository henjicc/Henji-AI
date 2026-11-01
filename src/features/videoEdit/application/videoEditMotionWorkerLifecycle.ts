interface MotionWorkerLifecycle {
  isOpen(documentId: string): boolean
  ownerOf(sequenceId: string): string | undefined
  subscribe(listener: () => void): () => void
}
export let videoEditMotionWorkerLifecycle: MotionWorkerLifecycle | undefined
/** 实例服务提供生命周期事实，计算客户端不反向依赖文档编辑服务。 */
export function setVideoEditMotionWorkerLifecycle(value: MotionWorkerLifecycle): void { videoEditMotionWorkerLifecycle = value }

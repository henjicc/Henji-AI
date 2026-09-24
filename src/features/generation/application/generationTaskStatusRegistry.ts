export interface GenerationTaskStatusSnapshot {
  taskId: string
  status: string
  progress: number
  modelId: string
  mediaType: 'image' | 'video' | 'audio'
  resultAvailable: boolean
  errorCode: string | null
  errorMessage: string | null
  cancellable?: boolean
  waitingExternal?: boolean
  origin?: 'canvas'
}

const snapshots = new Map<string, GenerationTaskStatusSnapshot>()
const canvasSnapshots = new Map<string, GenerationTaskStatusSnapshot>()

// 快照只含原始值，浅拷贝即可隔离调用方写入；避免万条历史每次同步逐条 structuredClone。
function copySnapshot(snapshot: GenerationTaskStatusSnapshot): GenerationTaskStatusSnapshot {
  return { ...snapshot }
}

export function publishCanvasGenerationTaskStatus(snapshot: GenerationTaskStatusSnapshot): void {
  canvasSnapshots.set(snapshot.taskId, { ...copySnapshot(snapshot), origin: 'canvas' })
}

export function replaceGenerationTaskStatusSnapshots(next: GenerationTaskStatusSnapshot[]): void {
  snapshots.clear()
  for (const snapshot of next) snapshots.set(snapshot.taskId, copySnapshot(snapshot))
}

export function listGenerationTaskStatusSnapshots(): GenerationTaskStatusSnapshot[] {
  return [...new Map([...snapshots, ...canvasSnapshots]).values()].map(copySnapshot)
}

export function readGenerationTaskStatusSnapshot(taskId: string): GenerationTaskStatusSnapshot | null {
  const snapshot = canvasSnapshots.get(taskId) ?? snapshots.get(taskId)
  return snapshot ? copySnapshot(snapshot) : null
}

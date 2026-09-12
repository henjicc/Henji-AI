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
}

const snapshots = new Map<string, GenerationTaskStatusSnapshot>()
const canvasSnapshots = new Map<string, GenerationTaskStatusSnapshot>()

export function publishCanvasGenerationTaskStatus(snapshot: GenerationTaskStatusSnapshot): void {
  canvasSnapshots.set(snapshot.taskId, structuredClone(snapshot))
}

export function replaceGenerationTaskStatusSnapshots(next: GenerationTaskStatusSnapshot[]): void {
  snapshots.clear()
  for (const snapshot of next) snapshots.set(snapshot.taskId, structuredClone(snapshot))
}

export function listGenerationTaskStatusSnapshots(): GenerationTaskStatusSnapshot[] {
  return [...snapshots.values(), ...canvasSnapshots.values()].map((snapshot) => structuredClone(snapshot))
}

export function readGenerationTaskStatusSnapshot(taskId: string): GenerationTaskStatusSnapshot | null {
  const snapshot = snapshots.get(taskId) ?? canvasSnapshots.get(taskId)
  return snapshot ? structuredClone(snapshot) : null
}

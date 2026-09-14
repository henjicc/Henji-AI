const operations = new Map<string, { barrier: Promise<void>; release: () => void }>()
const versions = new Map<string, number>()

export function holdCameraStageProjectExecution(projectId: string): () => void {
  let release!: () => void
  const barrier = new Promise<void>((resolve) => { release = resolve })
  const operation = { barrier, release }
  operations.set(projectId, operation)
  versions.set(projectId, (versions.get(projectId) ?? 0) + 1)
  return () => { if (operations.get(projectId) === operation) operations.delete(projectId); release() }
}

export async function readAfterCameraStageProjectExecution<T>(projectId: string, read: () => Promise<T>): Promise<T> {
  for (;;) {
    await operations.get(projectId)?.barrier
    const version = versions.get(projectId)
    const result = await read()
    if (!operations.has(projectId) && version === versions.get(projectId)) return result
  }
}

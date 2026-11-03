const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
let sequence = 0
worker.onmessage = ({ data }) => {
  const job = pending.get(data.id)
  if (!job) return
  pending.delete(data.id)
  if (data.error) job.reject(new Error(data.error))
  else job.resolve(data.result)
}
Object.assign(window, { runCodeOutputBench: async (scenario: string, reuse: boolean, diagnostics: boolean, count?: number) => {
  const old = document.querySelector('canvas')!, canvas = document.createElement('canvas')
  canvas.width = 1920; canvas.height = 1080; old.replaceWith(canvas)
  const surface = canvas.transferControlToOffscreen(), id = ++sequence
  const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  worker.postMessage({ id, scenario, reuse, diagnostics, count, surface }, [surface])
  return result
} })

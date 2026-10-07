import { parentPort, workerData } from 'node:worker_threads'
import { FontScanner, type InternalFace } from './scanner'
export type FontWorkerRequest = { id: number } & ({ kind: 'scan' } | { kind: 'import'; paths: string[] } | { kind: 'remove'; face: InternalFace } | { kind: 'read'; face: InternalFace })
const scanner = new FontScanner((workerData as { library: string }).library)
let queue = Promise.resolve()
parentPort?.on('message', (request: FontWorkerRequest) => {
  queue = queue.then(async () => {
    try {
      let result: unknown
      if (request.kind === 'read') result = await scanner.read(request.face)
      else {
        if (request.kind === 'import') for (const file of request.paths) await scanner.importFile(file)
        if (request.kind === 'remove') await scanner.remove(request.face)
        result = await scanner.scan()
      }
      parentPort?.postMessage({ id: request.id, result })
    } catch (error) { parentPort?.postMessage({ id: request.id, error: error instanceof Error ? error.message : String(error) }) }
  })
})

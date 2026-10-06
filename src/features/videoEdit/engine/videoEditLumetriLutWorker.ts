import { decodeVideoEditLut } from './videoEditLumetriLutSource'
import { suggestLumetriAutoColor } from '@/core/videoEdit/lumetri'
import { suggestLumetriMatch } from '@/core/videoEdit/lumetriMatch'
import type { LumetriWorkerRequest } from '../application/videoEditLumetriLutClient'
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<LumetriWorkerRequest>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
scope.onmessage = event => {
  const payload = event.data
  if (payload.kind === 'lut') {
    void decodeVideoEditLut(payload.bytes).then(result => scope.postMessage(result, [result.lut.data.buffer]), error => scope.postMessage({ error: error instanceof Error ? error.message : String(error) }))
  } else {
    try { scope.postMessage({ parameters: payload.reference ? suggestLumetriMatch(payload.pixels, payload.reference, payload.method) : suggestLumetriAutoColor(payload.pixels) }) }
    catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
  }
}

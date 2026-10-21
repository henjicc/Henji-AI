import { decodeVideoEditLut } from './videoEditColorLutSource'
import { suggestColorGradeAutoColor } from '@/core/videoEdit/colorGrade'
import { suggestColorGradeMatch } from '@/core/videoEdit/colorGradeMatch'
import { suggestColorGradeMklMatch } from '@/core/imaging/adjustments/autoGrade'
import type { ColorGradeWorkerRequest } from '../application/videoEditColorLutClient'
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<ColorGradeWorkerRequest>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void }
scope.onmessage = event => {
  const payload = event.data
  if (payload.kind === 'lut') {
    void decodeVideoEditLut(payload.bytes).then(result => scope.postMessage(result, [result.lut.data.buffer]), error => scope.postMessage({ error: error instanceof Error ? error.message : String(error) }))
  } else {
    try { scope.postMessage({ parameters: payload.reference ? (payload.method ?? 'mkl') === 'mkl' ? suggestColorGradeMklMatch(payload.pixels, payload.reference) : suggestColorGradeMatch(payload.pixels, payload.reference, payload.method === 'histogram' ? 'histogram' : 'moments') : suggestColorGradeAutoColor(payload.pixels, 255, payload.width) }) }
    catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
  }
}

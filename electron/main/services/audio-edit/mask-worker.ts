import { parentPort, workerData } from 'node:worker_threads'
import { rasterAudioRepairMask } from '../../../../src/core/audioEdit/brushMask'
import type { AudioEditRepair } from '../../../../src/core/audioEdit/regions'
const input = workerData as { strokes: NonNullable<AudioEditRepair['strokes']>; width: number; height: number }
const result = rasterAudioRepairMask(input.strokes, input.width, input.height)
parentPort?.postMessage(result, [result.buffer as ArrayBuffer])

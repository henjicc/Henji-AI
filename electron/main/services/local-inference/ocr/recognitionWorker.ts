import { parentPort, workerData } from 'node:worker_threads'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import { recognizeCrops, type PixelCrop, type RecognitionNormalization } from './recognition'

const port = parentPort!
const config = workerData as { modelPath: string; threads: number; alphabet: string[]; normalization: RecognitionNormalization }
const session = loadOnnxRuntime().then(runtime => new LocalModelSessions(runtime, () => undefined).open(
  { name: 'ppocr_rec', path: config.modelPath }, ['cpu'], 'dynamic', { intraOpNumThreads: config.threads, allowSpinning: false },
))
port.on('message', async (message: { rgb: SharedArrayBuffer; width: number; crops: PixelCrop[] }) => {
  try {
    const result = await recognizeCrops(new Uint8Array(message.rgb), message.width, message.crops, await session, config.alphabet, new AbortController().signal, config.normalization)
    port.postMessage({ result })
  } catch (error) { port.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
})
// Initialization failures belong to the worker error channel, even before its first batch.
void session.catch(error => { throw error })

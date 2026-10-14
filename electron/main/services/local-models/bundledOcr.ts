import path from 'node:path'
import { verifyFile } from '../download/verifiedDownload'

/** Application resources only: never registered as downloadable/user-managed models. Apache-2.0. */
export const BUNDLED_OCR_MODELS = {
  text_detection_ppocr: [
    { name: 'pp-ocrv6_tiny_det.onnx', role: 'model', sizeBytes: 1780590, sha256: '193bab7a04fca699a6c82e6abb5b81bdb28177f0abd4062552b04908dafb19f8' },
  ],
  text_recognition_ppocr: [
    // Henji AI / author quantized MatMul/Gemm only; Apache-2.0 Section 4 modification notice in licenses.
    { name: 'pp-ocrv6_tiny_rec_int8.onnx', role: 'model', sizeBytes: 2768469, sha256: 'e90b3609f24020955ff236f73d95982466b6fe934c80a90d7f8e6dfaaa61d02b' },
    { name: 'ppocrv6_tiny_dict.txt', role: 'dict', sizeBytes: 27156, sha256: 'c5cbe34ef40c29c4df07ed012bf96569cb69a2d2a01a07027e9f13cb832bd9cd' },
  ],
} as const
export type BundledOcrModelId = keyof typeof BUNDLED_OCR_MODELS
export function isBundledOcrModel(id: string): id is BundledOcrModelId {
  return Object.prototype.hasOwnProperty.call(BUNDLED_OCR_MODELS, id)
}

/** Development main lives in out/main; packaged apps only consult resourcesPath. */
export function bundledModelsDirectory(context: { isPackaged: boolean; resourcesPath: string; mainDirectory: string }): string {
  const root = context.isPackaged ? context.resourcesPath : path.resolve(context.mainDirectory, '../..')
  return path.join(root, 'resources', 'local-models')
}

/** Reuse the existing byte verifier; neither network access nor directory writes are possible here. */
export async function resolveBundledOcrModel(directory: string, id: BundledOcrModelId, role: 'model' | 'dict' = 'model'): Promise<string> {
  const files = BUNDLED_OCR_MODELS[id]
  const file = files.find(entry => entry.role === role)
  if (!file || !(await Promise.all(files.map(entry => verifyFile(path.join(directory, id, entry.name), entry)))).every(state => state === 'ok')) {
    throw new Error('应用内置文字模型缺失或损坏，请重新安装应用。')
  }
  return path.join(directory, id, file.name)
}

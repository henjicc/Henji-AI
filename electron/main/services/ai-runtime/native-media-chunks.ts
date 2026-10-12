import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { AiRuntimeError, inferMimeFromPath, type MediaReader } from '@henjicc/ai-sdk'
import { scopedUploadFile } from './native-file-upload'

/** Metadata and bounded reads share the native-upload path grants, including resolved symlinks. */
export const nativeMediaChunks: Required<Pick<MediaReader, 'describe' | 'readChunk'>> = {
  async describe(ref) {
    const file = await scopedUploadFile(ref)
    const metadata = await stat(file)
    return { size: metadata.size, mimeType: inferMimeFromPath(file), filename: path.basename(file) }
  },
  async readChunk(ref, offset, length) {
    // This is the SDK MediaReader contract's chunk ceiling, not a product/file-count limit.
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0 || length > 64 * 1024) {
      throw new AiRuntimeError('invalid_parameter', '媒体分块范围无效')
    }
    const file = await open(await scopedUploadFile(ref), 'r')
    try {
      const buffer = new Uint8Array(length)
      const { bytesRead } = await file.read(buffer, 0, length, offset)
      return buffer.subarray(0, bytesRead)
    } finally {
      await file.close()
    }
  },
}

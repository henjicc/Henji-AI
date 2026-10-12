import { constants, openAsBlob } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { AiRuntimeError, assertMediaSize, inferMimeFromPath, normalizeLocalSource, type Transport } from '@henjicc/ai-sdk'
import { isPathWithinAllowedMediaRoots, isRealPathWithinAllowedMediaRoots } from '../../protocol'

/** Resolve both the reference and symlink destination within the existing media grants. */
export async function scopedUploadFile(ref: string): Promise<string> {
  const local = normalizeLocalSource(ref.trim())
  if (!local || !isPathWithinAllowedMediaRoots(local)) throw new AiRuntimeError('media_scope_denied', '素材不在已授权的文件范围内')
  const resolved = await realpath(local)
  if (!(await isRealPathWithinAllowedMediaRoots(resolved))) throw new AiRuntimeError('media_scope_denied', '素材实际位置不在已授权的文件范围内')
  await access(resolved, constants.R_OK)
  if (!(await stat(resolved)).isFile()) throw new AiRuntimeError('invalid_media', '上传素材必须是可读文件')
  return resolved
}

/** Node's file-backed Blob checks file identity on every read; FormData supplies streaming multipart. */
export function createNativeFileUpload(send: Transport['fetch']): NonNullable<Transport['uploadFile']> {
  return async (url, input) => {
    input.signal.throwIfAborted()
    const endpoint = new URL(url)
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new AiRuntimeError('invalid_media_url', '上传地址必须使用 HTTP(S)')
    if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) throw new AiRuntimeError('invalid_upload_limit', '上传大小限制无效')
    const file = await scopedUploadFile(input.ref)
    const before = await stat(file)
    if (!before.isFile()) throw new AiRuntimeError('invalid_media', '上传素材必须是文件')
    const mimeType = inferMimeFromPath(file)
    const filename = path.basename(file)
    assertMediaSize({ size: before.size, mimeType, filename }, input.maxBytes)
    const blob = await openAsBlob(file, { type: mimeType })
    const after = await stat(file)
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || blob.size !== before.size) {
      throw new AiRuntimeError('media_changed', '上传前素材已改变，请重新读取素材')
    }
    input.signal.throwIfAborted()
    const body = new FormData()
    for (const [name, value] of input.fields) body.append(name, value)
    body.append(input.fileField, blob, filename)
    // No retries or media API callbacks. HTTP errors remain Response; network errors retain cause.
    return send(url, { method: 'POST', body, signal: input.signal, redirect: 'error' })
  }
}

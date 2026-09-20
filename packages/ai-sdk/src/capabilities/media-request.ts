import { strToU8 } from 'fflate'
import { assertMediaSize, rethrowMediaError } from '../runtime/MediaReader'
import { AiRuntimeError, cancelledError } from '../runtime/AiRuntimeError'
import type { MediaDescription, ResolvedRuntimeContext } from '../runtime'
import { toBase64, toDataUri } from '../upload/base64'
import { readCapabilityMediaSource, type CapabilityMediaSource } from './media'

const CHUNK_BYTES = 48 * 1024 // divisible by 3 for base64, below the host's 64 KiB ceiling

export interface PreparedMedia {
  description: MediaDescription
  chunks: AsyncIterable<Uint8Array>
  /** Only legacy read()/explicit bytes inputs have a complete buffer. */
  bytes?: Uint8Array
}

export async function prepareMedia(
  source: CapabilityMediaSource, runtime: ResolvedRuntimeContext, maxBytes: number, signal: AbortSignal
): Promise<PreparedMedia> {
  const check = (): void => { if (signal.aborted) throw cancelledError('media-upload') }
  check()
  if (source.kind === 'media-ref' && runtime.media.describe && runtime.media.readChunk) {
    const description = await runtime.media.describe(source.ref).catch(rethrowMediaError)
    check()
    assertMediaSize(description, maxBytes)
    if (source.mediaType && source.mediaType !== description.mimeType) {
      throw new AiRuntimeError('capability_media_type_mismatch', 'Host media type differs from the requested type')
    }
    if (!runtime.transport.fetchStream) throw new AiRuntimeError('streaming_upload_unsupported', '宿主尚未接入流式请求体传输')
    return { description, chunks: (async function* () {
      let offset = 0
      while (offset < description.size) {
        check()
        const length = Math.min(CHUNK_BYTES, description.size - offset)
        const chunk = await runtime.media.readChunk!(source.ref, offset, length).catch(rethrowMediaError)
        check()
        if (!(chunk instanceof Uint8Array) || chunk.length === 0 || chunk.length > length) {
          throw new AiRuntimeError('invalid_media_chunk', 'Host media chunk does not match the declared size')
        }
        offset += chunk.length
        yield chunk
      }
    })() }
  }
  // Old hosts remain compatible. Their read() allocation limit must NOT be raised.
  const media = await readCapabilityMediaSource(source, runtime.media).catch(rethrowMediaError)
  check()
  const description = { size: media.bytes.byteLength, mimeType: media.mimeType, filename: media.filename }
  assertMediaSize(description, maxBytes)
  return { description, bytes: media.bytes, chunks: (async function* () {
    for (let offset = 0; offset < media.bytes.length; offset += CHUNK_BYTES) {
      check()
      yield media.bytes.subarray(offset, offset + CHUNK_BYTES)
    }
  })() }
}

export interface MediaRequest {
  body: BodyInit | AsyncIterable<Uint8Array>
  contentType?: string
  contentLength?: number
}

export async function sendMediaRequest(
  runtime: ResolvedRuntimeContext, url: string, init: Omit<RequestInit, 'body'>, request: MediaRequest
): Promise<Response> {
  const headers = new Headers(init.headers)
  if (request.contentType) headers.set('Content-Type', request.contentType)
  if (request.contentLength !== undefined) {
    if (!runtime.transport.fetchStream) throw new AiRuntimeError('streaming_upload_unsupported', '宿主尚未接入流式请求体传输')
    const iterator = (request.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]()
    try {
      return await runtime.transport.fetchStream(url, {
        ...init, headers, body: { [Symbol.asyncIterator]: () => iterator }, contentLength: request.contentLength,
      })
    } finally {
      await iterator.return?.()
    }
  }
  return runtime.transport.fetch(url, { ...init, headers, body: request.body as BodyInit })
}

export function jsonAudioRequest(media: PreparedMedia, build: (data: string) => unknown): MediaRequest {
  if (media.bytes) return { body: JSON.stringify(build(toDataUri(media.bytes, media.description.mimeType))), contentType: 'application/json' }
  let marker = '__sdk_audio_payload__'
  let serialized = JSON.stringify(build(marker))
  while (serialized.split(JSON.stringify(marker)).length !== 2) {
    marker += '_'
    serialized = JSON.stringify(build(marker))
  }
  const [before, after] = serialized.split(JSON.stringify(marker))
  const prefix = strToU8(before + JSON.stringify(`data:${media.description.mimeType};base64,`).slice(0, -1))
  const suffix = strToU8('"' + after)
  return {
    contentType: 'application/json',
    contentLength: prefix.length + 4 * Math.ceil(media.description.size / 3) + suffix.length,
    body: (async function* () {
      yield prefix
      let remainder = new Uint8Array(0)
      for await (const chunk of media.chunks) {
        const bytes = new Uint8Array(remainder.length + chunk.length)
        bytes.set(remainder); bytes.set(chunk, remainder.length)
        const end = bytes.length - bytes.length % 3
        if (end) yield strToU8(toBase64(bytes.subarray(0, end)))
        remainder = bytes.slice(end)
      }
      if (remainder.length) yield strToU8(toBase64(remainder))
      yield suffix
    })(),
  }
}

export function multipartAudioRequest(media: PreparedMedia, fields: readonly (readonly [string, string])[]): MediaRequest {
  if (!media.description.size) throw new AiRuntimeError('invalid_media', 'Transcription audio is empty')
  if (media.bytes) {
    const form = new FormData()
    for (const [key, value] of fields) form.append(key, value)
    form.append('file', new Blob([new Uint8Array(media.bytes)], { type: media.description.mimeType }), media.description.filename)
    return { body: form }
  }
  const boundary = `henji-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const quote = (value: string): string => value.replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/"/g, '%22')
  const mime = media.description.mimeType
  if (/[\r\n]/.test(mime)) throw new AiRuntimeError('invalid_media', 'Invalid media MIME type')
  const prefix = strToU8(fields.map(([key, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${quote(key)}"\r\n\r\n${value}\r\n`
  ).join('') + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${quote(media.description.filename)}"\r\nContent-Type: ${mime}\r\n\r\n`)
  const suffix = strToU8(`\r\n--${boundary}--\r\n`)
  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: prefix.length + media.description.size + suffix.length,
    body: (async function* () { yield prefix; yield* media.chunks; yield suffix })(),
  }
}

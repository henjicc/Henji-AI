import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createNativeFileUpload } from './native-file-upload'

const scope = vi.hoisted(() => ({ allowed: true, realAllowed: true }))
vi.mock('../../protocol', () => ({ isPathWithinAllowedMediaRoots: () => scope.allowed, isRealPathWithinAllowedMediaRoots: async () => scope.realAllowed }))
let directory: string
let ref: string
beforeEach(async () => {
  scope.allowed = true
  scope.realAllowed = true
  directory = await mkdtemp(path.join(os.tmpdir(), 'henji-upload-'))
  ref = path.join(directory, 'voice.wav')
  await writeFile(ref, 'test audio')
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
function input(signal = new AbortController().signal) {
  return { ref, fields: [['key', 'object'], ['policy', 'fixture'], ['key', 'second']] as const, fileField: 'file', maxBytes: 10, signal }
}
it('streams an actual multipart request to a local upload server', async () => {
  let received = ''
  const server = createServer(async (request, response) => {
    for await (const chunk of request) received += String(chunk)
    response.writeHead(204).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local fixture has no port')
    const response = await createNativeFileUpload(fetch)(`http://127.0.0.1:${address.port}/upload`, input())
    expect(response.status).toBe(204)
    expect([...received.matchAll(/name="([^"]+)"/g)].map(value => value[1])).toEqual(['key', 'policy', 'key', 'file', 'voice.wav'])
    expect(received).toContain('test audio')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
it('native file multipart preserves policy order, duplicate fields and file-last without media APIs', async () => {
  const send = vi.fn(async (_url: string, init?: RequestInit) => {
    const request = new Request('https://upload.invalid', init)
    const multipart = await request.text()
    expect([...multipart.matchAll(/name="([^"]+)"/g)].map(value => value[1])).toEqual(['key', 'policy', 'key', 'file', 'voice.wav'])
    expect(multipart).toContain('test audio')
    expect(init?.redirect).toBe('error')
    return new Response(null, { status: 204 })
  })
  expect((await createNativeFileUpload(send)('https://upload.invalid', input())).status).toBe(204)
  expect(send).toHaveBeenCalledTimes(1)
})
it('size and scope rejection happen before network with structured size error', async () => {
  const send = vi.fn()
  await expect(createNativeFileUpload(send)('https://upload.invalid', { ...input(), maxBytes: 9 })).rejects.toMatchObject({ code: 'media_too_large', details: { actualBytes: 10, maxBytes: 9 } })
  scope.allowed = false
  await expect(createNativeFileUpload(send)('https://upload.invalid', input())).rejects.toMatchObject({ code: 'media_scope_denied' })
  expect(send).not.toHaveBeenCalled()
})
it('pre-abort avoids file and network work; in-flight abort reaches transport without replay', async () => {
  const controller = new AbortController()
  const send = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.signal).toBe(controller.signal)
    controller.abort()
    init?.signal?.throwIfAborted()
    return new Response()
  })
  const upload = createNativeFileUpload(send)
  await expect(upload('https://upload.invalid', input(controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
  await expect(upload('https://upload.invalid', input(controller.signal))).rejects.toMatchObject({ name: 'AbortError' })
  expect(send).toHaveBeenCalledTimes(1)
})
it('HTTP errors stay responses; transport errors preserve identity/cause without retry', async () => {
  const response = new Response('denied', { status: 403 })
  expect(await createNativeFileUpload(async () => response)('https://upload.invalid', input())).toBe(response)
  const error = new TypeError('network', { cause: { code: 'ECONNRESET' } })
  const send = vi.fn().mockRejectedValue(error)
  await expect(createNativeFileUpload(send)('https://upload.invalid', input())).rejects.toBe(error)
  expect(send).toHaveBeenCalledTimes(1)
})
it('file changes after opening fail reading the native blob', async () => {
  const send = vi.fn(async (_url: string, init?: RequestInit) => {
    await writeFile(ref, 'changed-file-size')
    const file = (init?.body as FormData).get('file') as File
    return new Response(await file.arrayBuffer())
  })
  await expect(createNativeFileUpload(send)('https://upload.invalid', input())).rejects.toThrow()
})

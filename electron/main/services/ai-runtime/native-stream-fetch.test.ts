import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { createNativeStreamFetch } from './native-stream-fetch'

it('streams bytes through actual Node fetch to a local fixture with length, headers and signal', async () => {
  let received = ''
  let length: string | undefined
  const server = createServer(async (request, response) => {
    length = request.headers['content-length']
    for await (const chunk of request) received += String(chunk)
    response.writeHead(204).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Local fixture has no port')
    const body = (async function* () { yield new TextEncoder().encode('ab'); yield new TextEncoder().encode('cd') })()
    const response = await createNativeStreamFetch(fetch)(`http://127.0.0.1:${address.port}`, {
      method: 'POST', body, contentLength: 4, signal: new AbortController().signal,
    })
    expect(response.status).toBe(204)
    expect(received).toBe('abcd')
    expect(length).toBe('4')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})

it('failure and in-flight cancel close the source iterator without replay; pre-abort never sends', async () => {
  const closed = vi.fn()
  const body = (): AsyncIterable<Uint8Array> => (async function* () {
    try { while (true) yield new Uint8Array([1]) } finally { closed() }
  })()
  const controller = new AbortController()
  const error = new Error('network failed')
  const send = vi.fn(async (_url: string, init?: RequestInit) => {
    const stream = init?.body as unknown as Readable
    await stream[Symbol.asyncIterator]().next()
    expect(init?.signal).toBe(controller.signal)
    controller.abort()
    throw error
  })
  const streamedFetch = createNativeStreamFetch(send)
  await expect(streamedFetch('https://fixture.invalid', { body: body(), contentLength: 10, signal: controller.signal })).rejects.toBe(error)
  // Readable.destroy performs asynchronous iterator.return cleanup.
  await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1))
  await expect(streamedFetch('https://fixture.invalid', { body: body(), contentLength: 10, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(send).toHaveBeenCalledTimes(1)
})

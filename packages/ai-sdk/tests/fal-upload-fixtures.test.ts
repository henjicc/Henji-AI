import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { uploadToFalWithTransport } from '../src/upload/fal-transport'

interface FalUploadFixture {
  scenario: string
  abortBeforeStart?: boolean
  prepared: { bytes: number[]; mimeType: string; filename: string }
  responses: Array<{ status: number; body: unknown }>
  expected: {
    outcome: 'resolve' | 'reject'
    url?: string
    errorCode?: string
    messageIncludes?: string
    calls: number
  }
}

const fixtureDir = resolve(__dirname, 'fixtures', 'fal-upload')
const fixtures = readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(resolve(fixtureDir, name), 'utf8')) as FalUploadFixture)

describe('Fal CDN Transport fixtures', () => {
  it.each(fixtures.map((fixture) => [fixture.scenario, fixture] as const))(
    '%s',
    async (_scenario, fixture) => {
      let responseIndex = 0
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        const response = fixture.responses[responseIndex++]
        if (!response) throw new Error('Fixture did not provide a response')
        return new Response(response.body === null ? null : JSON.stringify(response.body), {
          status: response.status,
          headers: response.body === null ? undefined : { 'Content-Type': 'application/json' },
        })
      })
      const controller = new AbortController()
      if (fixture.abortBeforeStart) controller.abort()
      const call = uploadToFalWithTransport(
        'fixture-key',
        {
          bytes: new Uint8Array(fixture.prepared.bytes),
          mimeType: fixture.prepared.mimeType,
          filename: fixture.prepared.filename,
        },
        { fetch: fetchMock },
        controller.signal
      )

      if (fixture.expected.outcome === 'resolve') {
        await expect(call).resolves.toBe(fixture.expected.url)
      } else {
        await expect(call).rejects.toMatchObject({
          code: fixture.expected.errorCode,
          message: expect.stringContaining(fixture.expected.messageIncludes ?? ''),
        })
      }
      expect(fetchMock).toHaveBeenCalledTimes(fixture.expected.calls)

      if (fixture.scenario === 'initiate-put-success') {
        const first = fetchMock.mock.calls[0]
        const second = fetchMock.mock.calls[1]
        expect(first?.[0]).toBe('https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3')
        expect(first?.[1]).toMatchObject({ method: 'POST' })
        expect(JSON.parse(String(first?.[1]?.body))).toEqual({
          content_type: 'image/png',
          file_name: 'reference.png',
        })
        expect(second?.[1]).toMatchObject({
          method: 'PUT',
          headers: { 'Content-Type': 'image/png' },
          body: expect.any(ArrayBuffer),
        })
      }
    }
  )
})

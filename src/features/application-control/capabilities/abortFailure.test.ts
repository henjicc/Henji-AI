// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { ApplicationRevokedReason } from '@/core/application-control/execution/cancelReason'

const boundary = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/platform', async original => ({ ...await original<typeof import('@/platform')>(), getPlatform: () => ({ webReplay: { read: boundary.read } }) }))

import { executeApplicationCapabilityResult } from './registry'

const input = { recordingRef: { kind: 'screen_recording.web_recording', id: '4c4fd189-61bf-4408-afc0-751c8c9ede67' }, track: 'data' }

it('撤销授权中止的在途调用（处理器按 signal.reason 抛出）与原生中止一样回 ABORTED', async () => {
  for (const reason of [new ApplicationRevokedReason(), new DOMException('aborted', 'AbortError')]) {
    boundary.read.mockRejectedValueOnce(reason)
    const result = await executeApplicationCapabilityResult({ id: 'read_web_app_recording', version: 1, input }, { signal: new AbortController().signal })
    expect(result).toMatchObject({ ok: false, error: { code: 'ABORTED', recoverable: false } })
  }
})

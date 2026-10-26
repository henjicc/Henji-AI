import { expect, it, vi } from 'vitest'

vi.mock('@/platform', () => ({ getPlatform: () => ({ webReplay: { render: vi.fn() } }) }))
vi.mock('../useWebAppRecordingSwitch', () => ({ webAppRecordingEnabled: () => false, WEB_APP_RECORDING_DISABLED_MESSAGE: '网页应用录制是实验性功能，尚未开启' }))

import { executeWebAppCapability } from './webAppRecording'

it('实验开关没开时的拒绝标成未执行：打开开关后可以直接重试，不会被当成结果未知挡住', async () => {
  const error = await executeWebAppCapability('render_web_app_replay', { recordingRef: { kind: 'screen_recording.web_recording', id: '4c4fd189-61bf-4408-afc0-751c8c9ede67' } }, {} as never).then(() => null, (value: unknown) => value)
  expect((error as Error).message).toContain('尚未开启')
  expect((error as { details?: { execution?: { notExecuted?: boolean } } }).details?.execution?.notExecuted).toBe(true)
})

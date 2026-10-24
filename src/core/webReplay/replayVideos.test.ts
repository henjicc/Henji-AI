import { expect, it } from 'vitest'

import { isCleanReplayName, newestReplayName } from './replayVideos'

it('干净画面的重演按 .clean.mp4 识别，最新的按渲染时间挑', () => {
  const names = ['backup.mp4', 'replay-2026-10-24T05-59-59-612Z.mp4', 'replay-2026-10-24T06-30-00-000Z.clean.mp4', 'replay-2026-10-24T07-00-00-000Z.mp4', 'recording.json']
  expect(isCleanReplayName('replay-2026-10-24T06-30-00-000Z.clean.mp4')).toBe(true)
  expect(isCleanReplayName('replay-2026-10-24T05-59-59-612Z.mp4')).toBe(false)
  expect(newestReplayName(names)).toBe('replay-2026-10-24T07-00-00-000Z.mp4')
  expect(newestReplayName(names, { clean: true })).toBe('replay-2026-10-24T06-30-00-000Z.clean.mp4')
  expect(newestReplayName(['backup.mp4'], { clean: true })).toBeNull()
})

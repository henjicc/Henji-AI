import { expect, it } from 'vitest'
import { recordingWorkFailure, recordingWorkInProgress, trackRecordingWork } from './recordingWork'

it('后台收尾进行中读得到；做完后失败的原因留给读回，再发起一次就清掉', async () => {
  let fail!: (error: Error) => void
  const work = trackRecordingWork('session', new Promise<void>((_resolve, reject) => { fail = reject }))
  expect(recordingWorkInProgress('session')).toBe(true)
  fail(new Error('磁盘已满'))
  await work.catch(() => undefined)
  await Promise.resolve()
  expect(recordingWorkInProgress('session')).toBe(false)
  expect(recordingWorkFailure('session')).toBe('磁盘已满')
  await trackRecordingWork('session', Promise.resolve())
  expect(recordingWorkFailure('session')).toBeNull()
})

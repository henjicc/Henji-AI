import { expect, it } from 'vitest'
import { z } from 'zod'
import { videoEditUserErrorMessage } from './videoEditUserError'

it('业务错误原样显示，参数校验与内部错误文本转成用户语言', () => {
  expect(videoEditUserErrorMessage(new Error('请先暂停节目播放。'))).toBe('请先暂停节目播放。')
  const zod = z.object({ volume: z.number().max(2) }).safeParse({ volume: 3 }).error!
  expect(videoEditUserErrorMessage(zod)).toBe('数值超出允许范围，已保持原值。')
  expect(videoEditUserErrorMessage(new Error(JSON.stringify(zod.issues)))).toBe('数值超出允许范围，已保持原值。')
  expect(videoEditUserErrorMessage(new Error('失败', { cause: zod }))).toBe('数值超出允许范围，已保持原值。')
})

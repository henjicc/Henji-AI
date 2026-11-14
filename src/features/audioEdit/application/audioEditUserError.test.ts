import { expect, it } from 'vitest'
import { audioEditUserErrorMessage } from './audioEditUserError'

it('去掉给助手用的错误码前缀；处理进程的内部原因与英文原始错误不当正文', () => {
  expect(audioEditUserErrorMessage(new Error('NOT_FOUND：口播不存在或文件已被移走。'))).toBe('口播不存在或文件已被移走。')
  expect(audioEditUserErrorMessage(new Error('VST3_UNAVAILABLE：没有找到可用的 RX 口播处理器，请关闭 VST3 后导出。'))).toBe('没有找到可用的 RX 口播处理器，请关闭 VST3 后导出。')
  expect(audioEditUserErrorMessage(new Error('AUDIO_WORKER_TIMEOUT：音频 Worker 长时间没有进展。'))).toBe('声音处理没有完成（处理超时或意外中断），修改已保留，请重试。')
  expect(audioEditUserErrorMessage(new Error('音频 Worker 异常退出（3）：thread panicked'))).toBe('声音处理没有完成（处理超时或意外中断），修改已保留，请重试。')
  expect(audioEditUserErrorMessage(new Error('ASR_MODEL_UNAVAILABLE'), '转写没有完成。')).toBe('转写没有完成。')
  expect(audioEditUserErrorMessage(new Error('请先选择要处理的声音。'))).toBe('请先选择要处理的声音。')
})

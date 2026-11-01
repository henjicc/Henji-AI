import { expect, it } from 'vitest'
import type { CodeAuthorProgram } from './codeAuthorProgram'
import { codeMaterialUsesAudio } from './codeMaterialResources'

const program = (code: string, files: Record<string, string> = {}, parameters: Array<{ type: string }> = []): CodeAuthorProgram =>
  ({ parameters, bundle: { code, map: '', locations: { layers: {} }, modules: { entry: 'main.js', files } } }) as unknown as CodeAuthorProgram

it('不声明 audio 参数、代码里读 info.audio 或 audioTime 也算用到声音；完全不提声音的不算', () => {
  expect(codeMaterialUsesAudio(program('const level = info.audio ? info.audio.levels[0] : 0'))).toBe(true)
  expect(codeMaterialUsesAudio(program('', { 'beat.js': 'export const at = info => info.audioTime' }))).toBe(true)
  expect(codeMaterialUsesAudio(program('ctx.fillRect(0, 0, 10, 10)', {}, [{ type: 'audio' }]))).toBe(true)
  expect(codeMaterialUsesAudio(program('ctx.fillRect(0, 0, 10, 10)', { 'main.js': 'export default {}' }))).toBe(false)
})

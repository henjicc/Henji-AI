import { expect, it } from 'vitest'
import { chooseVideoEditDecodeBackend, type VideoEditDecodeSupport } from './videoEditFrameSource'

it.each<[string, VideoEditDecodeSupport, ReturnType<typeof chooseVideoEditDecodeBackend>]>([
  ['原生可解时优先原生，即使浏览器也能解', { native: 'decodes', browser: 'decodes' }, 'native'],
  ['原生可解而浏览器不能解（专业格式）', { native: 'decodes', browser: 'cannot-decode' }, 'native'],
  ['原生不可用时回到浏览器', { native: 'unavailable', browser: 'decodes' }, 'browser'],
  ['原生探测失败或缺少解码器时回到浏览器', { native: 'cannot-decode', browser: 'decodes' }, 'browser'],
  ['打开已保存工程时浏览器能力未知，原生不可用仍尝试浏览器', { native: 'unavailable', browser: 'unknown' }, 'browser'],
  ['两者都不能解时无后端，由调用方提示格式', { native: 'cannot-decode', browser: 'cannot-decode' }, undefined],
  ['原生不可用且浏览器不能解时无后端', { native: 'unavailable', browser: 'cannot-decode' }, undefined],
])('%s', (_name, support, expected) => {
  expect(chooseVideoEditDecodeBackend(support)).toBe(expected)
})

it('诊断强制的后端只在它能解时使用，不静默换成另一个', () => {
  expect(chooseVideoEditDecodeBackend({ native: 'decodes', browser: 'decodes' }, 'browser')).toBe('browser')
  expect(chooseVideoEditDecodeBackend({ native: 'decodes', browser: 'cannot-decode' }, 'browser')).toBeUndefined()
  expect(chooseVideoEditDecodeBackend({ native: 'unavailable', browser: 'decodes' }, 'native')).toBeUndefined()
  expect(chooseVideoEditDecodeBackend({ native: 'decodes', browser: 'cannot-decode' }, 'native')).toBe('native')
})

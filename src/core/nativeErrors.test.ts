import { describe, expect, it } from 'vitest'
import { encodeNativeErrorMessage, restoreNativeErrorName } from './nativeErrors'

describe('桌面桥错误名', () => {
  it('编进 message 的名字在平台层还原，原文与堆栈首行一并还原', () => {
    // 模拟 contextBridge：只把 message 复制过来，name 变回 Error
    const crossed = new Error(encodeNativeErrorMessage('DocumentNotFoundError', '找不到这份文档。'))
    expect(crossed.name).toBe('Error')
    const restored = restoreNativeErrorName(crossed)
    expect(restored).toBe(crossed)
    expect(restored.name).toBe('DocumentNotFoundError')
    expect(restored.message).toBe('找不到这份文档。')
    expect(String(restored.stack).startsWith('DocumentNotFoundError: 找不到这份文档。')).toBe(true)
  })

  it('普通 Error 不加前缀；没编码过的错误与非错误值原样返回', () => {
    expect(encodeNativeErrorMessage('Error', '失败')).toBe('失败')
    const plain = new Error('失败')
    expect(restoreNativeErrorName(plain).name).toBe('Error')
    expect(restoreNativeErrorName(plain).message).toBe('失败')
    expect(restoreNativeErrorName('失败')).toBe('失败')
  })
})

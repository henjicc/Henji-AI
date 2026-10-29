import { describe, expect, it } from 'vitest'
import { encodeNativeErrorMessage, restoreNativeErrorName } from './nativeErrors'
import { ContentTrustRequiredError, readContentTrustFailure } from './contentTrust'
import { unwrapIpcResult } from '../platform/adapters/electron/ipcResult'

describe('桌面桥错误名', () => {
  it('信任拦截跨 contextBridge 和普通 IPC 封装保留结构化身份，不依赖错误文案', () => {
    const original = new ContentTrustRequiredError('denied', [{ id: 'shared', sourceType: 'template', sourceName: '分享\u2063模板' }])
    const crossed = restoreNativeErrorName(new Error(encodeNativeErrorMessage(original.name, '任意文案', original.contentTrust)))
    expect(crossed.name).toBe(original.name)
    expect(crossed).toBeInstanceOf(ContentTrustRequiredError)
    expect(crossed.message).toBe('任意文案')
    expect(readContentTrustFailure(crossed)).toEqual(original.contentTrust)
    try { unwrapIpcResult({ ok: false, error: { name: original.name, code: original.name, message: '任意文案', contentTrust: original.contentTrust } }) }
    catch (error) { expect(error).toBeInstanceOf(ContentTrustRequiredError); expect(readContentTrustFailure(error)).toEqual(original.contentTrust); return }
    throw new Error('信任拦截必须拒绝 IPC 结果')
  })
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

import { describe, expect, it } from 'vitest'
import { encodeNativeErrorMessage } from '@/core/nativeErrors'
import { withNativeErrorNames } from './nativeErrors'

/** 模拟 contextBridge 复制过来的错误：只有 message，name 是 Error */
function crossed(name: string, message: string): Error {
  return new Error(encodeNativeErrorMessage(name, message))
}

describe('平台层还原桌面桥错误名', () => {
  it('异步失败与同步抛错都还原 name 与原文，成功结果与 this 不变', async () => {
    const documents = {
      prefix: 'doc:',
      read(id: string): Promise<string> { return id === 'missing' ? Promise.reject(crossed('DocumentNotFoundError', '找不到这份文档。')) : Promise.resolve(this.prefix + id) },
      check(): void { throw crossed('DocumentNameConflictError', '重名了。') },
    }
    const platform = withNativeErrorNames({ documents })
    await expect(platform.documents.read('a')).resolves.toBe('doc:a')
    await expect(platform.documents.read('missing')).rejects.toMatchObject({ name: 'DocumentNotFoundError', message: '找不到这份文档。' })
    expect(() => platform.documents.check()).toThrow(expect.objectContaining({ name: 'DocumentNameConflictError', message: '重名了。' }))
  })

  it('取值器与非函数字段原样保留，读取时仍是最新值', () => {
    let live = 1
    const runtimeInfo = { get count(): number { return live }, label: '桌面' }
    const platform = withNativeErrorNames({ runtimeInfo })
    live = 2
    expect(platform.runtimeInfo.count).toBe(2)
    expect(platform.runtimeInfo.label).toBe('桌面')
  })
})

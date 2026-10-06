import { describe, expect, it, vi } from 'vitest'

import { createDownloadSourceSelector } from './sourceSelector'

const probes = { domestic: 'https://cn.example/', global: 'https://global.example/' }

function delayed(ms: number, fail = false): Promise<unknown> {
  return new Promise((resolve, reject) => setTimeout(() => (fail ? reject(new Error('down')) : resolve({})), ms))
}

describe('下载源自动选择', () => {
  it('自动模式：两边同时探测，先返回的排在前面并记住', async () => {
    const fetch = vi.fn((url: string) => delayed(url === probes.global ? 5 : 40))
    const selector = createDownloadSourceSelector({ probes, fetch })
    expect(await selector.order('auto')).toEqual(['global', 'domestic'])
    expect(await selector.order('auto')).toEqual(['global', 'domestic'])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(selector.remembered()).toBe('global')
  })

  it('先返回的一边失败时用另一边；两边都失败按国内优先', async () => {
    const oneDown = createDownloadSourceSelector({ probes, fetch: (url) => delayed(5, url === probes.domestic) })
    expect(await oneDown.order('auto')).toEqual(['global', 'domestic'])

    const bothDown = createDownloadSourceSelector({ probes, fetch: () => delayed(1, true) })
    expect(await bothDown.order('auto')).toEqual(['domestic', 'global'])
    expect(bothDown.remembered()).toBeNull()
  })

  it('探测超时按两边都失败处理', async () => {
    const selector = createDownloadSourceSelector({
      probes, timeoutMs: 20,
      fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))),
    })
    expect(await selector.order('auto')).toEqual(['domestic', 'global'])
  })

  it('胜出方下载失败后忘掉结果，下次重新探测', async () => {
    let fast = probes.global
    const fetch = vi.fn((url: string) => delayed(url === fast ? 1 : 30))
    const selector = createDownloadSourceSelector({ probes, fetch })
    expect((await selector.order('auto'))[0]).toBe('global')
    selector.reportFailure('domestic')
    expect(selector.remembered()).toBe('global')
    selector.reportFailure('global')
    fast = probes.domestic
    expect((await selector.order('auto'))[0]).toBe('domestic')
  })

  it('指定区域时排在前面，另一边仍作为备用，不发探测', async () => {
    const fetch = vi.fn((_url: string) => delayed(1))
    const selector = createDownloadSourceSelector({ probes, fetch })
    expect(await selector.order('global')).toEqual(['global', 'domestic'])
    expect(await selector.order('domestic')).toEqual(['domestic', 'global'])
    expect(fetch).not.toHaveBeenCalled()
  })
})

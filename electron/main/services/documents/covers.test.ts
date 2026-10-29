import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DocumentCoverStore } from './covers'
import { silentLogger } from './documents.test-support'

let directory: string

beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-covers-')) })
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }) })

describe('通用文档封面', () => {
  it('序列帧重启可读，静态封面更新不会清掉序列帧；内容失效和文档删除挡住迟到写入', async () => {
    const options = { directory, logger: silentLogger(), render: async () => ({ bytes: Buffer.from('cover'), selected: [] }) }
    const store = new DocumentCoverStore(options)
    await store.writeHoverFrame({ docId: 'doc-1', contentKey: 'a' })
    await store.writeHoverFrame({ docId: 'doc-1', contentKey: 'a', frame: { position: 0.5, bytes: new Uint8Array([1, 2]) } })
    await store.save({ docId: 'doc-1', sources: [{ source: 'image', sourceKind: 'image' }] })
    const restarted = new DocumentCoverStore(options)
    const cache = await restarted.getHoverFrames('doc-1')
    expect(cache?.frames).toHaveLength(1)
    expect(fs.readFileSync(cache!.frames[0].path)).toEqual(Buffer.from([1, 2]))
    await restarted.writeHoverFrame({ docId: 'doc-1', contentKey: 'b' })
    await restarted.writeHoverFrame({ docId: 'doc-1', contentKey: 'a', frame: { position: 0, bytes: new Uint8Array([3]) } })
    expect(await restarted.getHoverFrames('doc-1')).toEqual({ contentKey: 'b', frames: [] })
    await restarted.remove('doc-1')
    await restarted.writeHoverFrame({ docId: 'doc-1', contentKey: 'b', frame: { position: 0, bytes: new Uint8Array([4]) } })
    expect(await restarted.getHoverFrames('doc-1')).toBeNull()
    expect(fs.existsSync(path.join(directory, 'doc-1'))).toBe(false)
  })
  it('按文档 ID 存在程序目录，换封面时文件名带新时间戳、只留上一张（打开着的列表还在用）；重启后能找回；删除后为空', async () => {
    let now = 1_000
    const render = vi.fn(async (sources: readonly { source: string; sourceKind: 'image' | 'video' }[]) => ({ bytes: Buffer.from(sources[0].source), selected: [...sources] }))
    const store = new DocumentCoverStore({ directory, render, logger: silentLogger(), now: () => now })
    const first = await store.save({ docId: 'doc-1', sources: [{ source: 'a', sourceKind: 'image' }] })
    expect(first.coverPath).toBe(path.join(directory, 'doc-1', '1000.webp'))
    now = 2_000
    const second = await store.save({ docId: 'doc-1', sources: [{ source: 'b', sourceKind: 'video' }] })
    expect(fs.readdirSync(path.join(directory, 'doc-1'))).toEqual(['1000.webp', '2000.webp'])
    expect(fs.readFileSync(second.coverPath!, 'utf8')).toBe('b')
    now = 3_000
    const third = await store.save({ docId: 'doc-1', sources: [{ source: 'c', sourceKind: 'image' }] })
    expect(fs.readdirSync(path.join(directory, 'doc-1'))).toEqual(['2000.webp', '3000.webp'])

    const restarted = new DocumentCoverStore({ directory, render, logger: silentLogger() })
    expect(await restarted.get('doc-1')).toBe(third.coverPath)
    expect(await restarted.getMany(['doc-1', 'doc-2'])).toEqual(new Map([['doc-1', third.coverPath]]))
    await restarted.remove('doc-1')
    expect(await restarted.get('doc-1')).toBeNull()
    expect(fs.existsSync(path.join(directory, 'doc-1'))).toBe(false)
    await expect(store.save({ docId: '../x', sources: [{ source: 'a', sourceKind: 'image' }] })).rejects.toThrow('ID 无效')
  })
})

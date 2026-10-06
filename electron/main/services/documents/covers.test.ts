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

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MainLogger } from '../logging/main-logger'
import { createWorkRootService, type WorkRootServiceDeps } from './service'

/*
 * 作品目录更换服务（任务 4.2）：目标解析、设置切换、索引刷新、忙碌与并发拒绝。临时目录，不碰真实用户目录。
 */

let base: string
let state: { root: string; custom: string | null }

const logger: MainLogger = { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as MainLogger

function createService(overrides: Partial<WorkRootServiceDeps> = {}): { service: ReturnType<typeof createWorkRootService>; deps: WorkRootServiceDeps } {
  const defaultRoot = path.join(base, '文档', '痕迹AI')
  const deps: WorkRootServiceDeps = {
    layout: () => ({
      root: state.custom ?? defaultRoot,
      defaultRoot,
      isCustom: state.custom !== null,
      rootFolderName: '痕迹AI',
      rootFolderNames: ['痕迹AI', 'Henji AI'],
    }),
    writeCustomRoot: vi.fn((root: string | null) => { state.custom = root }),
    ensureFolders: vi.fn(),
    refreshIndex: vi.fn(async () => undefined),
    isBusy: () => false,
    logger,
    ...overrides,
  }
  return { service: createWorkRootService(deps), deps }
}

beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-work-root-service-'))
  state = { root: '', custom: null }
  const root = path.join(base, '文档', '痕迹AI')
  await fs.mkdir(path.join(root, '项目', '短片'), { recursive: true })
  await fs.writeFile(path.join(root, '项目', '短片', '短片.henji-video'), '{}')
})

afterEach(async () => {
  await fs.rm(base, { recursive: true, force: true })
})

describe('createWorkRootService', () => {
  it('解析目标：空文件夹或名为“痕迹AI”的文件夹直接用，已有内容的文件夹在其中新建“痕迹AI”', async () => {
    const { service } = createService()
    await fs.mkdir(path.join(base, '空的'))
    await fs.mkdir(path.join(base, 'D盘', '其他'), { recursive: true })
    expect(await service.resolveTarget({ kind: 'custom', folder: path.join(base, '空的') })).toBe(path.join(base, '空的'))
    expect(await service.resolveTarget({ kind: 'custom', folder: path.join(base, '不存在') })).toBe(path.join(base, '不存在'))
    expect(await service.resolveTarget({ kind: 'custom', folder: path.join(base, 'D盘') })).toBe(path.join(base, 'D盘', '痕迹AI'))
    expect(await service.resolveTarget({ kind: 'custom', folder: path.join(base, 'X', 'Henji AI') })).toBe(path.join(base, 'X', 'Henji AI'))
    expect(await service.inspectTarget({ kind: 'default' })).toEqual({ root: path.join(base, '文档', '痕迹AI'), status: 'current' })
  })

  it('更换后切换设置、刷新索引；恢复默认时清除自定义设置', async () => {
    const { service, deps } = createService()
    const target = path.join(base, '新位置')
    const changed = await service.change({ kind: 'custom', folder: target })
    expect(changed).toMatchObject({ changed: true, root: target, requiresRestart: true })
    expect(deps.writeCustomRoot).toHaveBeenLastCalledWith(target)
    expect(deps.refreshIndex).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(path.join(target, '项目', '短片', '短片.henji-video'), 'utf8')).toBe('{}')

    const reset = await service.change({ kind: 'default' })
    expect(reset.root).toBe(path.join(base, '文档', '痕迹AI'))
    expect(deps.writeCustomRoot).toHaveBeenLastCalledWith(null)
    expect(await fs.readFile(path.join(base, '文档', '痕迹AI', '项目', '短片', '短片.henji-video'), 'utf8')).toBe('{}')
  })

  it('还有生成结果在保存时拒绝，不动文件也不切换设置', async () => {
    const { service, deps } = createService({ isBusy: () => true })
    const error = await service.change({ kind: 'custom', folder: path.join(base, '新位置') }).catch((caught: unknown) => caught)
    expect((error as Error).message).toMatch(/^busy:/)
    expect(deps.writeCustomRoot).not.toHaveBeenCalled()
    expect(await fs.access(path.join(base, '新位置')).then(() => true, () => false)).toBe(false)
    expect(service.isRunning()).toBe(false)
  })

  it('同一时间只允许一次移动；退出清理会取消进行中的复制并等待回滚', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { service, deps } = createService({
      moveOptions: {
        forceCopy: true,
        fileOps: { copyFile: async (source, target) => { await gate; await fs.copyFile(source, target) } },
      },
    })
    const first = service.change({ kind: 'custom', folder: path.join(base, '新位置') }).catch((caught: unknown) => caught)
    await vi.waitFor(() => expect(service.isRunning()).toBe(true))
    const second = await service.change({ kind: 'custom', folder: path.join(base, '另一个') }).catch((caught: unknown) => caught)
    expect((second as Error).message).toMatch(/^busy:/)

    const disposed = service.dispose()
    release()
    await disposed
    expect(((await first) as Error).message).toMatch(/^cancelled:/)
    expect(service.isRunning()).toBe(false)
    expect(deps.writeCustomRoot).not.toHaveBeenCalled()
    expect(await fs.readFile(path.join(base, '文档', '痕迹AI', '项目', '短片', '短片.henji-video'), 'utf8')).toBe('{}')
    expect(await fs.access(path.join(base, '新位置')).then(() => true, () => false)).toBe(false)
  })
})

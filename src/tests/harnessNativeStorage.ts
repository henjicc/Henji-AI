/**
 * harness 的进程边界替身：一份**只存内存**的 `window.henjiNative`。
 *
 * ── 为什么需要它 ──
 * jsdom 下 `detectShell()` 找不到 `window.henjiNative`，`getPlatform()` 直接抛
 * `Platform runtime is only available inside the Electron desktop shell`。素材集合、画布与 3D 工程
 * 的创建都要经持久化落地，于是事务整体补偿回滚，相关域的读改验回环够不到实例——不是链路
 * 缺陷，是环境限制（真机场景每次都通过）。
 *
 * ── 替身落在哪条线上 ──
 * 落在 **preload 注入的那一层**，也就是生产里渲染层能看到的最后一格。换句话说，真的电子
 * 适配器（`createElectronPlatform()` 与它下面的全部子适配器）、`commands/*`、领域服务、
 * 反射适配器、执行器**一条都没被替换**，全部照常执行；被换掉的只有"IPC 过去之后那台
 * SQLite"。它属于 harness 头注释里允许的第 2、3 类替身（IPC 传输 + 持久化）。
 *
 * ── 这里复刻什么、不复刻什么 ──
 * 只复刻**存储语义**：主键/唯一索引冲突、行不存在、列表排序、upsert 保留 createdAt、
 * 以及进程边界的 JSON 往返（Map/Set/Date/undefined 在真 IPC 上会变形，这里让它照样变形）。
 *
 * **不复刻主进程在存储之上的任何加工**——名称 trim、`UNIQUE constraint failed` 到人话的
 * 翻译、素材文件检查与缩略图生成。那些代码在边界之后，本层根本测不到，复刻一份只会造出
 * 第二份平行实现，而它一旦漂移就是漂亮的假绿。所以这一层不能用来断言那些行为。
 *
 * ── 没实现的方法一律抛错 ──
 * 返回空值或假成功等于**悄悄伪造业务结果**，比不实现更糟：调用方会把 `undefined` 当成
 * "查到了但是空的"继续走下去，最后在离现场很远的地方失败。所以未实现的命名空间与方法
 * 都抛一条说得清的错，并列出已实现的名字。门禁见 `harnessNativeStorage.test.ts`。
 */
import { v4 as uuidv4 } from 'uuid'

import type { AssetLibraryRecord, AssetLibrarySnapshot } from '@/platform/contracts/assetLibrary'
import type {
  CameraStageProjectPlatformRecord,
  CameraStageProjectPlatformSummary,
} from '@/platform/contracts/cameraStageProjects'
import type {
  StoryboardProjectPlatformRecord,
  StoryboardProjectPlatformSummary,
  StoryboardProjectPlatformWrite,
} from '@/platform/contracts/storyboardProjects'

const FIX_HINT = '替身只负责存储：要用到新方法，就在 src/tests/harnessNativeStorage.ts 里补一段'
  + '**只存不判断**的实现，不要返回空值糊过去——那等于伪造业务结果。'

/** 进程边界的结构化克隆。直接交出内部引用会把"这跳其实穿了一次 IPC"这件事藏起来。 */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/* ── 素材库存储 ─────────────────────────────────────────────────────────── */

/** 对应 `asset_libraries` + `asset_library_items` 两张表；成员关系只存不解释。 */
interface StoredLibrary extends AssetLibraryRecord {
  assetIds: string[]
}

const libraries = new Map<string, StoredLibrary>()

function libraryRecord(row: StoredLibrary): AssetLibraryRecord {
  return wire({ id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt })
}

/** `name TEXT NOT NULL COLLATE NOCASE UNIQUE`——索引约束属于存储，照抄；翻译成人话的那段在主进程，不抄。 */
function assertLibraryNameFree(name: string, exceptId?: string): void {
  const taken = [...libraries.values()].some(
    (row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase()
  )
  if (taken) throw new Error('UNIQUE constraint failed: asset_libraries.name')
}

function requireLibrary(id: string): StoredLibrary {
  const row = libraries.get(id)
  if (!row) throw new Error('资产库不存在')
  return row
}

const assetLibraryStorage = {
  async listLibraries(): Promise<AssetLibraryRecord[]> {
    // 主进程按 `ORDER BY name COLLATE NOCASE`；Map 的插入序会与它悄悄不同，所以这里也排。
    return [...libraries.values()]
      .sort((left, right) => left.name.toLowerCase().localeCompare(right.name.toLowerCase()))
      .map(libraryRecord)
  },

  async createLibrary(name: string): Promise<AssetLibraryRecord> {
    assertLibraryNameFree(name)
    const now = Date.now()
    const row: StoredLibrary = { id: uuidv4(), name, createdAt: now, updatedAt: now, assetIds: [] }
    libraries.set(row.id, row)
    return libraryRecord(row)
  },

  async renameLibrary(id: string, name: string): Promise<AssetLibraryRecord> {
    const row = requireLibrary(id)
    assertLibraryNameFree(name, id)
    row.name = name
    row.updatedAt = Date.now()
    return libraryRecord(row)
  },

  async deleteLibrary(id: string): Promise<void> {
    libraries.delete(id)
  },

  async inspectLibrary(id: string): Promise<AssetLibrarySnapshot> {
    const row = requireLibrary(id)
    return wire({
      id: row.id, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt,
      assetIds: [...row.assetIds],
    })
  },

  async restoreLibrary(snapshot: AssetLibrarySnapshot): Promise<AssetLibraryRecord> {
    if (libraries.has(snapshot.id)) throw new Error('UNIQUE constraint failed: asset_libraries.id')
    const row: StoredLibrary = wire({
      id: snapshot.id, name: snapshot.name,
      createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt,
      assetIds: [...snapshot.assetIds],
    })
    libraries.set(row.id, row)
    return libraryRecord(row)
  },
}

/* ── 3D 工程存储 ────────────────────────────────────────────────────────── */

const cameraStageProjects = new Map<string, CameraStageProjectPlatformRecord>()

const cameraStageProjectsStorage = {
  async listProjectSummaries(): Promise<CameraStageProjectPlatformSummary[]> {
    return [...cameraStageProjects.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(({ sceneJson: _sceneJson, ...summary }) => wire(summary))
  },

  async getProjectRecord(projectId: string): Promise<CameraStageProjectPlatformRecord | null> {
    const record = cameraStageProjects.get(projectId)
    return record ? wire(record) : null
  },

  async upsertProjectRecord(record: CameraStageProjectPlatformRecord): Promise<void> {
    // `ON CONFLICT(id) DO UPDATE` 不覆盖 created_at，保留工程首次创建时间。
    const existing = cameraStageProjects.get(record.id)
    cameraStageProjects.set(record.id, wire({
      ...record,
      createdAt: existing ? existing.createdAt : record.createdAt,
    }))
  },

  async renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void> {
    // 主进程是一条裸 `UPDATE ... WHERE id = ?`：命中不到行就是零行受影响，不报错。
    const record = cameraStageProjects.get(projectId)
    if (!record) return
    cameraStageProjects.set(projectId, { ...record, name, updatedAt })
  },

  async deleteProjectRecord(projectId: string): Promise<void> {
    cameraStageProjects.delete(projectId)
  },
}

/* ── 画布工程存储 ───────────────────────────────────────────────────────── */

const storyboardProjects = new Map<string, StoryboardProjectPlatformRecord>()

const storyboardProjectsStorage = {
  async listProjectSummaries(): Promise<StoryboardProjectPlatformSummary[]> {
    return [...storyboardProjects.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(({ nodesJson: _nodesJson, edgesJson: _edgesJson, viewportJson: _viewportJson,
        historyJson: _historyJson, ...summary }) => wire(summary))
  },

  async getProjectRecord(projectId: string): Promise<StoryboardProjectPlatformRecord | null> {
    const record = storyboardProjects.get(projectId)
    return record ? wire(record) : null
  },

  async upsertProjectRecord(record: StoryboardProjectPlatformWrite): Promise<void> {
    const existing = storyboardProjects.get(record.id)
    storyboardProjects.set(record.id, wire({
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt,
      coverPath: existing?.coverPath ?? null,
    }))
  },

  async updateProjectViewportRecord(projectId: string, viewportJson: string): Promise<void> {
    const record = storyboardProjects.get(projectId)
    if (!record) return
    storyboardProjects.set(projectId, { ...record, viewportJson })
  },

  async renameProjectRecord(projectId: string, name: string, updatedAt: number): Promise<void> {
    const record = storyboardProjects.get(projectId)
    if (!record) return
    storyboardProjects.set(projectId, { ...record, name, updatedAt })
  },

  async deleteProjectRecord(projectId: string): Promise<void> {
    storyboardProjects.delete(projectId)
  },
}

/* ── 装配与安装 ─────────────────────────────────────────────────────────── */

const NAMESPACES: Record<string, object> = {
  assetLibrary: assetLibraryStorage,
  cameraStageProjects: cameraStageProjectsStorage,
  storyboardProjects: storyboardProjectsStorage,
}

/**
 * JS 与测试框架会主动探测的内建键：`await` 查 `then`、`JSON.stringify` 查 `toJSON`、
 * `expect` 查 `asymmetricMatch`。它们不是能力调用，返回 undefined，别把探测变成崩溃。
 */
const PROBE_KEYS = new Set([
  'then', 'toJSON', 'constructor', 'prototype', 'nodeType', 'hasOwnProperty',
  '$$typeof', 'asymmetricMatch', 'inspect', '_isMockFunction',
])

/** 命名空间内的未实现方法：抛错并列出已实现的名字，让调用方一眼看出该补什么。 */
function storageOnly<T extends object>(namespace: string, implemented: T): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (typeof property === 'symbol' || PROBE_KEYS.has(property) || property in target) {
        return Reflect.get(target, property, receiver)
      }
      throw new Error(
        `[harness-native] henjiNative.${namespace}.${property} 没有实现。`
        + `${namespace} 已实现：${Object.keys(target).join('、')}。${FIX_HINT}`
      )
    },
  })
}

function createNativeBridge(): object {
  const wrapped = new Map(
    Object.entries(NAMESPACES).map(([name, implementation]) => [name, storageOnly(name, implementation)])
  )
  return new Proxy({} as Record<string, unknown>, {
    get(_target, property) {
      if (typeof property === 'symbol' || PROBE_KEYS.has(property)) return undefined
      const namespace = wrapped.get(property)
      if (namespace) return namespace
      throw new Error(
        `[harness-native] henjiNative.${property} 没有实现：`
        + `替身只装了 ${[...wrapped.keys()].join('、')} 这些命名空间。${FIX_HINT}`
      )
    },
    has: (_target, property) => typeof property === 'string' && wrapped.has(property),
    ownKeys: () => [...wrapped.keys()],
    getOwnPropertyDescriptor: (_target, property) => (
      typeof property === 'string' && wrapped.has(property)
        ? { configurable: true, enumerable: true, value: wrapped.get(property) }
        : undefined
    ),
  })
}

/**
 * 装上替身。装上之后 `detectShell()` 才认得出 shell，`getPlatform()` 才会去组装真实的
 * 电子适配器——注意组装出来的是**真适配器**，只是它们代理到的这台 native 是内存的。
 */
export function installHarnessNativeStorage(): void {
  resetHarnessNativeStorage()
  ;(window as unknown as { henjiNative?: unknown }).henjiNative = createNativeBridge()
}

/** 清空全部存储。用例之间必须调，否则上一条用例造的素材集合会漏进下一条。 */
export function resetHarnessNativeStorage(): void {
  libraries.clear()
  cameraStageProjects.clear()
  storyboardProjects.clear()
}

export function uninstallHarnessNativeStorage(): void {
  delete (window as unknown as { henjiNative?: unknown }).henjiNative
  resetHarnessNativeStorage()
}

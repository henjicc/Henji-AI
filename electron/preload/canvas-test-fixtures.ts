import type { DocumentContainerRef } from '../../src/core/documents/types'
import type { DocumentsPlatform } from '../../src/platform/contracts/documents'
import type { HenjiCanvasTestFixture, HenjiCanvasTestFixtureCreateRequest, HenjiCanvasTestFixturePatch } from './api-projects'

/*
 * 测试夹具里的画布读写（只在自动化 / 隔离测试模式下存在，3.4）：取代原来直接写 storyboard_projects 的原始 SQL 通道。
 * 全部经正式文档接口（与界面同一组文档 IPC），不另开通道：
 * - 内容（节点、连线、媒体池、内嵌包位置）在 `.henji-canvas` 文件里；
 * - 视口与撤销记录是按文档 ID 存在程序目录的会话状态（canvas.viewport / canvas.history）。
 * 应用里已打开的画布有内存实例：直接改文件后要 reload（或先返回列表关闭会话）再打开，才会按文件重新读取。
 */

const VIEWPORT_KEY = 'canvas.viewport'
const HISTORY_KEY = 'canvas.history'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface CanvasTestFixturesApi {
  readCanvas(id: string): Promise<HenjiCanvasTestFixture | null>
  writeCanvas(id: string, patch: HenjiCanvasTestFixturePatch): Promise<number>
  createCanvas(request: HenjiCanvasTestFixtureCreateRequest): Promise<{ id: string; name: string; path: string; created: boolean }>
  findCanvasByName(name: string): Promise<{ id: string; name: string; path: string } | null>
}

export function createCanvasTestFixturesApi(documents: DocumentsPlatform): CanvasTestFixturesApi {
  async function exists(id: string): Promise<boolean> {
    const rows = await documents.listDocuments({ kind: 'canvas', includeDrafts: true, includeMissing: false })
    return rows.some((row) => row.id === id)
  }

  async function readCanvas(id: string): Promise<HenjiCanvasTestFixture | null> {
    if (!await exists(id)) return null
    const read = await documents.readDocument({ id })
    const content = isRecord(read.content) ? read.content : {}
    const [viewport, history] = await Promise.all([
      documents.readSessionState({ docId: id, key: VIEWPORT_KEY }),
      documents.readSessionState({ docId: id, key: HISTORY_KEY }),
    ])
    return {
      id: read.meta.id,
      name: read.meta.name,
      path: read.meta.path,
      revision: read.meta.revision,
      draft: read.meta.draft,
      nodes: Array.isArray(content.nodes) ? content.nodes.filter(isRecord) : [],
      edges: Array.isArray(content.edges) ? content.edges.filter(isRecord) : [],
      imagePool: Array.isArray(content.imagePool) ? content.imagePool.filter((item): item is string => typeof item === 'string') : [],
      layerPackages: isRecord(content.layerPackages) ? content.layerPackages as Record<string, string> : {},
      viewport: viewport ?? null,
      history: history ?? null,
    }
  }

  async function writeCanvas(id: string, patch: HenjiCanvasTestFixturePatch): Promise<number> {
    const current = await documents.readDocument({ id })
    if (patch.viewport) await documents.writeSessionState({ docId: id, key: VIEWPORT_KEY, value: patch.viewport })
    if (patch.clearHistory) await documents.writeSessionState({ docId: id, key: HISTORY_KEY, value: null })
    if (!patch.nodes && !patch.edges && !patch.imagePool) return current.meta.revision
    const content: Record<string, unknown> = { ...(isRecord(current.content) ? current.content : {}) }
    if (patch.nodes) content.nodes = patch.nodes
    if (patch.edges) content.edges = patch.edges
    if (patch.imagePool) {
      if (patch.imagePool.length) content.imagePool = patch.imagePool
      else delete content.imagePool
    }
    const saved = await documents.saveDocument({ target: { id }, expectedRevision: current.meta.revision, content })
    return saved.meta.revision
  }

  async function createCanvas(request: HenjiCanvasTestFixtureCreateRequest): Promise<{ id: string; name: string; path: string; created: boolean }> {
    if (request.id && await exists(request.id)) {
      const current = await documents.readDocument({ id: request.id })
      if (request.replace) await writeCanvas(request.id, { nodes: request.nodes ?? [], edges: request.edges ?? [], ...(request.viewport ? { viewport: request.viewport } : {}) })
      else if (request.viewport) await documents.writeSessionState({ docId: request.id, key: VIEWPORT_KEY, value: request.viewport })
      return { id: current.meta.id, name: current.meta.name, path: current.meta.path, created: false }
    }
    const container: DocumentContainerRef = request.container ?? { kind: 'user' }
    const create = (name: string) => documents.createDocument({
      kind: 'canvas',
      container,
      name,
      content: { nodes: request.nodes ?? [], edges: request.edges ?? [] },
      ...(request.id ? { id: request.id } : {}),
    })
    let created
    try {
      created = await create(request.name)
    } catch (error) {
      // 同名画布已经在（真实配置里上一次留下的）：不动它，换个带时间的名字
      if (!(error instanceof Error) || !/DocumentNameConflictError|同名|已有/.test(`${error.name} ${error.message}`)) throw error
      created = await create(`${request.name} ${Date.now()}`)
    }
    if (request.viewport) await documents.writeSessionState({ docId: created.meta.id, key: VIEWPORT_KEY, value: request.viewport })
    return { id: created.meta.id, name: created.meta.name, path: created.meta.path, created: true }
  }

  async function findCanvasByName(name: string): Promise<{ id: string; name: string; path: string } | null> {
    const rows = await documents.listDocuments({ kind: 'canvas', includeDrafts: true, includeMissing: false })
    const match = rows.filter((row) => row.name === name).sort((left, right) => right.updatedAt - left.updatedAt)[0]
    return match ? { id: match.id, name: match.name, path: match.path } : null
  }

  return { readCanvas, writeCanvas, createCanvas, findCanvasByName }
}

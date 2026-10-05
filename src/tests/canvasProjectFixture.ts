import { beforeEach, vi } from 'vitest'

import { documentKindRegistry } from '@/core/documents/kinds'
import type { DocumentContainerRef } from '@/core/documents/types'
import { DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'
import { createScriptedPrompter, type FakeDocumentCommands, type ScriptedPrompter } from '@/features/documents/documentSessionTestKit'
import type { DocumentSessionCommands } from '@/features/documents/documentSessionTypes'
import { canvasFromDocumentContent, canvasToDocumentContent, DEFAULT_CANVAS_VIEWPORT, type Project } from '@/features/canvas/application/canvasDocumentContent'
import { setCanvasDocumentEnvironmentForTests, type CanvasDocumentCommands } from '@/features/canvas/application/canvasDocumentEnvironment'
import { attachCanvasProject, bindCanvasSession, findCanvasProjectInstance, getCanvasProjectInstance, resetCanvasProjectInstancesForTests } from '@/features/canvas/application/canvasProjectInstances'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { harnessDocumentStore, resetHarnessDocumentStore } from '@/tests/harnessNativeStorage'

/*
 * 画布测试夹具（3.4 起画布是 `.henji-canvas` 文档）。
 *
 * 每个用例前把画布的文档环境换成内存替身：会话登记表 + 文档命令都落到 harnessDocumentStore()
 * （装了 harness 时与平台桥是同一个仓库，没装时也能用），文档类型用正式登记表（画布真实内容规则）。
 * “磁盘”上的画布用 readCanvasTestProject 断言，造数据用 seedCanvasTestProject / createCanvasTestProject。
 */

let prompter: ScriptedPrompter = createScriptedPrompter()

function store(): FakeDocumentCommands {
  return harnessDocumentStore()
}

/** 始终转给当前用例的仓库（harness 每次安装都会换一个新的）。 */
const sessionCommands: DocumentSessionCommands = new Proxy({} as DocumentSessionCommands, {
  get: (_target, property) => {
    const target = store() as unknown as Record<string | symbol, unknown>
    const value = target[property]
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
  },
})

const canvasCommands: CanvasDocumentCommands = {
  readDocument: (target) => store().readDocument(target),
  listDocuments: (query) => store().listDocuments(query),
  listProjects: (query) => store().listProjects(query),
  readSessionState: (request) => store().readSessionState(request),
  writeSessionState: (request) => store().writeSessionState(request),
  saveDocumentCover: async (request) => ({ docId: request.docId, coverPath: null }),
  importFile: async (request) => ({ path: request.sourcePath, copied: false }),
}

let registry = createRegistry()

function createRegistry(): DocumentSessionRegistry {
  return new DocumentSessionRegistry({
    commands: sessionCommands,
    kinds: documentKindRegistry,
    prompter,
    timing: { autosaveDelayMs: 20, idleCommitDelayMs: 30_000, retryBaseDelayMs: 50, retryMaxDelayMs: 200 },
  })
}

function install(): void {
  prompter = createScriptedPrompter()
  registry = createRegistry()
  setCanvasDocumentEnvironmentForTests({ registry, commands: canvasCommands })
}

install()

beforeEach(() => {
  resetCanvasProjectInstancesForTests()
  // 每个用例从空“磁盘”开始（装了 harness 的用例随后会再装一次，同样是空的）
  resetHarnessDocumentStore()
  canvasSaveSpy()
  install()
  useProjectStore.setState({
    currentProjectId: null, currentProject: null, isOpeningProject: false, openError: null,
    persistenceError: null, persistenceErrors: {},
  })
})

/** 当前用例的画布会话登记表与离开提示替身。 */
export function canvasTestRegistry(): { registry: DocumentSessionRegistry; prompter: ScriptedPrompter; commands: FakeDocumentCommands } {
  return { registry, prompter, commands: store() }
}

/** 画布写进“磁盘”的调用（文档仓库替身的 saveDocument），第一次取用时装上监视（真实实现照常执行）。 */
export function canvasSaveSpy() {
  const commands = store()
  return vi.isMockFunction(commands.saveDocument) ? vi.mocked(commands.saveDocument) : vi.spyOn(commands, 'saveDocument')
}

/** 把一份内存画布写进“磁盘”（作品目录“画布/”，ID 与名称沿用）；已有同 ID 时整份覆盖。 */
export function seedCanvasTestProject(project: Pick<Project, 'id' | 'name' | 'nodes' | 'edges'> & Partial<Pick<Project, 'imagePool' | 'history'>>, container: DocumentContainerRef = { kind: 'user' }): void {
  const content = canvasToDocumentContent(project)
  const existing = store().stored(project.id)
  if (existing) {
    existing.content = structuredClone(content)
    existing.meta = { ...existing.meta, revision: existing.meta.revision + 1 }
    return
  }
  store().seed({
    kind: 'canvas', id: project.id, name: project.name, content,
    ...(container.kind === 'project' ? { projectId: container.projectId, folder: store().projects.get(container.projectId)?.path } : {}),
  })
}

/** 读“磁盘”上的画布（与打开时同一套换算）；不存在返回 null。 */
export function readCanvasTestProject(id: string): Project | null {
  const stored = store().stored(id)
  if (!stored) return null
  const graph = canvasFromDocumentContent(stored.content)
  return {
    id, name: stored.meta.name, createdAt: stored.meta.createdAt, updatedAt: stored.meta.updatedAt,
    nodeCount: graph.nodes.length, coverPath: null, ...graph,
    viewport: DEFAULT_CANVAS_VIEWPORT, history: { past: [], future: [] },
  }
}

/**
 * 新建一份已命名的画布并打开（默认显示到画布页，相当于原来的 createProject）。
 * 返回画布文档 ID。
 */
export async function createCanvasTestProject(name: string, options: { attach?: boolean; container?: DocumentContainerRef } = {}): Promise<string> {
  const read = await store().createDocument({ kind: 'canvas', container: options.container ?? { kind: 'user' }, name, draft: false })
  const instance = await getCanvasProjectInstance(read.meta.id)
  if (options.attach !== false) {
    attachCanvasProject(instance)
    useProjectStore.setState({ currentProjectId: instance.id, currentProject: instance.snapshot(), isOpeningProject: false, openError: null })
  }
  return instance.id
}

/** 同步装好一份画布实例（不经过平台）；内容来自给定快照。 */
export function registerCanvasTestProject(project: Project): ReturnType<typeof bindCanvasSession> {
  const existing = findCanvasProjectInstance(project.id)
  if (existing) return existing
  seedCanvasTestProject(project)
  const stored = store().stored(project.id)!
  const session = registry.adopt({
    meta: stored.meta, content: structuredClone(stored.content), missingPaths: [], externalDirectories: [], unresolved: [],
  })
  return bindCanvasSession(session, { history: project.history, viewport: project.viewport })
}

/**
 * 测试造当前画布：与界面打开画布同一套实例登记与界面附着。
 * 给了 currentProject 时把它写进“磁盘”并装成实例；之前直接写在画布 store 里的节点（还没有画布时）一并带上。
 */
export const setCanvasTestProjectState: typeof useProjectStore.setState = (state, replace) => {
  const detached = !useProjectStore.getState().currentProjectId ? useCanvasStore.getState() : null
  if (replace) useProjectStore.setState(state as ReturnType<typeof useProjectStore.getState>, true)
  else useProjectStore.setState(state, false)
  const project = useProjectStore.getState().currentProject
  if (project) {
    const seed = detached && detached.nodes.length && !project.nodes.length
      ? { ...project, nodes: detached.nodes, edges: detached.edges, history: detached.history } : project
    const instance = registerCanvasTestProject(seed)
    attachCanvasProject(instance)
    useProjectStore.setState({ currentProject: instance.snapshot() })
    if (detached) useCanvasStore.setState({ canvasViewportSize: detached.canvasViewportSize,
      selectedNodeId: detached.selectedNodeId, activeToolDialog: detached.activeToolDialog,
      imageViewer: detached.imageViewer })
  }
}

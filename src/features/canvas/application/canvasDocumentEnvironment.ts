import * as documentCommands from '@/commands/documents'
import { getDocumentSessionRegistry, type DocumentSessionRegistry } from '@/features/documents/documentSessionRegistry'

/*
 * 画布用到的文档底座入口（3.4）：会话登记表与少数直接命令（读文档、列文档、会话状态、封面、放进容器）。
 * 正式运行是应用唯一的会话登记表与 `@/commands/documents`；测试经 setCanvasDocumentEnvironmentForTests
 * 换成内存替身（见 src/tests/canvasProjectFixture.ts），不碰平台。
 */

export interface CanvasDocumentCommands {
  readDocument: typeof documentCommands.readDocument
  listDocuments: typeof documentCommands.listDocuments
  listProjects: typeof documentCommands.listProjects
  readSessionState: typeof documentCommands.readDocumentSessionState
  writeSessionState: typeof documentCommands.writeDocumentSessionState
  saveDocumentCover: typeof documentCommands.saveDocumentCover
  importFile: typeof documentCommands.importFileToContainer
}

// 调用时再取命令（不在模块加载时取属性）：测试替换 `@/commands/documents` 时只需提供用到的那几个
const defaultCommands: CanvasDocumentCommands = {
  readDocument: (target) => documentCommands.readDocument(target),
  listDocuments: (query) => documentCommands.listDocuments(query),
  listProjects: (query) => documentCommands.listProjects(query),
  readSessionState: (request) => documentCommands.readDocumentSessionState(request),
  writeSessionState: (request) => documentCommands.writeDocumentSessionState(request),
  saveDocumentCover: (request) => documentCommands.saveDocumentCover(request),
  importFile: (request) => documentCommands.importFileToContainer(request),
}

interface CanvasDocumentEnvironment {
  registry: DocumentSessionRegistry
  commands: CanvasDocumentCommands
}

let override: CanvasDocumentEnvironment | null = null

/** 画布用的文档会话登记表（正式运行是应用唯一的那一个）。 */
export function canvasDocumentRegistry(): DocumentSessionRegistry {
  return override?.registry ?? getDocumentSessionRegistry()
}

export function canvasDocumentCommands(): CanvasDocumentCommands {
  return override?.commands ?? defaultCommands
}

/** 仅供测试：换成内存替身；传 null 恢复正式环境。 */
export function setCanvasDocumentEnvironmentForTests(environment: CanvasDocumentEnvironment | null): void {
  override = environment
}

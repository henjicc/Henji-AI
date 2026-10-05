import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DocumentKindDescriptor } from '@/core/documents/kinds'
import type {
  CreateDocumentRequest,
  DocumentMeta,
  DocumentReadResult,
  DocumentSaveResult,
  DocumentTarget,
  SaveDocumentRequest,
} from '@/core/documents/types'

import { DEFAULT_DOCUMENT_SESSION_TIMING } from './documentSession'
import { DocumentSessionRegistry } from './documentSessionRegistry'
import { createScriptedPrompter, FakeDocumentCommands, namedError, testContentSchema, type TestContent } from './documentSessionTestKit'
import type { DocumentCommitReason, DocumentPersistence, DocumentReadPurpose } from './documentSessionTypes'

/*
 * 单文件包类型（图片文档，3.5）接入文档会话：打开 / 新建 / 重新读取都由保存策略完成，
 * 保存写工作副本，“保存”、空闲、关闭与退出都写回文件；草稿“保存”先起名。
 */

const packageKind: DocumentKindDescriptor<TestContent> = {
  id: 'image_document',
  extension: '.henjiimg',
  standaloneFolderNames: { zh: '图片文档', en: 'Image Documents' },
  untitledNames: { zh: '未命名图片', en: 'Untitled Image' },
  storage: 'package',
  version: 1,
  contentSchema: testContentSchema,
  upgradeContent: (content) => content,
  createEmptyContent: () => ({ items: [] }),
  isEmptyContent: (content) => content.items.length === 0,
  summarize: () => ({}),
}

class FakePackagePersistence implements DocumentPersistence {
  readonly mode = 'package' as const
  readonly log: string[] = []
  revision = 1

  constructor(private meta: DocumentMeta) {}

  async read(target: DocumentTarget, purpose: DocumentReadPurpose): Promise<DocumentReadResult> {
    this.log.push(`read:${purpose}`)
    return { meta: { ...this.meta, revision: this.revision }, content: { items: ['a'] }, missingPaths: [], externalDirectories: [], unresolved: [] }
  }

  async create(request: CreateDocumentRequest): Promise<DocumentReadResult> {
    this.log.push(`create:${request.container.kind}`)
    return { meta: this.meta, content: { items: ['a'] }, missingPaths: [], externalDirectories: [], unresolved: [] }
  }

  async save(request: SaveDocumentRequest): Promise<DocumentSaveResult> {
    this.log.push(request.force ? 'save:force' : 'save')
    return { meta: { ...this.meta, revision: request.expectedRevision }, unchanged: false }
  }

  async commit(reason: DocumentCommitReason, meta: DocumentMeta): Promise<DocumentMeta> {
    this.log.push(`commit:${reason}`)
    this.revision = meta.revision + 1
    this.meta = { ...meta, revision: this.revision }
    return this.meta
  }
}

function setup(options: { draft?: boolean } = {}) {
  const commands = new FakeDocumentCommands()
  const prompter = createScriptedPrompter()
  const seeded = commands.seed({ name: '海报', content: { items: ['a'] }, draft: options.draft ?? false, kind: 'image_document' })
  const registry = new DocumentSessionRegistry({
    commands,
    prompter,
    kinds: { require: () => packageKind as unknown as DocumentKindDescriptor },
    timing: { autosaveDelayMs: 800, idleCommitDelayMs: 30000, retryBaseDelayMs: 2000, retryMaxDelayMs: 8000 },
  })
  const persistence = new FakePackagePersistence(seeded)
  return { commands, prompter, registry, persistence, seeded }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('单文件包会话', () => {
  it('打开与新建由保存策略读写，不走 JSON 文档命令', async () => {
    const { commands, registry, persistence, seeded } = setup()
    const session = await registry.open({ id: seeded.id, path: seeded.path }, { persistence })
    expect(persistence.log).toEqual(['read:open'])
    expect(commands.calls).not.toContain('readDocument')
    await session.discard()

    const created = await registry.create({ kind: 'image_document', container: { kind: 'user' } }, { persistence })
    expect(created.id).toBe(seeded.id)
    expect(persistence.log).toContain('create:user')
    expect(commands.calls).not.toContain('createDocument')
  })

  it('空闲写回默认 30 秒：最后一次保存后 30 秒才写回文件', async () => {
    expect(DEFAULT_DOCUMENT_SESSION_TIMING.idleCommitDelayMs).toBe(30000)
    const { registry, persistence, seeded } = setup()
    const session = await registry.open({ id: seeded.id }, { persistence })
    session.markChanged()
    await vi.advanceTimersByTimeAsync(800)
    expect(persistence.log).toContain('save')
    await vi.advanceTimersByTimeAsync(29000)
    expect(persistence.log).not.toContain('commit:idle')
    await vi.advanceTimersByTimeAsync(1000)
    expect(persistence.log).toContain('commit:idle')
    expect(session.documentMeta.revision).toBe(2)
  })

  it('编辑器里“保存”：已保存的文档直接写回；草稿先起名转正再写回，取消起名不写', async () => {
    const saved = setup()
    const session = await saved.registry.open({ id: saved.seeded.id }, { persistence: saved.persistence })
    session.markChanged()
    await expect(saved.registry.save(session.id)).resolves.toBe(true)
    expect(saved.persistence.log.slice(-2)).toEqual(['save', 'commit:save'])
    expect(saved.prompter.log).toEqual([])

    const draft = setup({ draft: true })
    const draftSession = await draft.registry.open({ id: draft.seeded.id }, { persistence: draft.persistence })
    await expect(draft.registry.save(draftSession.id)).resolves.toBe(false)
    expect(draft.persistence.log).not.toContain('commit:save')
    draft.prompter.saveName = async (info) => { await info.submit('封面图', null); return true }
    await expect(draft.registry.save(draftSession.id)).resolves.toBe(true)
    expect(draft.commands.calls).toContain('finalizeDocument')
    expect(draftSession.documentMeta).toMatchObject({ name: '封面图', draft: false })
    expect(draft.persistence.log).toContain('commit:save')
  })

  it('退出屏障写回单文件包；关闭也写回', async () => {
    const { registry, persistence, seeded } = setup()
    const session = await registry.open({ id: seeded.id }, { persistence })
    session.markChanged()
    await registry.prepareApplicationClose()
    expect(persistence.log).toContain('commit:close')
    await session.close()
    expect(persistence.log.filter((entry) => entry === 'commit:close')).toHaveLength(2)
  })

  it('重新定位与冲突后重新载入都由保存策略读取', async () => {
    const { registry, persistence, seeded, prompter } = setup()
    const session = await registry.open({ id: seeded.id }, { persistence })
    await session.relocate()
    expect(persistence.log).toContain('read:relocate')

    prompter.conflictChoices.push('reload')
    const save = persistence.save.bind(persistence)
    let failed = false
    persistence.save = async (request) => {
      if (!failed) {
        failed = true
        throw namedError('DocumentRevisionConflictError')
      }
      return await save(request)
    }
    session.markChanged()
    await vi.advanceTimersByTimeAsync(800)
    await vi.runOnlyPendingTimersAsync()
    expect(persistence.log).toContain('read:reload')
  })
})

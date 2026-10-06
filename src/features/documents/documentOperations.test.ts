import { describe, expect, it, vi } from 'vitest'

import type { DocumentKindDescriptor } from '@/core/documents/kinds'

import { DocumentOperations } from './documentOperations'
import { createTestRegistry, testDocumentKind, TestToolInstance, type TestContent } from './documentSessionTestKit'

/*
 * 通用文档操作（存储底座 2.5）：页面右键与助手共用的领域服务。
 * 重点是与已打开文档会话的配合：改名、移动、复制前写完最后一次；改名与移动后会话跟着新位置；
 * 正在编辑的文档不能移到回收站。用内存替身代替 commands，不跑主进程。
 */

function setup() {
  const kit = createTestRegistry()
  const operations = new DocumentOperations({
    commands: kit.commands,
    registry: kit.registry,
    kinds: { require: () => testDocumentKind as unknown as DocumentKindDescriptor },
  })
  return { ...kit, operations }
}

async function openEdited(kit: ReturnType<typeof setup>, name = '海报') {
  const meta = kit.commands.seed({ name, content: { items: ['a'] } })
  const session = await kit.registry.open({ id: meta.id, path: meta.path })
  const tool = new TestToolInstance(session.getContent() as TestContent)
  session.attach(tool)
  tool.edit('未保存的修改')
  return { meta, session, tool }
}

describe('与打开的文档会话配合', () => {
  it('改名前写完最后一次，改名后会话按新位置继续保存', async () => {
    const kit = setup()
    const { meta, session, tool } = await openEdited(kit)
    await kit.operations.renameDocument({ id: meta.id, path: meta.path }, '新海报')
    expect(kit.commands.stored(meta.id)?.content).toEqual({ items: ['a', '未保存的修改'] })
    expect(session.documentMeta).toMatchObject({ name: '新海报', path: expect.stringContaining('新海报') })
    tool.edit('改名后')
    await session.flush()
    expect(kit.commands.stored(meta.id)?.content).toEqual({ items: ['a', '未保存的修改', '改名后'] })
  })

  it('移到项目前写完最后一次，移动后会话换到项目里的位置并重新载入', async () => {
    const kit = setup()
    const project = kit.commands.seedProject({ name: '宣传片' })
    const { meta, session, tool } = await openEdited(kit)
    const result = await kit.operations.moveDocument({ id: meta.id, path: meta.path }, { kind: 'project', projectId: project.id })
    expect(result.meta.container).toEqual({ kind: 'project', projectId: project.id })
    expect(session.documentMeta.container).toEqual({ kind: 'project', projectId: project.id })
    expect(session.documentMeta.path.startsWith(project.path)).toBe(true)
    // 换容器时 revision 加一，会话按新位置重新载入，工具收到的是写盘后的内容
    expect(tool.received.at(-1)).toEqual({ items: ['a', '未保存的修改'] })
  })

  it('创建副本前写完最后一次，副本带上未保存的修改且自动加序号', async () => {
    const kit = setup()
    const { meta } = await openEdited(kit)
    const copy = await kit.operations.duplicateDocument({ id: meta.id, path: meta.path })
    expect(copy.meta.name).toBe('海报 (2)')
    expect(kit.commands.stored(copy.meta.id)?.content).toEqual({ items: ['a', '未保存的修改'] })
  })

  it('正在编辑的文档不能移到回收站，没打开的可以', async () => {
    const kit = setup()
    const { meta } = await openEdited(kit)
    await expect(kit.operations.trashDocument({ id: meta.id, path: meta.path })).rejects.toMatchObject({ name: 'DocumentInUseError' })
    expect(kit.commands.trashed).toEqual([])
    const other = kit.commands.seed({ name: '旧稿', content: { items: [] } })
    await kit.operations.trashDocument({ id: other.id, path: other.path })
    expect(kit.commands.trashed).toEqual([other.id])
  })

  it('工具在后台持有的会话：先请工具释放再移到回收站；工具拒绝释放时照旧报正在编辑', async () => {
    const kit = setup()
    const { meta, session } = await openEdited(kit)
    let allow = false
    kit.operations.registerReleaser('canvas', async (id) => {
      if (!allow) return false
      await kit.registry.get(id)?.close()
      return true
    })
    await expect(kit.operations.trashDocument({ id: meta.id, path: meta.path })).rejects.toMatchObject({ name: 'DocumentInUseError' })
    expect(kit.commands.trashed).toEqual([])
    allow = true
    await kit.operations.trashDocument({ id: meta.id, path: meta.path })
    expect(session.isEnded).toBe(true)
    expect(kit.commands.trashed).toEqual([meta.id])
  })

  it('从列表移除只对找不到文件的文档生效，文件还在时拒绝', async () => {
    const kit = setup()
    const present = kit.commands.seed({ name: '还在', content: { items: [] } })
    await expect(kit.operations.forgetDocument(present.id)).rejects.toMatchObject({ name: 'DocumentLocationError' })
    const missing = kit.commands.seed({ name: '丢失', content: { items: [] } })
    kit.commands.missingIds.add(missing.id)
    const before = kit.operations.revision()
    await kit.operations.forgetDocument(missing.id)
    expect(kit.commands.stored(missing.id)).toBeUndefined()
    expect(kit.operations.revision()).toBe(before + 1)
  })
})

describe('名称与重名', () => {
  it('改名重名报错且不加后缀；移动重名按 onConflict 处理', async () => {
    const kit = setup()
    const project = kit.commands.seedProject({ name: '项目' })
    const first = kit.commands.seed({ name: '镜头', content: { items: [] } })
    kit.commands.seed({ name: '镜头 2', content: { items: [] } })
    kit.commands.seed({ name: '镜头', content: { items: [] }, folder: project.path, projectId: project.id })
    await expect(kit.operations.renameDocument({ id: first.id }, '镜头 2')).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    expect(kit.commands.stored(first.id)?.meta.name).toBe('镜头')
    await expect(kit.operations.moveDocument({ id: first.id }, { kind: 'project', projectId: project.id })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    const kept = await kit.operations.moveDocument({ id: first.id }, { kind: 'project', projectId: project.id }, 'keepBoth')
    expect(kept.meta.name).toBe('镜头 (2)')
  })

  it('实时检查：改名排除自己，新建项目查“项目”文件夹', async () => {
    const kit = setup()
    const meta = kit.commands.seed({ name: '海报', content: { items: [] } })
    kit.commands.seedProject({ name: '已有项目' })
    expect((await kit.operations.checkDocumentName(meta, '海报')).status).toBe('available')
    expect((await kit.operations.checkNewProjectName('已有项目')).status).toBe('duplicate')
    expect((await kit.operations.checkNewProjectName('新项目')).status).toBe('available')
  })
})

describe('打开、通知与版本', () => {
  it('打开交给该类型登记的打开方式；没有登记时说明原因', async () => {
    const kit = setup()
    const meta = kit.commands.seed({ name: '海报', content: { items: [] } })
    const summary = await kit.operations.findDocument(meta.id)
    await expect(kit.operations.openDocument(summary)).rejects.toMatchObject({ name: 'DocumentNotOpenableError' })
    const opener = vi.fn()
    const unregister = kit.operations.registerOpener('canvas', opener)
    await kit.operations.openDocument(summary)
    expect(opener).toHaveBeenCalledWith(summary, {})
    unregister()
    expect(kit.operations.canOpen('canvas')).toBe(false)
  })

  it('每次写入推进版本并通知订阅者，失败不推进', async () => {
    const kit = setup()
    const meta = kit.commands.seed({ name: '海报', content: { items: [] } })
    kit.commands.seed({ name: '占用', content: { items: [] } })
    const listener = vi.fn()
    kit.operations.subscribe(listener)
    await kit.operations.renameDocument({ id: meta.id }, '新名')
    expect(kit.operations.revision()).toBe(1)
    await expect(kit.operations.renameDocument({ id: meta.id }, '占用')).rejects.toBeTruthy()
    expect(kit.operations.revision()).toBe(1)
    await kit.operations.createProject('新项目')
    expect(kit.operations.revision()).toBe(2)
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('单文件包与复制进项目（4.1）', () => {
  it('导出前写完最后一次（含正在编辑的修改），导入推进版本并按容器放置', async () => {
    const kit = setup()
    const { meta } = await openEdited(kit)
    const exported = await kit.operations.exportDocumentPackage({ id: meta.id, path: meta.path }, 'D:/外部/海报.henjipack')
    expect(exported.path).toBe('D:/外部/海报.henjipack')
    expect(kit.commands.packages.get(exported.path)).toMatchObject({ type: 'document', content: { items: ['a', '未保存的修改'] } })
    const project = kit.commands.seedProject({ name: '宣传片' })
    const before = kit.operations.revision()
    const imported = await kit.operations.importPackage(exported.path, { kind: 'project', projectId: project.id })
    expect(imported.type === 'document' && imported.meta.container).toEqual({ kind: 'project', projectId: project.id })
    expect(kit.operations.revision()).toBe(before + 1)
  })

  it('导出项目前写完项目里所有打开的文档', async () => {
    const kit = setup()
    const project = kit.commands.seedProject({ name: '宣传片' })
    const meta = kit.commands.seed({ name: '镜头', content: { items: ['a'] }, projectId: project.id, folder: project.path })
    const session = await kit.registry.open({ id: meta.id, path: meta.path })
    const tool = new TestToolInstance(session.getContent() as TestContent)
    session.attach(tool)
    tool.edit('项目里未保存的修改')
    await kit.operations.exportProjectPackage(project.id)
    expect(kit.commands.stored(meta.id)?.content).toEqual({ items: ['a', '项目里未保存的修改'] })
    expect(kit.commands.exportedPackages.at(-1)).toMatchObject({ projectId: project.id })
  })

  it('复制进本项目：副本在目标项目里，原件不动', async () => {
    const kit = setup()
    const project = kit.commands.seedProject({ name: '宣传片' })
    const meta = kit.commands.seed({ name: '海报', content: { items: ['a'] } })
    const copy = await kit.operations.duplicateDocument({ id: meta.id, path: meta.path }, 'keepBoth', { kind: 'project', projectId: project.id })
    expect(copy.meta.id).not.toBe(meta.id)
    expect(copy.meta.container).toEqual({ kind: 'project', projectId: project.id })
    expect(kit.commands.stored(meta.id)?.meta.container).toEqual({ kind: 'user' })
  })
})

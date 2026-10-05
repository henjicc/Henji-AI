import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTestEnvironment, listFiles, type TestEnvironment } from './documents.test-support'

let env: TestEnvironment

async function readStored(filePath: string): Promise<{ text: string; json: Record<string, unknown> }> {
  const text = await fsp.readFile(filePath, 'utf8')
  return { text, json: JSON.parse(text) as Record<string, unknown> }
}

function write(target: string, bytes = 'x'): string {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, bytes)
  return target
}

describe('文档仓库：新建与草稿', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it('新建的独立文档以草稿存进类型文件夹（用到时才建），自动名顺延', async () => {
    const { service } = env.services
    expect(fs.existsSync(path.join(env.workRoot, '画布'))).toBe(false)
    const first = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const second = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    expect(first.meta.path).toBe(path.join(env.workRoot, '画布', '未命名画布 1.henji-canvas'))
    expect(second.meta.name).toBe('未命名画布 2')
    expect(first.meta).toMatchObject({ kind: 'canvas', draft: true, revision: 0, container: { kind: 'user' } })
    const { json } = await readStored(first.meta.path)
    expect(json).toMatchObject({ format: 'henji-document', kind: 'canvas', kindVersion: 1, name: '未命名画布 1', draft: true, revision: 0, content: {} })
    expect(env.catalog.getDocument(first.meta.id)?.path).toBe(first.meta.path)
  })

  it('英文作品目录用英文文件夹与自动名；剪辑不能独立存放；图片文档的读写留给专用编辑器', async () => {
    await env.cleanup()
    env = createTestEnvironment({ locale: 'en' })
    const created = await env.services.service.createDocument({ kind: 'camera_stage', container: { kind: 'user' } })
    expect(created.meta.path).toBe(path.join(env.workRoot, 'Camera Stages', 'Untitled Camera Stage 1.henji-stage'))
    await expect(env.services.service.createDocument({ kind: 'video_edit', container: { kind: 'user' } })).rejects.toMatchObject({ name: 'DocumentLocationError' })
    await expect(env.services.service.createDocument({ kind: 'image_document', container: { kind: 'user' } })).rejects.toMatchObject({ name: 'DocumentUnsupportedError' })
  })

  it('给了名字按用户输入处理：重名报错不加后缀，非法名称报错', async () => {
    const { service } = env.services
    const named = await service.createDocument({ kind: 'audio_edit', container: { kind: 'user' }, name: '  口播 一 ' })
    expect(named.meta).toMatchObject({ name: '口播 一', draft: false })
    await expect(service.createDocument({ kind: 'audio_edit', container: { kind: 'user' }, name: '口播 一.' })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    await expect(service.createDocument({ kind: 'audio_edit', container: { kind: 'user' }, name: 'a/b' })).rejects.toMatchObject({ name: 'DocumentNameInvalidError' })
    expect(await listFiles(path.join(env.workRoot, '口播'))).toEqual(['口播 一.henji-audio'])
  })

  it('项目里新建：文档放在项目文件夹里，草稿名按项目语言', async () => {
    const project = await env.services.service.createProject()
    const created = await env.services.service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id } })
    expect(created.meta.path).toBe(path.join(project.path, '未命名剪辑 1.henji-video'))
    expect(created.meta.container).toEqual({ kind: 'project', projectId: project.id })
  })
})

describe('文档仓库：保存、读取与位置换算', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it('保存时把作品目录与项目里的路径换成相对写法，读出时换回绝对路径；外部文件原样', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '短片' })
    const other = await service.createProject({ name: '素材库' })
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id } })
    const inProject = write(path.join(project.path, '生成结果', '镜头 1.png'))
    const inOther = write(path.join(other.path, '素材', '参考.jpg'))
    const inWork = write(path.join(env.workRoot, '上传素材', 'bgm.mp3'))
    const external = write(path.join(env.outside, '外部 视频.mp4'))
    const mediaUrl = `henji-media://local/${encodeURIComponent(inProject)}`
    const content = { nodes: [{ imageUrl: inProject, preview: mediaUrl }, { image: inOther }, { audio: inWork, video: external }], note: '提示词保持原样' }
    const saved = await service.saveDocument({ target: { id: created.meta.id, path: created.meta.path }, expectedRevision: 0, content })
    expect(saved).toMatchObject({ unchanged: false, meta: { revision: 1 } })

    const { text, json } = await readStored(created.meta.path)
    expect(json.content).toEqual({
      nodes: [{ imageUrl: 'henji:/生成结果/镜头 1.png', preview: 'henji:/生成结果/镜头 1.png' }, { image: `henji://project/${other.id}/素材/参考.jpg` }, { audio: 'henji://user/上传素材/bgm.mp3', video: external }],
      note: '提示词保持原样',
    })
    expect(text).not.toContain(JSON.stringify(env.workRoot).slice(1, -1))
    expect(text).not.toContain('henji-media://')

    const read = await service.readDocument({ id: created.meta.id })
    expect(read.content).toEqual({ ...content, nodes: [{ imageUrl: inProject, preview: inProject }, { image: inOther }, { audio: inWork, video: external }] })
    expect(read.missingPaths).toEqual([])
    expect(read.externalDirectories).toEqual([env.outside])
    expect(env.granted).toContain(env.outside)
  })

  it('核对版本：过期版本报冲突且文件不变；内容没变不写文件；选择覆盖时跳过核对', async () => {
    const { service } = env.services
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const target = { id: created.meta.id, path: created.meta.path }
    await service.saveDocument({ target, expectedRevision: 0, content: { a: 1 } })
    const before = await fsp.readFile(created.meta.path, 'utf8')
    await expect(service.saveDocument({ target, expectedRevision: 0, content: { a: 2 } })).rejects.toMatchObject({ name: 'DocumentRevisionConflictError' })
    expect(await fsp.readFile(created.meta.path, 'utf8')).toBe(before)
    const unchanged = await service.saveDocument({ target, expectedRevision: 1, content: { a: 1 } })
    expect(unchanged).toMatchObject({ unchanged: true, meta: { revision: 1 } })
    expect(await fsp.readFile(created.meta.path, 'utf8')).toBe(before)
    const forced = await service.saveDocument({ target, expectedRevision: 0, content: { a: 3 }, force: true })
    expect(forced.meta.revision).toBe(2)
    expect(await listFiles(path.dirname(created.meta.path))).toEqual(['未命名画布 1.henji-canvas'])
  })

  it('读取报告找不到的素材与无法解析的引用；程序目录里的路径原样保留', async () => {
    const { service } = env.services
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const gone = path.join(env.workRoot, '生成结果', '已删除.png')
    const programPath = path.join(env.programRoot, 'Thumbnails', 't.webp')
    await service.saveDocument({ target: { id: created.meta.id }, expectedRevision: 0, content: { a: gone, b: programPath } })
    const raw = JSON.parse(await fsp.readFile(created.meta.path, 'utf8')) as { content: Record<string, string> }
    expect(raw.content).toEqual({ a: 'henji:/生成结果/已删除.png', b: programPath })
    raw.content.c = 'henji://project/unknown-project/a.png'
    await fsp.writeFile(created.meta.path, JSON.stringify(raw))
    const read = await service.readDocument({ id: created.meta.id })
    expect(read.missingPaths).toEqual([gone])
    expect(read.unresolved).toEqual([{ value: 'henji://project/unknown-project/a.png', reason: 'unknown_project', projectId: 'unknown-project' }])
  })

  it('位置过期时按 ID 从索引找到文档；ID 对不上的文件不会被当成目标', async () => {
    const { service } = env.services
    const created = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '甲' })
    const renamed = await service.renameDocument({ target: { id: created.meta.id }, name: '乙' })
    const saved = await service.saveDocument({ target: { id: created.meta.id, path: created.meta.path }, expectedRevision: 0, content: { a: 1 } })
    expect(saved.meta.path).toBe(renamed.path)
    const other = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '丙' })
    await expect(service.readDocument({ id: 'not-there', path: other.meta.path })).rejects.toMatchObject({ name: 'DocumentNotFoundError' })
  })
})

describe('文档仓库：改名、转正、移动、副本、删除', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it('改名同步文件名与文件头；重名报错且两份文件不变；只改大小写可以；不同类型可以同名', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '项目甲' })
    const container = { kind: 'project' as const, projectId: project.id }
    const canvas = await service.createDocument({ kind: 'canvas', container, name: '分镜' })
    const stage = await service.createDocument({ kind: 'camera_stage', container, name: '镜头' })
    const renamed = await service.renameDocument({ target: { id: canvas.meta.id }, name: '镜头' })
    expect(renamed).toMatchObject({ name: '镜头', path: path.join(project.path, '镜头.henji-canvas'), revision: 0 })
    expect((await readStored(renamed.path)).json.name).toBe('镜头')
    const second = await service.createDocument({ kind: 'canvas', container, name: '其他' })
    await expect(service.renameDocument({ target: { id: second.meta.id }, name: 'jing头' })).resolves.toBeTruthy()
    await expect(service.renameDocument({ target: { id: second.meta.id }, name: '镜头' })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    expect(await listFiles(project.path)).toEqual(['.henji/project.json', 'jing头.henji-canvas', '镜头.henji-canvas', '镜头.henji-stage'])
    const caseOnly = await service.renameDocument({ target: { id: second.meta.id }, name: 'JING头' })
    expect(path.basename(caseOnly.path)).toBe('JING头.henji-canvas')
    expect(stage.meta.name).toBe('镜头')
  })

  it('草稿转正：原地起名并去掉草稿标记，版本不变；重名时保持草稿', async () => {
    const { service } = env.services
    const draft = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '已存在' })
    await expect(service.finalizeDocument({ target: { id: draft.meta.id }, name: '已存在' })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    expect((await readStored(draft.meta.path)).json.draft).toBe(true)
    const result = await service.finalizeDocument({ target: { id: draft.meta.id }, name: '分镜一' })
    expect(result.meta).toMatchObject({ name: '分镜一', draft: false, revision: 0 })
    expect('draft' in (await readStored(result.meta.path)).json).toBe(false)
    expect(fs.existsSync(draft.meta.path)).toBe(false)
  })

  it('草稿转正另选位置：移到作品目录之外并登记为外部位置，相对作品目录的引用照常换算', async () => {
    const { service } = env.services
    const draft = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const media = write(path.join(env.workRoot, '生成结果', 'a.png'))
    await service.saveDocument({ target: { id: draft.meta.id }, expectedRevision: 0, content: { media } })
    const result = await service.finalizeDocument({ target: { id: draft.meta.id }, name: '外面的画布', folder: env.outside })
    expect(result.meta).toMatchObject({ path: path.join(env.outside, '外面的画布.henji-canvas'), draft: false, container: { kind: 'user' } })
    expect(env.catalog.listExternalLocations()).toEqual([expect.objectContaining({ path: env.outside, kind: 'folder' })])
    expect((await readStored(result.meta.path)).json.content).toEqual({ media: 'henji:/生成结果/a.png' })
    expect((await service.readDocument({ id: draft.meta.id })).content).toEqual({ media })
    await expect(service.finalizeDocument({ target: { id: draft.meta.id }, name: 'x', folder: path.join(env.programRoot, 'x') })).rejects.toMatchObject({ name: 'DocumentLocationError' })
  })

  it('移入项目：原容器里用到的素材复制过去（原处保留）并改写引用，外部与其他项目的不动', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '目标项目' })
    const other = await service.createProject({ name: '别的项目' })
    const canvas = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '分镜' })
    const generated = write(path.join(env.workRoot, '生成结果', '子目录', 'a.png'), 'generated')
    const uploaded = write(path.join(env.workRoot, '上传素材', 'b.wav'), 'uploaded')
    const otherFile = write(path.join(other.path, '素材', 'c.jpg'))
    const external = write(path.join(env.outside, 'd.mp4'))
    const missing = path.join(env.workRoot, '生成结果', 'gone.png')
    await service.saveDocument({ target: { id: canvas.meta.id }, expectedRevision: 0, content: { generated, uploaded, otherFile, external, missing } })
    write(path.join(project.path, '生成结果', '子目录', 'a.png'), 'different content')

    const moved = await service.moveDocument({ target: { id: canvas.meta.id }, container: { kind: 'project', projectId: project.id } })
    expect(moved.meta).toMatchObject({ path: path.join(project.path, '分镜.henji-canvas'), container: { kind: 'project', projectId: project.id }, revision: 2 })
    expect(moved.copiedFiles).toBe(2)
    expect(moved.missingPaths).toEqual([missing])
    expect(fs.existsSync(canvas.meta.path)).toBe(false)
    expect(fs.existsSync(generated) && fs.existsSync(uploaded)).toBe(true)
    expect((await readStored(moved.meta.path)).json.content).toEqual({
      generated: 'henji:/生成结果/子目录/a (2).png',
      uploaded: 'henji:/素材/b.wav',
      otherFile: `henji://project/${other.id}/素材/c.jpg`,
      external,
      missing: `henji://user/生成结果/gone.png`,
    })

    const back = await service.moveDocument({ target: { id: canvas.meta.id }, container: { kind: 'user' } })
    expect(back.copiedFiles).toBe(1)
    expect((await readStored(back.meta.path)).json.content).toMatchObject({ generated: 'henji:/生成结果/子目录/a (2).png', uploaded: 'henji:/上传素材/b.wav' })
  })

  it('移出项目：内部资源复制到作品目录的 .henji（用到时才建并设为隐藏），其他文档不复制', async () => {
    const { service } = env.services
    const from = await service.createProject({ name: '来源' })
    const canvas = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: from.id }, name: '画布' })
    const stage = await service.createDocument({ kind: 'camera_stage', container: { kind: 'project', projectId: from.id }, name: '镜头' })
    const layer = write(path.join(from.path, '.henji', 'layers', 'l1.png'))
    const looseFile = write(path.join(from.path, '参考', 'r.png'))
    await service.saveDocument({ target: { id: canvas.meta.id }, expectedRevision: 0, content: { layer, looseFile, stage: stage.meta.path } })
    expect(fs.existsSync(path.join(env.workRoot, '.henji'))).toBe(false)
    const moved = await service.moveDocument({ target: { id: canvas.meta.id }, container: { kind: 'user' } })
    expect(moved.copiedFiles).toBe(2)
    expect((await readStored(moved.meta.path)).json.content).toEqual({
      layer: 'henji:/.henji/layers/l1.png',
      looseFile: 'henji:/上传素材/参考/r.png',
      stage: `henji://project/${from.id}/镜头.henji-stage`,
    })
    expect(env.hidden).toContain(path.join(env.workRoot, '.henji'))
    expect(fs.existsSync(path.join(env.workRoot, '.henji', 'layers', 'l1.png'))).toBe(true)
  })

  it('移动遇到重名：默认报错，两个都保留时自动加序号；剪辑不能移出项目', async () => {
    const { service } = env.services
    const first = await service.createProject({ name: '一' })
    const second = await service.createProject({ name: '二' })
    const source = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: first.id }, name: '同名' })
    await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: second.id }, name: '同名' })
    const destination = { kind: 'project' as const, projectId: second.id }
    await expect(service.moveDocument({ target: { id: source.meta.id }, container: destination })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    expect(fs.existsSync(source.meta.path)).toBe(true)
    const moved = await service.moveDocument({ target: { id: source.meta.id }, container: destination, onConflict: 'keepBoth' })
    expect(moved.meta.name).toBe('同名 (2)')
    const edit = await service.createDocument({ kind: 'video_edit', container: destination })
    await expect(service.moveDocument({ target: { id: edit.meta.id }, container: { kind: 'user' } })).rejects.toMatchObject({ name: 'DocumentLocationError' })
  })

  it('创建副本：新 ID、非草稿、版本从 0 开始，同名时按要求报错或加序号', async () => {
    const { service } = env.services
    const original = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '原件' })
    await service.saveDocument({ target: { id: original.meta.id }, expectedRevision: 0, content: { a: 1 } })
    await expect(service.duplicateDocument({ target: { id: original.meta.id } })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    const copy = await service.duplicateDocument({ target: { id: original.meta.id }, onConflict: 'keepBoth' })
    expect(copy.meta).toMatchObject({ name: '原件 (2)', draft: false, revision: 0 })
    expect(copy.meta.id).not.toBe(original.meta.id)
    expect((await service.readDocument({ id: copy.meta.id })).content).toEqual({ a: 1 })
    const named = await service.duplicateDocument({ target: { id: original.meta.id }, name: '另一份' })
    expect(named.meta.name).toBe('另一份')
  })

  it('移到回收站与删除空草稿：只有空草稿能直接删除，其余走回收站并清掉索引与封面', async () => {
    const { service } = env.services
    const empty = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    const filled = await service.createDocument({ kind: 'canvas', container: { kind: 'user' } })
    await service.saveDocument({ target: { id: filled.meta.id }, expectedRevision: 0, content: { nodes: [1] } })
    const saved = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '正式' })
    await expect(service.deleteEmptyDraft({ id: filled.meta.id })).rejects.toMatchObject({ name: 'DocumentNotEmptyError' })
    await expect(service.deleteEmptyDraft({ id: saved.meta.id })).rejects.toMatchObject({ name: 'DocumentNotEmptyError' })
    await service.saveDocumentCover({ docId: empty.meta.id, sources: [{ source: 'x', sourceKind: 'image' }] })
    await service.deleteEmptyDraft({ id: empty.meta.id })
    expect(fs.existsSync(empty.meta.path)).toBe(false)
    expect(await service.getDocumentCover(empty.meta.id)).toBeNull()
    expect(env.trashed).toEqual([])
    await service.trashDocument({ id: filled.meta.id })
    expect(env.trashed).toEqual([filled.meta.path])
    expect(env.catalog.getDocument(filled.meta.id)).toBeNull()
    await service.revealDocument({ id: saved.meta.id })
    expect(env.revealed).toEqual([saved.meta.path])
  })

  it('从列表移除：文件还在时拒绝；文件不见了只删索引与封面，不动磁盘', async () => {
    const { service } = env.services
    const doc = await service.createDocument({ kind: 'camera_stage', container: { kind: 'user' }, name: '外出' })
    await service.saveDocumentCover({ docId: doc.meta.id, sources: [{ source: 'x', sourceKind: 'image' }] })
    await expect(service.forgetDocument(doc.meta.id)).rejects.toMatchObject({ name: 'DocumentLocationError' })
    expect(env.catalog.getDocument(doc.meta.id)).not.toBeNull()
    const elsewhere = path.join(env.outside, '外出.henji-stage')
    await fsp.rename(doc.meta.path, elsewhere)
    await service.forgetDocument(doc.meta.id)
    expect(env.catalog.getDocument(doc.meta.id)).toBeNull()
    expect(await service.getDocumentCover(doc.meta.id)).toBeNull()
    expect(fs.existsSync(elsewhere)).toBe(true)
    expect(env.trashed).toEqual([])
    // 已经不在索引里：再移除一次什么也不做
    await service.forgetDocument(doc.meta.id)
  })

  it('跨文档引用：先按位置找，位置失效后按 ID 找，都找不到报缺失', async () => {
    const { service } = env.services
    const doc = await service.createDocument({ kind: 'camera_stage', container: { kind: 'user' }, name: '镜头' })
    expect(await service.resolveDocumentLink({ docId: doc.meta.id, path: doc.meta.path })).toMatchObject({ status: 'found', via: 'path' })
    const renamed = await service.renameDocument({ target: { id: doc.meta.id }, name: '镜头二' })
    expect(await service.resolveDocumentLink({ docId: doc.meta.id, path: doc.meta.path })).toMatchObject({ status: 'found', via: 'id', meta: { path: renamed.path } })
    await service.trashDocument({ id: doc.meta.id })
    expect(await service.resolveDocumentLink({ docId: doc.meta.id, path: doc.meta.path })).toEqual({ status: 'missing' })
  })
})

describe('名称检查', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it('文档查同文件夹里的同名文件：不分大小写、去掉末尾空格和点、不同类型可以同名', async () => {
    const { service } = env.services
    const doc = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: 'Demo' })
    const location = { container: { kind: 'user' as const } }
    expect(await service.checkName({ subject: { type: 'document', kind: 'canvas' }, name: 'demo. ', location })).toEqual({
      status: 'duplicate', name: 'demo', path: path.join(env.workRoot, '画布', 'demo.henji-canvas'), existingPath: doc.meta.path,
    })
    expect(await service.checkName({ subject: { type: 'document', kind: 'camera_stage' }, name: 'Demo', location: { folder: path.dirname(doc.meta.path) } })).toMatchObject({ status: 'available' })
    expect(await service.checkName({ subject: { type: 'document', kind: 'canvas' }, name: 'DEMO', location: { renaming: doc.meta.path } })).toMatchObject({ status: 'available' })
    expect(await service.checkName({ subject: { type: 'document', kind: 'canvas' }, name: 'Demo', location: { folder: env.outside } })).toMatchObject({ status: 'available', path: path.join(env.outside, 'Demo.henji-canvas') })
    expect(await service.checkName({ subject: { type: 'document', kind: 'canvas' }, name: 'NUL', location })).toMatchObject({ status: 'invalid', reason: 'reserved' })
    expect(await service.checkName({ subject: { type: 'document', kind: 'video_edit' }, name: 'x', location })).toMatchObject({ status: 'invalid', reason: 'location' })
  })

  it('项目查同级文件夹名；项目不能放进项目', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '短片' })
    expect(await service.checkName({ subject: { type: 'project' }, name: '短片', location: { container: { kind: 'user' } } })).toMatchObject({ status: 'duplicate', existingPath: project.path })
    expect(await service.checkName({ subject: { type: 'project' }, name: '短片', location: { folder: env.outside } })).toMatchObject({ status: 'available' })
    expect(await service.checkName({ subject: { type: 'project' }, name: 'x', location: { container: { kind: 'project', projectId: project.id } } })).toMatchObject({ status: 'invalid', reason: 'location' })
  })
})

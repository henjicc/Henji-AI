import fsp from 'node:fs/promises'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createTestEnvironment, silentLogger } from './documents.test-support'
import { DocumentSessionStateStore } from './session-state'
import { writeBufferAtomically } from '../fs/atomic-file'
import { readJsonFile, writeJsonFile } from '../fs/json-file'

it('超过原文档与会话预算的生成内容经正式服务分块保存并完整读回', async () => {
  const env = createTestEnvironment()
  try {
    const service = env.services.service
    const document = await service.createDocument({ kind: 'canvas', name: '大文档', container: { kind: 'user' } })
    const block = '中文🙂\\"\n'.repeat(32768)
    const rows = Array.from({ length: 530 }, (_, index) => ({ index, text: block }))
    await service.saveDocument({ target: document.meta, content: { rows }, expectedRevision: document.meta.revision })
    expect((await fsp.stat(document.meta.path)).size).toBeGreaterThan(256 * 1024 ** 2)
    const opened = await service.readDocument(document.meta)
    const content = opened.content as { rows: typeof rows }
    expect(content.rows.length).toBe(rows.length)
    expect(content.rows[0]).toEqual(rows[0])
    expect(content.rows.at(-1)).toEqual(rows.at(-1))

    const state = new DocumentSessionStateStore({ directory: path.join(env.base, 'session'), logger: silentLogger() })
    const key = { docId: document.meta.id, key: 'undo' }
    await state.write({ ...key, value: { rows: rows.slice(0, 140) } })
    expect((await fsp.stat(path.join(env.base, 'session', key.docId, 'undo.json'))).size).toBeGreaterThan(64 * 1024 ** 2)
    const restored = await state.read(key) as { rows: typeof rows }
    expect(restored.rows.length).toBe(140)
    expect(restored.rows.at(-1)).toEqual(rows[139])
  } finally { await env.cleanup() }
}, 60000)

it('分块写到中途失败时保留原件并清理暂存', async () => {
  const env = createTestEnvironment()
  async function* failing(): AsyncGenerator<string> { yield '{"partial":'; throw new Error('生成失败') }
  try {
    const target = path.join(env.outside, 'state.json')
    await fsp.writeFile(target, '{"kept":true}')
    await expect(writeBufferAtomically(target, failing())).rejects.toThrow('生成失败')
    expect(await fsp.readFile(target, 'utf8')).toBe('{"kept":true}')
    expect(await fsp.readdir(env.outside)).toEqual(['state.json'])
  } finally { await env.cleanup() }
})

it('大项目说明不会从索引消失，更新说明保留未来字段', async () => {
  const env = createTestEnvironment()
  try {
    const project = await env.services.service.createProject({ name: '项目说明' })
    const file = env.services.workspace.manifestPath(project.path)
    const raw = await readJsonFile(file) as Record<string, unknown>
    const details = Array.from({ length: 20 }, (_, index) => `${index}:${'资料'.repeat(32_768)}`)
    await writeJsonFile(file, { ...raw, version: Number(raw.version) + 1, details })
    expect((await fsp.stat(file)).size).toBeGreaterThan(1024 ** 2)
    const manifest = await env.services.workspace.readManifest(project.path)
    expect(manifest?.id).toBe(project.id)
    await env.services.scanner.rebuild()
    expect(env.catalog.getProject(project.id)?.missing).toBe(false)
    await env.services.workspace.writeManifest(project.path, manifest!)
    expect((await readJsonFile(file) as Record<string, unknown>).details).toEqual(details)
  } finally { await env.cleanup() }
})

import fsp from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { createTestEnvironment, silentLogger } from './documents.test-support'

it('权限/I/O 故障保留原索引并拒绝扫描；只有确定不存在才标记缺失', async () => {
  const logger = { ...silentLogger(), info: vi.fn(), error: vi.fn() }
  const env = createTestEnvironment({ logger })
  try {
    const project = await env.services.service.createProject({ name: '保留' })
    const doc = await env.services.service.createDocument({ kind: 'canvas', name: '保留文档', container: { kind: 'project', projectId: project.id } })
    const before = { projects: env.catalog.listProjects(), documents: env.catalog.listDocuments() }
    const describe = env.services.workspace.describeProject.bind(env.services.workspace)
    vi.spyOn(env.services.workspace, 'describeProject').mockImplementationOnce(async (root, manifest) => {
      const row = await describe(root, manifest)
      // 项目更新已经暂存后才注入目录读取失败，验证失败不会留下半轮索引。
      vi.spyOn(fsp, 'readdir').mockRejectedValueOnce(Object.assign(new Error('access denied'), { code: 'EACCES' }))
      return { ...row, draft: !row.draft }
    })
    await expect(env.services.scanner.rebuild()).rejects.toThrow('原有索引已保留')
    vi.restoreAllMocks()
    expect({ projects: env.catalog.listProjects(), documents: env.catalog.listDocuments() }).toEqual(before)
    const stat = vi.spyOn(fsp, 'stat').mockRejectedValueOnce(Object.assign(new Error('I/O failure'), { code: 'EIO' }))
    await expect(env.services.scanner.refresh()).rejects.toThrow('访问权限')
    stat.mockRestore()
    expect({ projects: env.catalog.listProjects(), documents: env.catalog.listDocuments() }).toEqual(before)
    expect(logger.info.mock.calls.some(([, meta]) => meta.event === 'documents.index.scan.completed')).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'documents.index.scan.failed' }))
    await fsp.rm(doc.meta.path)
    await env.services.scanner.refresh()
    expect(env.catalog.getDocument(doc.meta.id)?.missing).toBe(true)
  } finally { vi.restoreAllMocks(); await env.cleanup() }
})

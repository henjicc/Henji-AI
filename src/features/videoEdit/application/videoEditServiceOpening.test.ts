// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { testCodeManifest, testFilesSource } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import type { CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { closeAllVideoEdits, createVideoEditTestProject, seedVideoEditDocument, replaceSavedVideoEdit } from './videoEditDocumentTestKit'
import { closeVideoEditProject, createVideoEditProject, openVideoEditDocument } from './videoEditService'

const checks = vi.hoisted(() => ({ hold: false, pending: new Set<{ resolve(): void; reject(error: Error): void }>(), disposed: 0 }))
vi.mock('../engine/videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class {
    async compile(source: string | CodeMaterialFiles): Promise<CodeMaterialProgram> {
      if (checks.hold) await new Promise<void>((resolve, reject) => {
        const request = { resolve: () => { checks.pending.delete(request); resolve() }, reject }
        checks.pending.add(request)
      })
      return compileCodeMaterial(testFilesSource(source))
    }
    dispose(): void {
      checks.disposed++
      for (const pending of checks.pending) pending.reject(new Error('源码检查会话已关闭。'))
      checks.pending.clear()
    }
  } }
})
beforeEach(() => { installHarnessNativeStorage(); checks.hold = false; checks.disposed = 0 })
afterEach(async () => { for (const request of checks.pending) request.resolve(); await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it.each(['close', 'failed-open', 'create'] as const)('后台打开正在编译时%s不释放共享编译器', async action => {
  const a = await createVideoEditTestProject()
  const document = structuredClone(a.document); document.id = 'background-code'; document.name = '后台代码'
  const source = 'export default {apiVersion:1,languageVersion:3,name:"代码",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:2,seed:7,parameters:{},render(ctx){return [rect({x:ctx.time,y:0,width:100,height:100,fill:ctx.style.palette.accent})];}}'
  document.codeMaterials = [{ id: 'definition', name: '代码', defaultVersionId: 'version', versions: [{ id: 'version', apiVersion: 1, languageVersion: 3, ...testCodeManifest(source, document) }] }]
  document.items.push({ id: 'code-item', name: '代码', kind: 'code', code: { definitionId: 'definition', versionId: 'version', parameters: {} } })
  const id = seedVideoEditDocument(document)
  if (action !== 'close') await closeVideoEditProject(a.document.id)
  checks.disposed = 0
  checks.hold = true
  const opening = openVideoEditDocument({ id }, { focus: false }).then(value => ({ value }), error => ({ error }))
  await vi.waitFor(() => expect(checks.pending.size).toBe(1))
  if (action === 'close') await closeVideoEditProject(a.document.id)
  else if (action === 'failed-open') {
    const brokenId = seedVideoEditDocument({ ...document, id: 'broken-code' })
    replaceSavedVideoEdit(brokenId, { media: [] })
    await expect(openVideoEditDocument({ id: brokenId })).rejects.toThrow()
  }
  else {
    const created = await createVideoEditProject()
    await closeVideoEditProject(created.document.id)
  }
  for (const request of checks.pending) request.resolve()
  const result = await opening
  if ('error' in result) throw result.error
  expect(result).toHaveProperty('value.document.id', id)
  await closeVideoEditProject(id)
  expect(checks.disposed).toBe(1)
})

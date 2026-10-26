import { afterEach, expect, it, vi } from 'vitest'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeTypeCheckReport } from '@/core/videoEdit/codeMaterial/typeDiagnostics'
import * as sharedCompiler from '../engine/videoEditSharedCompiler'
import { settleVideoEditCodeTypeChecks, startVideoEditCodeTypeCheck, withVideoEditCodeTypeContext } from './videoEditCodeTypeCheck'

const span = { file: 'main.ts', start: 10, end: 14, startLine: 2, startColumn: 3, endLine: 2, endColumn: 7 }
const found: CodeTypeCheckReport = { status: 'checked', checkedFiles: ['main.ts'], total: 1, elapsedMs: 2, diagnostics: [{ code: 2551, message: "Property 'fillStlye' does not exist", span }] }
const clean: CodeTypeCheckReport = { status: 'checked', checkedFiles: ['main.ts'], total: 0, elapsedMs: 2, diagnostics: [] }
const fail = (error: unknown) => async (): Promise<never> => { throw error }
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it('失败附上类型错误，保留错误类、错误码与源码位置', async () => {
  const signal = new AbortController().signal
  const original = new CodeMaterialError('PARAMETERS', '参数 amount 重复。', span)
  const error = await withVideoEditCodeTypeContext(fail(original), [Promise.resolve(found)], signal).catch((value: unknown) => value)
  expect(error).toBeInstanceOf(CodeMaterialError)
  expect(error).toMatchObject({ code: 'PARAMETERS', sourceSpan: span, message: `${original.message}\n类型检查同时发现 1 处问题，可能就是原因：\n- main.ts:2:3 TS2551 Property 'fillStlye' does not exist` })
  const render = new Error('GPU trial rejected')
  const wrapped = await withVideoEditCodeTypeContext(fail(render), [Promise.resolve(found)], signal).catch((value: unknown) => value)
  expect(wrapped).toMatchObject({ message: expect.stringMatching(/^GPU trial rejected\n类型检查同时发现/), cause: render })
})

it('取消、打包器已定位的语法错误与没有类型错误时原样抛出', async () => {
  const controller = new AbortController()
  for (const error of [new CodeMaterialError('SYNTAX', '缺少 }', span), new DOMException('已取消', 'AbortError')]) {
    await expect(withVideoEditCodeTypeContext(fail(error), [Promise.resolve(found)], controller.signal)).rejects.toBe(error)
  }
  const plain = new Error('GPU trial rejected')
  await expect(withVideoEditCodeTypeContext(fail(plain), [Promise.resolve(clean)], controller.signal)).rejects.toBe(plain)
  controller.abort()
  await expect(withVideoEditCodeTypeContext(fail(plain), [Promise.resolve(found)], controller.signal)).rejects.toBe(plain)
})

it('检查出错或等不到结果只记为没有结论，从不让创建失败', async () => {
  const files = { entry: 'main.ts', files: { 'main.ts': 'export default {name:"x",draw(){}}' } }
  vi.spyOn(sharedCompiler, 'checkVideoEditAuthorTypes').mockRejectedValueOnce(new Error('类型检查线程失败：内存不足'))
  await expect(startVideoEditCodeTypeCheck(files, [], new AbortController().signal)).resolves.toEqual({ status: 'unavailable', reason: '类型检查线程失败：内存不足' })
  // 钉住的组件尚未读取：放弃类型结论，打包会当场报出缺失。
  const pinned = { entry: 'main.ts', files: { 'main.ts': 'import { a } from "@组件/圆@1"\nexport default {name:"x",draw(){ void a }}' } }
  expect((await startVideoEditCodeTypeCheck(pinned, [{ name: '圆', version: 1, location: 'missing', hash: 'f'.repeat(64), imports: [] }], new AbortController().signal)).status).toBe('unavailable')
  vi.useFakeTimers()
  const settled = settleVideoEditCodeTypeChecks([Promise.resolve(found), new Promise<CodeTypeCheckReport>(() => undefined)], 8000)
  await vi.advanceTimersByTimeAsync(8000)
  await expect(settled).resolves.toEqual([found, { status: 'unavailable', reason: '等待超过 8 秒' }])
})

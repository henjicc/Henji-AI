import { beforeEach, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { readStaticTextFonts } from '@/core/videoEdit/codeMaterial/textFonts'
import { rememberTransientCodeSource } from '@/core/videoEdit/codeMaterial/sources'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { VideoEditTextPreflight } from './videoEditTextPreflight'

const mock = vi.hoisted(() => ({ compile: vi.fn() }))
vi.mock('./videoEditSharedCompiler', () => ({ prepareVideoEditAuthorBundle: mock.compile }))
beforeEach(() => mock.compile.mockReset())
function fixture(apiVersion: 7 | 10 = 10) {
  const source = `import {layoutText} from 'henji-layout/text'; export default {params:[{key:'text',type:'text',default:'标题'},{key:'font',type:'font',default:'sans-serif'}],draw(){layoutText(params.text.slice(0,10));}}`
  const resources = readStaticTextFonts(ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true), apiVersion)
  const bundle: CodeAuthorBundle = { code: 'throw new Error("预检不能执行作者模块")', map: '', locations: { layers: {} }, apiVersion, libraries: { 'henji-layout': '2.0.0' }, textEntry: 'main.js', textFonts: [{ file: 'main.js', ...resources }] }
  mock.compile.mockResolvedValue(bundle)
  const document = createVideoEditTestDocument('字体预检'), sequence = document.sequences[0]
  document.codeMaterials = [{ id: 'code', name: '代码', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion, languageVersion: 4, entry: 'main.js', files: [{ path: 'main.js', hash: 'a'.repeat(64), location: rememberTransientCodeSource('a'.repeat(64), source) }] }] }]
  document.items = [{ id: 'item', name: '文字', kind: 'code', code: { definitionId: 'code', versionId: 'v', parameters: {} } }]
  sequence.clips = [makeVideoEditItemClip(document, 'item', sequence.id, { frame: 0, duration: 100 }, () => ({ name: '文字', kind: 'generator', mode: 'dynamic', parameters: [], seed: 0 }))]
  return { document: videoEditComposition(document, sequence.id), bundle }
}
it('旧接口与真实非文字 bundle 不发送预检；文字热帧和非文字参数编辑同步通过', async () => {
  const send = vi.fn(async () => undefined), preflight = new VideoEditTextPreflight(send)
  const old = fixture(7)
  expect(preflight.prepare(old.document, 0, 1)).toBeUndefined()
  expect(mock.compile).not.toHaveBeenCalled()
  const current = fixture()
  current.bundle.libraries = { three: '0.186.1' }; current.bundle.textFonts = []
  await preflight.prepare(current.document, 0, 1)
  expect(send).not.toHaveBeenCalled()
  preflight.close()

  mock.compile.mockClear()
  const text = fixture(), ready = new VideoEditTextPreflight(send)
  await Promise.all([ready.prepare(text.document, 0, 1), ready.prepare(text.document, 1, 1)])
  expect(send).toHaveBeenCalledOnce()
  expect(ready.prepare(text.document, 2, 1)).toBeUndefined()
  text.document.clips[0].code!.parameters.offset = 30
  expect(ready.prepare(text.document, 3, 1)).toBeUndefined()
  text.document.clips[0].code!.parameters.text = '★✓①한𠀀'
  await ready.prepare(text.document, 4, 1)
  expect(send).toHaveBeenCalledTimes(2)
  await ready.prepare(text.document, 5, 2)
  expect(send).toHaveBeenCalledTimes(3)
  expect(mock.compile).toHaveBeenCalledOnce()
  ready.close()
})
it('后到帧共享未完成准备；关闭取消资源工作', async () => {
  const { document } = fixture()
  let finish!: () => void, signal!: AbortSignal
  const send = vi.fn((_requests: unknown, abort: AbortSignal) => { signal = abort; return new Promise<void>(resolve => { finish = resolve }) })
  const preflight = new VideoEditTextPreflight(send)
  const first = preflight.prepare(document, 0, 1)
  await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())
  const second = preflight.prepare(document, 1, 1)
  expect(signal.aborted).toBe(false)
  finish(); await Promise.all([first, second])
  expect(send).toHaveBeenCalledOnce()
  preflight.close(); expect(signal.aborted).toBe(true)
})

it('首次文字准备等待字体目录同步，失败可重试且热帧不再初始化', async () => {
  const { document } = fixture()
  let revision = 0, finish!: () => void
  const initialize = vi.fn(() => new Promise<void>(resolve => { finish = () => { revision = 1; resolve() } }))
  const send = vi.fn(async () => undefined).mockRejectedValueOnce(new Error('读取字体失败'))
  const preflight = new VideoEditTextPreflight(send, initialize)
  const pending = preflight.prepare(document, 0, () => revision)
  await vi.waitFor(() => expect(initialize).toHaveBeenCalledOnce())
  expect(send).not.toHaveBeenCalled()
  finish()
  await expect(pending).rejects.toThrow('读取字体失败')
  await preflight.prepare(document, 1, () => revision)
  expect(send).toHaveBeenCalledTimes(2)
  expect(preflight.prepare(document, 2, () => revision)).toBeUndefined()
  expect(initialize).toHaveBeenCalledOnce()
  preflight.close()
})

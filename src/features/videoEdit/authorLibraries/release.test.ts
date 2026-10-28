import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { assertNewFrozenAuthorRelease, readFrozenAuthorRelease, sha256, validateFrozenAuthorHistory } from '../../../../scripts/lib/frozenAuthorLibraries'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs() })

const directory = path.resolve('resources/video-edit-author/frozen/henji-layout/1.0.0')

function withProtectedRelease(run: (root: string, release: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-layout-history-'))
  if (fs.realpathSync(path.dirname(root)) !== fs.realpathSync(os.tmpdir())) throw new Error('临时目录不在预期位置。')
  const relative = 'resources/video-edit-author/frozen/henji-layout/1.0.0'
  const release = path.join(root, relative)
  const original = new Map(fs.readdirSync(directory).map(file => [`${relative}/${file}`, fs.readFileSync(path.join(directory, file))]))
  vi.stubEnv('HENJI_PERSISTENCE_RELEASE_REF', 'immutable-before-change')
  vi.mocked(execFileSync).mockImplementation((_command, args) => {
    if (args?.[0] === 'ls-tree') {
      if (args.includes('HEAD')) return ''
      expect(args).toContain('immutable-before-change')
      return [...original.keys()].join('\0') + '\0'
    }
    if (args?.[0] === 'show') {
      const key = String(args[1]).replace(/^immutable-before-change:/, '')
      const bytes = original.get(key)
      if (bytes) return bytes
    }
    throw new Error('非预期 Git 读取')
  })
  try { fs.mkdirSync(path.dirname(release), { recursive: true }); fs.cpSync(directory, release, { recursive: true }); run(root, release) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
}

it('发行产物摘要可验证，内容被改变时拒绝构建而非重新从源码生成', () => {
  const manifest = readFrozenAuthorRelease(directory, 'henji-layout', '1.0.0')
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-layout-release-'))
  if (fs.realpathSync(path.dirname(temporary)) !== fs.realpathSync(os.tmpdir())) throw new Error('临时目录不在预期位置。')
  try {
    fs.cpSync(directory, temporary, { recursive: true })
    fs.appendFileSync(path.join(temporary, 'text.mjs'), '\n// changed\n')
    expect(() => readFrozenAuthorRelease(temporary, 'henji-layout', '1.0.0')).toThrow('摘要不一致')
    expect(readFrozenAuthorRelease(directory, 'henji-layout', '1.0.0')).toEqual(manifest)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

it('已提交版本即使目录删除或内容重写仍禁止重冻；仅允许首次创建', () => {
  vi.stubEnv('HENJI_PERSISTENCE_RELEASE_REF', '')
  const relative = path.relative(process.cwd(), directory).split(path.sep).join('/')
  vi.mocked(execFileSync).mockReturnValue(`${relative}/release.json\n`)
  expect(() => assertNewFrozenAuthorRelease(process.cwd(), relative)).toThrow('已提交冻结产物')
  const missing = 'resources/video-edit-author/frozen/henji-layout/deleted-version'
  vi.mocked(execFileSync).mockReturnValue(`${missing}/release.json\n`)
  expect(() => assertNewFrozenAuthorRelease(process.cwd(), missing)).toThrow('已提交冻结产物')
  vi.mocked(execFileSync).mockReturnValue('')
  expect(() => assertNewFrozenAuthorRelease(process.cwd(), relative)).toThrow('已冻结')
  expect(() => assertNewFrozenAuthorRelease(process.cwd(), missing)).not.toThrow()
  expect(execFileSync).toHaveBeenLastCalledWith('git', ['ls-tree', '-r', '--name-only', 'HEAD', '--', missing], { cwd: process.cwd(), encoding: 'utf8' })
})

it('门禁校验不可变基准中的 release.json 自身，单改输入摘要也被拒绝', () => {
  withProtectedRelease((root, release) => {
    expect(() => validateFrozenAuthorHistory(root)).not.toThrow()
    const file = path.join(release, 'release.json')
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    manifest.inputs['invented.ts'] = '0'.repeat(64)
    fs.writeFileSync(file, JSON.stringify(manifest))
    expect(() => readFrozenAuthorRelease(release, 'henji-layout', '1.0.0')).not.toThrow()
    expect(() => validateFrozenAuthorHistory(root)).toThrow(/不得修改.*release\.json/)
  })
})

it('同步篡改产物与自报摘要不能绕过历史门禁', () => {
  withProtectedRelease((root, release) => {
    fs.appendFileSync(path.join(release, 'text.mjs'), '\n// rewritten\n')
    const file = path.join(release, 'release.json')
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    manifest.outputs['text.mjs'] = sha256(fs.readFileSync(path.join(release, 'text.mjs')))
    fs.writeFileSync(file, JSON.stringify(manifest))
    expect(() => readFrozenAuthorRelease(release, 'henji-layout', '1.0.0')).not.toThrow()
    expect(() => validateFrozenAuthorHistory(root)).toThrow('不得修改')
  })
})

it.each(['delete', 'add', 'delete-version'] as const)('基准版本的目录不能删除、增文件或整体消失：%s', mutation => {
  withProtectedRelease((root, release) => {
    if (mutation === 'delete') fs.unlinkSync(path.join(release, 'text.mjs'))
    if (mutation === 'add') fs.writeFileSync(path.join(release, 'extra.mjs'), '')
    if (mutation === 'delete-version') fs.rmSync(release, { recursive: true })
    expect(() => validateFrozenAuthorHistory(root)).toThrow(/不得删除|不得增加/)
    // 工作树和 HEAD 都可能已删除版本，CI 的不可变基准仍能阻止同名重冻。
    expect(() => assertNewFrozenAuthorRelease(root, 'resources/video-edit-author/frozen/henji-layout/1.0.0')).toThrow('已提交冻结产物')
  })
})

it('允许新增库版本，且本地未设置 CI 基准时使用 HEAD', () => {
  withProtectedRelease((root, release) => {
    const next = path.join(path.dirname(release), '1.1.0')
    fs.cpSync(release, next, { recursive: true })
    const file = path.join(next, 'release.json')
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    manifest.version = '1.1.0'
    fs.writeFileSync(file, JSON.stringify(manifest))
    expect(() => validateFrozenAuthorHistory(root)).not.toThrow()
    vi.stubEnv('HENJI_PERSISTENCE_RELEASE_REF', '')
    vi.mocked(execFileSync).mockReturnValue('')
    expect(() => validateFrozenAuthorHistory(root)).not.toThrow()
    expect(execFileSync).toHaveBeenLastCalledWith('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', 'resources/video-edit-author/frozen'], { cwd: root, encoding: 'utf8' })
  })
})

it('冻结文字入口无需 WASM；flex 导入等待异步初始化完成，Node Worker 可同步计算', async () => {
  const textUrl = pathToFileURL(path.join(directory, 'text.mjs')).href
  const flexUrl = pathToFileURL(path.join(directory, 'flex.mjs')).href
  const worker = new Worker(`const { parentPort } = require('node:worker_threads');
    (async () => {
      const wasm = globalThis.WebAssembly;
      globalThis.WebAssembly = undefined;
      const text = await import(${JSON.stringify(textUrl)});
      globalThis.WebAssembly = wasm;
      const flex = await import(${JSON.stringify(flexUrl)});
      globalThis.OffscreenCanvas = class { getContext() { return { save() {}, restore() {}, measureText(value) {
        const width = [...value].length * 7.1;
        return { width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 3, fontBoundingBoxAscent: 8, fontBoundingBoxDescent: 3 };
      } }; } };
      const precision = [];
      for (const padding of [0, 16, 100, 1000]) for (const content of ['abcd', 'ab\\ncd\\nef']) {
        const style = { fontSize: 10, leading: 13.1 };
        const natural = text.layoutText(content, style).contentSize;
        for (const box of [{ padding }, { padding, width: natural.width + padding * 2, height: natural.height + padding * 2 }]) {
          const title = flex.layoutBoxes({ id: 'root', style: { flexDirection: 'column', alignItems: 'start' }, children: [{ id: 'title', style: box, text: { content, style } }] }, { width: 3000, height: 3000 }).title.text;
          precision.push({ content, lines: title.lines.map(line => line.text), truncated: title.truncated });
        }
      }
      parentPort.postMessage({ text: Object.keys(text), flex: Object.keys(flex), precision, boxes: flex.layoutBoxes({ id: 'root', style: { gap: 10, padding: 10 }, children: [{ id: 'a', style: { width: 40 } }, { id: 'b', style: { flexGrow: 1 } }] }, { width: 200, height: 100 }) });
    })().catch(error => { throw error; });`, { eval: true })
  try {
    const result = await new Promise<{ text: string[]; flex: string[]; precision: Array<{ content: string; lines: string[]; truncated: boolean }>; boxes: Record<string, { x: number; width: number; height: number }> }>((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject) })
    expect(result.text.sort()).toEqual(['drawText', 'layoutText'])
    expect(result.flex).toEqual(['layoutBoxes'])
    expect(result.boxes.b).toMatchObject({ x: 60, width: 130, height: 80 })
    for (const sample of result.precision) {
      expect(sample.lines).toEqual(sample.content.split('\n'))
      expect(sample.truncated).toBe(false)
    }
  } finally { await worker.terminate() }
})

// @vitest-environment jsdom
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { BOX_TRACK_FILE, boxSampleEveryFrames, boxSampleScript, BoxTrackWriter, type BoxSample } from './boxTrack'

// 主进程工程不引入全局 DOM lib；仅描述这个 jsdom 测试使用的浏览器边界。
interface TestElement {
  removeAttribute(name: string): void
  getBoundingClientRect(): { x: number; y: number; left: number; top: number; width: number; height: number; right: number; bottom: number; toJSON(): object }
}
const { window } = globalThis as unknown as { window: {
  innerWidth: number; innerHeight: number; eval(source: string): unknown
  document: { body: { innerHTML: string }; querySelector(selector: string): TestElement | null; querySelectorAll(selector: string): TestElement[] }
} }
const { document } = window

let root = ''
afterEach(async () => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  if (root) await fs.rm(root, { recursive: true, force: true })
  root = ''
})

function sample(selectors: string[] = []): BoxSample { return window.eval(boxSampleScript(selectors)) as BoxSample }
function rect(el: TestElement, x = 10.25, y = 20.5, width = 100.125, height = 30.25): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) })
}

it('键优先 replay-id、act 同名序号、选择器序号；重叠去重，序号包含隐藏项并保留小数', () => {
  document.body.innerHTML = '<div data-replay-id="node-a" data-act="open" class="ask"></div><div data-act="open" hidden></div><div data-act="open"></div><div class="ask" hidden></div><div class="ask"></div>'
  document.querySelectorAll('div').forEach(el => rect(el))
  const snapshot = sample(['.ask', 'div'])
  expect(snapshot.width).toBe(window.innerWidth)
  expect(snapshot.height).toBe(window.innerHeight)
  expect(snapshot.items.map(item => item[0])).toEqual(['node-a', 'act:open#2', '.ask#2'])
  expect(snapshot.items[0].slice(1)).toEqual([10.25, 20.5, 100.125, 30.25])
  document.querySelector('[hidden]')?.removeAttribute('hidden')
  expect(sample(['.ask']).items.map(item => item[0])).toEqual(['node-a', 'act:open#1', 'act:open#2', '.ask#2'])
})

it('过滤自身及祖先隐藏、透明、零尺寸、视口外；保留部分入画和淡入元素', () => {
  document.body.innerHTML = '<div style="opacity:0"><i data-replay-id="parent-hidden"></i></div><div style="display:none"><i data-replay-id="parent-none"></i></div><i data-replay-id="hidden" style="visibility:hidden"></i><i data-replay-id="collapse" style="visibility:collapse"></i><i data-replay-id="zero"></i><i data-replay-id="left"></i><i data-replay-id="right"></i><i data-replay-id="top"></i><i data-replay-id="bottom"></i><i data-replay-id="partial"></i><i data-replay-id="fade" style="opacity:0.01"></i>'
  document.querySelectorAll('i').forEach(el => rect(el))
  const at = (key: string): TestElement => document.querySelector(`[data-replay-id="${key}"]`)!
  rect(at('zero'), 0, 0, 0, 10)
  rect(at('left'), -20, 0, 20, 20)
  rect(at('right'), window.innerWidth, 0)
  rect(at('top'), 0, -30, 20, 30)
  rect(at('bottom'), 0, window.innerHeight)
  rect(at('partial'), -10, -5, 30, 20)
  expect(sample().items.map(item => item[0])).toEqual(['partial', 'fade'])
})

it('无效选择器与超额明确失败，不静默丢轨', () => {
  expect(() => boxSampleScript(Array.from({ length: 33 }, () => '.ask'))).toThrow('32')
  expect(() => boxSampleScript([' '])).toThrow('非空')
  expect(() => sample(['['])).toThrow('CSS 选择器无效')
})

it('同一个 data-replay-id 同时出现几处时按文档顺序加序号，不让重演失败', () => {
  document.body.innerHTML = '<i data-replay-id="history-1"></i><i data-replay-id="history-1"></i><i data-replay-id="history-1"></i>'
  document.querySelectorAll('i').forEach(el => rect(el))
  expect(sample().items.map(item => item[0])).toEqual(['history-1', 'history-1#1', 'history-1#2'])
})

it('每两帧采实时档，timeScale >= 2 每帧采', () => {
  expect([1, 1.5, 2, 3].map(boxSampleEveryFrames)).toEqual([2, 2, 1, 1])
})

it('只在位置或视口变化时写入；结束补空白，完成前保留原轨', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-boxes-'))
  const file = path.join(root, BOX_TRACK_FILE)
  await fs.writeFile(file, 'original')
  const writer = new BoxTrackWriter(file)
  const screen: BoxSample = { width: 1000, height: 500, items: [['node-a', 10.25, 20, 100, 30]] }
  await writer.write(0, screen)
  await writer.write(33_333, screen)
  await writer.write(66_667, { ...screen, items: [['node-a', 10.5, 20, 100, 30]] })
  await writer.write(100_000, { ...screen, width: 2000 })
  expect(await fs.readFile(file, 'utf8')).toBe('original')
  await writer.close(133_333)
  const lines = (await fs.readFile(file, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { t: number })
  expect(lines.map(line => line.t)).toEqual([0, 66_667, 100_000, 133_333])
  expect(lines.at(-1)).toEqual({ t: 133_333, width: 0, height: 0, items: [] })
  expect(await fs.readdir(root)).toEqual([BOX_TRACK_FILE])
})

it('取消与文件写入失败不会覆盖已有完整轨，也不会留下暂存文件', async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-boxes-'))
  const file = path.join(root, BOX_TRACK_FILE)
  await fs.writeFile(file, 'original')
  const writer = new BoxTrackWriter(file)
  await writer.write(0, { width: 100, height: 100, items: [] })
  await writer.abort()
  expect(await fs.readFile(file, 'utf8')).toBe('original')
  expect(await fs.readdir(root)).toEqual([BOX_TRACK_FILE])
  const broken = new BoxTrackWriter(path.join(root, 'missing', BOX_TRACK_FILE))
  await expect(broken.write(0, { width: 1, height: 1, items: [] })).rejects.toMatchObject({ code: 'ENOENT' })
  await broken.abort()
})

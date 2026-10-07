// @vitest-environment node
// scripts/lib/testSuites.cjs 的 src/**/*.test.{ts,tsx} 自动纳入 unit 套件。
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import type { CodeDrawCommand, CodeTextMeasurer } from './contract'
import { evaluateCodeMaterial } from './evaluate'
import { layoutCodeText } from './textLayout'

const skillRoot = path.resolve('resources/assistant-skills/video-edit-code-creation')
function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name)
    return entry.isDirectory() ? markdownFiles(filename) : entry.name.endsWith('.md') ? [filename] : []
  }).sort()
}
const files = markdownFiles(skillRoot)
const sources = files.flatMap(filename => [...readFileSync(filename, 'utf8').matchAll(/^```ts\s*\r?\n([\s\S]*?)^```\s*$/gm)]
  .map((match, index) => ({ name: `${path.relative(skillRoot, filename)} #${index + 1}`, source: match[1] })))

// Node 无原生字库：只替换宿主字形 advance，保留正式布局、编译器和求值器。
const measureText: CodeTextMeasurer = request => layoutCodeText(request, (value, font) => {
  const size = Number(font.match(/([\d.]+)px/)?.[1])
  return Array.from(value).reduce((width, character) => width + (/\p{Script=Latin}|\s/u.test(character) ? .6 : 1) * size, 0)
})
function assertFinite(value: unknown): void {
  if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true)
  else if (Array.isArray(value)) value.forEach(assertFinite)
  else if (value && typeof value === 'object') Object.values(value).forEach(assertFinite)
}
function flatten(draws: CodeDrawCommand[]): CodeDrawCommand[] {
  return draws.flatMap(draw => draw.kind === 'group' ? [draw, ...flatten(draw.children)] : [draw])
}
function render(source: string, seconds: number, parameters: Record<string, unknown> = {}): CodeDrawCommand[] {
  const program = compileCodeMaterial(source)
  return evaluateCodeMaterial(program, { time: seconds, localTime: seconds, sequenceTime: 4 + seconds,
    width: program.width, height: program.height, frame: Math.round((4 + seconds) * 30), fps: 30 }, parameters, { measureText })
}

describe('剪辑创作 skill 的 Markdown 源码使用真实 v3 编译与求值', () => {
  it('扫描全部参考，禁止用片段围栏或删除全部样例绕过验证', () => {
    expect(sources.length).toBeGreaterThanOrEqual(6)
    expect(sources.filter(item => item.name.startsWith(`references${path.sep}examples.md`))).toHaveLength(4)
    for (const item of sources) expect(item.source, item.name).toContain('export default')
  })

  it.each(sources)('$name 在进场、停留和结束时可求值且随机寻帧确定', ({ source }) => {
    const program = compileCodeMaterial(source)
    expect(program.languageVersion).toBe(3)
    expect(program.kind).toBe('generator')
    for (const seconds of [0, .25, program.durationSeconds / 2, program.durationSeconds - 1 / 30]) {
      const context = { time: seconds, localTime: seconds, sequenceTime: 4 + seconds,
        width: program.width, height: program.height, frame: Math.round((4 + seconds) * 30), fps: 30 }
      const commands = evaluateCodeMaterial(program, context, {}, { measureText })
      expect(commands.length).toBeGreaterThan(0)
      expect(evaluateCodeMaterial(structuredClone(program), context, {}, { measureText })).toEqual(commands)
      assertFinite(commands)
      for (const command of flatten(commands)) {
        expect(command.elementId).toBeTruthy()
        expect(command.sourceSpan).toBeDefined()
        expect(source.slice(command.sourceSpan!.start, command.sourceSpan!.end)).toMatch(/(?:rect|ellipse|line|path|group|text|image|shader)\(/)
      }
    }
  })

  const examples = readFileSync(path.join(skillRoot, 'references/examples.md'), 'utf8')
  const sections = [...examples.matchAll(/<!-- skill-example: ([\w-]+) -->\r?\n```ts\r?\n([\s\S]*?)```([\s\S]*?)(?=\n## |$)/g)]
    .map(match => ({ name: match[1], source: match[2], rest: match[3] }))
  it.each(sections)('$name 的插入和调参字典都可用于正式参数求值', ({ source, rest }) => {
    const dictionaries = [...rest.matchAll(/```json\r?\n([\s\S]*?)```/g)].map(block => {
      const payload = JSON.parse(block[1]) as { changes: Array<{ properties?: Record<string, unknown>; items?: Array<{ properties: Record<string, unknown> }> }> }
      const properties = payload.changes[0].properties ?? payload.changes[0].items![0].properties
      return properties['video_edit.clip.code_parameters'] as Record<string, unknown>
    })
    expect(dictionaries).toHaveLength(2)
    for (const parameters of dictionaries) for (const seconds of [0, .25, 2]) assertFinite(render(source, seconds, parameters))
  })

  it('四例的设计语义成立：量字底板、字符错峰、极光图层、数值终点', () => {
    expect(sections.map(item => item.name)).toEqual(['lower-third', 'stagger-title', 'aurora-chapter', 'rolling-data'])
    const plate = (title: string) => flatten(render(sections[0].source, 2, { title })).find(draw => draw.elementId === 'plate')
    const short = plate('出发'); const long = plate('第一章 出发')
    expect(short?.kind === 'rect' && long?.kind === 'rect' && long.width > short.width).toBe(true)
    const headline = flatten(render(sections[1].source, .25)).find(draw => draw.elementId === 'headline')
    expect(headline?.kind === 'text' && headline.perChar![0].opacity > headline.perChar![5].opacity).toBe(true)
    expect(render(sections[2].source, 2)[0]).toMatchObject({ kind: 'shader', name: 'aurora', time: 2 })
    const number = (seconds: number) => flatten(render(sections[3].source, seconds))
      .filter(draw => draw.kind === 'text' && draw.elementId?.startsWith('digit') && draw.opacity === 1)
      .map(draw => draw.kind === 'text' ? draw.text : '').join('')
    expect(number(0)).toBe('0')
    expect(number(2)).toBe('1280')
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './compiler'
import { evaluateCodeMaterialV3 } from './evaluateV3'
import { evaluateCodeMaterialV3 as reference } from './__fixtures__/evaluateV3.reference'
import { layoutCodeText } from './textLayout'
import type { CodeMaterialContext, CodeTextMeasurer } from './contract'
import { codeExecutionCache } from './executionCache'
import { validateCodeMaterialParameters } from './parameters'

const measureText: CodeTextMeasurer = request => layoutCodeText(request, text => Array.from(text).length * request.fontSize * .6)
const context = (frame: number): CodeMaterialContext => ({ time: frame / 30, localTime: frame / 30, sequenceTime: frame / 30, frame, fps: 30, width: 1920, height: 1080 })
const fixtures = ['complex-to-simple', 'variety-title', 'tech-title']

describe('作者语言执行计划：原解释器对照与 Node 基准', () => {
  it.each(fixtures)('%s 多帧、多参数输出严格相等（数值容差 0）', name => {
    const source = readFileSync(`src/tests/fixtures/videoEdit/performance/${name}.ts.txt`, 'utf8')
    const program = compileCodeMaterial(source)
    const original = structuredClone(program)
    for (const values of [{}, { title: '新标题', subtitle: '测试' }, {}]) {
      for (const frame of [0, 8, 30, 60, 110, 150, 0]) {
        expect(evaluateCodeMaterialV3(program, context(frame), values, { measureText }))
          .toStrictEqual(reference(original, context(frame), values, { measureText }))
      }
    }
  })

  it.runIf(process.env.HENJI_CODE_BENCHMARK === '1')('三份素材：50 帧预热、150 帧采样，中位数与 p95', () => {
    for (const name of fixtures) {
      const source = readFileSync(`src/tests/fixtures/videoEdit/performance/${name}.ts.txt`, 'utf8')
      const rows: Record<string, { median: number; p95: number; cacheSlots?: number }> = {}
      for (const [label, evaluate] of [['before', reference], ['after', evaluateCodeMaterialV3]] as const) {
        const program = compileCodeMaterial(source)
        for (let frame = 0; frame < 50; frame++) evaluate(program, context(frame), {}, { measureText })
        const samples: number[] = []
        for (let frame = 0; frame < 150; frame++) {
          const started = performance.now()
          evaluate(program, context(frame), {}, { measureText })
          samples.push(performance.now() - started)
        }
        samples.sort((a, b) => a - b)
        rows[label] = { median: (samples[74] + samples[75]) / 2, p95: samples[142] }
        if (label === 'after') rows[label].cacheSlots = codeExecutionCache(program, validateCodeMaterialParameters(program, {}), context(0)).size
      }
      process.stdout.write(`${name} ${JSON.stringify(rows)}\n`)
    }
  }, 60_000)
})

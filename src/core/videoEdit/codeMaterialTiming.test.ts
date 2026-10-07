import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from './time'
import { describe, expect, it } from 'vitest'
import { compileCodeMaterial } from './codeMaterial/compiler'
import { CodeMaterialError } from './codeMaterial/contract'
import { evaluateCodeMaterial } from './codeMaterial/evaluate'
import { codeMaterialContextForFrame, codeMaterialContextForTransitionFrame } from './codeMaterialTiming'
import type { CodeMaterialTimedClip } from './codeMaterialTiming'
import { offsetVideoEditSource } from './time'

const program = compileCodeMaterial('export default {apiVersion:1,name:"源时钟图形",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:90,seed:42,parameters:{},render(ctx){return [rect({x:ctx.time*20,y:100,width:200,height:80,fill:[.2,.5,1,.6]})];}}')
const base: CodeMaterialTimedClip = { start: 11, duration: 2000, sourceInUs: 1234567, sourceRemainder: { numerator: 1, denominator: 3 } }
const rates = [{ numerator: 30000, denominator: 1001 }, { numerator: 60000, denominator: 1001 }]

describe('真实转场余量保持原片段时钟', () => {
  it('右侧提前采样保留负局部时间，普通求值仍拒绝片段外帧及未授权负时间', () => {
    const right = { start: 60, duration: 60, sourceInUs: 1_000_000, sourceRemainder: { numerator: 0, denominator: 1 } }
    const rate = { numerator: 60, denominator: 1 }; const window = { start: 45, end: 75 }
    const moving = compileCodeMaterial('export default {apiVersion:1,name:"原局部时钟",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:0,parameters:{},render(ctx){return [rect({x:ctx.localTime*100,y:0,width:100,height:100,fill:[1,0,0,1]})];}}')
    const before = codeMaterialContextForTransitionFrame(right, 45, rate, moving, window)
    expect(before).toMatchObject({ time: .75, localTime: -.25, sequenceTime: .75, frame: 45 })
    expect(() => codeMaterialContextForFrame(right, 45, rate, moving)).toThrow('片段内部')
    expect(() => evaluateCodeMaterial(moving, before)).toThrow('时间')
    expect(evaluateCodeMaterial(moving, before, {}, { transitionHandles: true })[0]).toMatchObject({ x: -25 })
    for (const frame of [60, 74]) expect(codeMaterialContextForTransitionFrame(right, frame, rate, moving, window)).toEqual(codeMaterialContextForFrame(right, frame, rate, moving))
    for (const frame of [44, 75]) expect(() => codeMaterialContextForTransitionFrame(right, frame, rate, moving, window)).toThrow('转场')
    expect(() => codeMaterialContextForTransitionFrame({ ...right, sourceInUs: 0 }, 45, rate, moving, window)).toThrow('源入点')
    expect(() => evaluateCodeMaterial(moving, { ...before, localTime: -VIDEO_EDIT_MAX_SEQUENCE_SECONDS - 1 }, {}, { transitionHandles: true })).toThrow('时间')
  })
  it('静态源零之前保持源首点，NTSC余量和真实时长仍精确验证', () => {
    const clip = { start: 60, duration: 60, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
    const rate = { numerator: 60000, denominator: 1001 }; const window = { start: 45, end: 75 }
    const fixed = { ...program, mode: 'static' as const }
    const held = codeMaterialContextForTransitionFrame(clip, 45, rate, fixed, window)
    expect(held.time).toBe(0)
    expect(held.localTime).toBe(-15 / (rate.numerator / rate.denominator))
    const sourced = { ...clip, sourceInUs: 1_000_000, sourceRemainder: { numerator: 1, denominator: 3 } }
    const expected = offsetVideoEditSource(sourced, -15, rate)
    expect(codeMaterialContextForTransitionFrame(sourced, 45, rate, program, window).time).toBe((expected.sourceInUs + expected.sourceRemainder.numerator / expected.sourceRemainder.denominator) / 1e6)
    expect(() => codeMaterialContextForTransitionFrame(sourced, 74, rate, { ...program, durationSeconds: 1.2 }, window)).toThrow('声明时长')
    for (const bad of [{ start: -1, end: 75 }, { start: 45.5, end: 75 }, { start: 45, end: 45 }, { start: 45, end: Number.POSITIVE_INFINITY }]) expect(() => codeMaterialContextForTransitionFrame(sourced, 60, rate, program, bad)).toThrow()
  })
})

describe('连续源时间的统一映射', () => {
  it('NTSC多次裁剪与拆分后，同一序列帧的源时间和图形完全一致', () => {
    for (const rate of rates) {
      const frame = 1500
      const expected = codeMaterialContextForFrame(base, frame, rate, program)
      let trimmed = structuredClone(base)
      for (let index = 0; index < 600; index++) trimmed = { ...trimmed, ...offsetVideoEditSource(trimmed, 1, rate), start: trimmed.start + 1, duration: trimmed.duration - 1 }
      const afterTrim = codeMaterialContextForFrame(trimmed, frame, rate, program)
      expect(afterTrim.time).toBe(expected.time)
      expect(afterTrim.frame).toBe(frame)
      expect(afterTrim.sequenceTime).toBe(expected.sequenceTime)
      expect(evaluateCodeMaterial(program, afterTrim)).toEqual(evaluateCodeMaterial(program, expected))
      let tail = structuredClone(base)
      for (const splitFrame of [250, 610, 900, 1200]) tail = { ...tail, ...offsetVideoEditSource(tail, splitFrame - tail.start, rate), duration: tail.start + tail.duration - splitFrame, start: splitFrame }
      const afterSplits = codeMaterialContextForFrame(tail, frame, rate, program)
      expect(afterSplits.time).toBe(expected.time)
      expect(evaluateCodeMaterial(program, afterSplits)).toEqual(evaluateCodeMaterial(program, expected))
      expect(afterSplits.localTime).toBe((frame - tail.start) / afterSplits.fps)
    }
  })
  it('乱序求值无状态，移动片段保持连续源时间与局部时间', () => {
    const rate = rates[0]
    const frames = [1000, 15, 1500, 400]
    const expected = new Map(frames.map(frame => [frame, codeMaterialContextForFrame(base, frame, rate, program)]))
    for (const frame of [400, 1500, 15, 1000, 400]) expect(codeMaterialContextForFrame(base, frame, rate, program)).toEqual(expected.get(frame))
    const original = codeMaterialContextForFrame(base, 400, rate, program)
    const moved = codeMaterialContextForFrame({ ...base, start: base.start + 300 }, 700, rate, program)
    expect(moved.time).toBe(original.time)
    expect(moved.localTime).toBe(original.localTime)
    expect(moved.frame).toBe(700)
    expect(moved.sequenceTime).toBe(700 / moved.fps)
    expect(evaluateCodeMaterial(program, moved)).toEqual(evaluateCodeMaterial(program, original))
    expect(moved).toMatchObject({ width: 3840, height: 2160 })
    expect('seed' in moved).toBe(false)
  })
  it('静态素材可延长，动态素材仅允许浮点转换误差而不追加一帧', () => {
    const clip: CodeMaterialTimedClip = { start: 10, duration: 400, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 } }
    const rate = { numerator: 60, denominator: 1 }
    const declared = { width: 3840, height: 2160, durationSeconds: 1, mode: 'dynamic' as const }
    expect(codeMaterialContextForFrame(clip, 70, rate, declared).time).toBe(1)
    expect(() => codeMaterialContextForFrame(clip, 71, rate, declared)).toThrow('声明时长')
    const oneMicrosecondLate = { ...clip, sourceInUs: 1_000_001 }
    expect(() => codeMaterialContextForFrame(oneMicrosecondLate, 10, rate, declared)).toThrow('声明时长')
    const declaredRounded = { ...declared, durationSeconds: 1 - Number.EPSILON }
    expect(codeMaterialContextForFrame(clip, 70, rate, declaredRounded).time).toBe(1)
    expect(() => codeMaterialContextForFrame(clip, 70, rate, { ...declared, durationSeconds: 1 - 8 * Number.EPSILON })).toThrow('声明时长')
    expect(codeMaterialContextForFrame(clip, 300, rate, { ...declared, mode: 'static' }).time).toBe(290 / 60)
  })
})

describe('片段与时钟输入边界', () => {
  it('片段结束为排他边界，拒绝负数、小数、非有限与不安全帧', () => {
    const rate = rates[0]
    expect(codeMaterialContextForFrame(base, base.start, rate, program).localTime).toBe(0)
    expect(codeMaterialContextForFrame(base, base.start + base.duration - 1, rate, program).frame).toBe(base.start + base.duration - 1)
    for (const frame of [-1, .5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, base.start - 1, base.start + base.duration]) expect(() => codeMaterialContextForFrame(base, frame, rate, program)).toThrow(CodeMaterialError)
    for (const clip of [{ ...base, start: -1 }, { ...base, duration: 0 }, { ...base, duration: .5 }, { ...base, start: Number.MAX_SAFE_INTEGER, duration: 2 }]) expect(() => codeMaterialContextForFrame(clip, clip.start, rate, program)).toThrow(CodeMaterialError)
  })
  it('拒绝无效比例、源余数、尺寸及声明时长', () => {
    for (const rate of [{ numerator: 0, denominator: 1 }, { numerator: 30, denominator: 0 }, { numerator: .5, denominator: 1 }, { numerator: Number.POSITIVE_INFINITY, denominator: 1 }, { numerator: 241, denominator: 1 }, { numerator: 1_000_001, denominator: 1 }]) expect(() => codeMaterialContextForFrame(base, base.start, rate, program)).toThrow(CodeMaterialError)
    for (const clip of [{ ...base, sourceInUs: -1 }, { ...base, sourceInUs: .1 }, { ...base, sourceRemainder: { numerator: -1, denominator: 3 } }, { ...base, sourceRemainder: { numerator: 3, denominator: 3 } }, { ...base, sourceRemainder: { numerator: 0, denominator: 0 } }, { ...base, sourceRemainder: { numerator: 1, denominator: 1.5 } }, { ...base, sourceRemainder: { numerator: 1, denominator: 1_000_001 } }]) expect(() => codeMaterialContextForFrame(clip, base.start, rates[0], program)).toThrow(CodeMaterialError)
    for (const definition of [{ ...program, width: 0 }, { ...program, height: 8193 }, { ...program, durationSeconds: 0 }, { ...program, durationSeconds: Number.NaN }, { ...program, durationSeconds: VIDEO_EDIT_MAX_SEQUENCE_SECONDS + 1 }]) expect(() => codeMaterialContextForFrame(base, base.start, rates[0], definition)).toThrow(CodeMaterialError)
  })
})

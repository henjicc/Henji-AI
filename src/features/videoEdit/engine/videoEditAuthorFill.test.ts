import { describe, expect, it } from 'vitest'
import { CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, CODE_AUTHOR_FILL_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { authorFillLayer, isAuthorAnalyticLayer } from './videoEditAuthorFill'
import { deterministicAuthorModule } from './videoEditAuthorDeterminism'
import type { AuthorLayer } from './videoEditAuthorModule'

const gradient = { id: 'gradient', params: { mode: 'radial' } }

describe('作者图层画面来源 fill', () => {
  it('旧接口里同名字段仍是作者数据：原对象原样返回，draw 照常', () => {
    const layer: AuthorLayer = { id: 'old', fill: 'author-data', draw: () => {} }
    expect(authorFillLayer(layer, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION, 100, 50)).toBe(layer)
    // 作者自己写的同名字段不算宿主标记。
    expect(isAuthorAnalyticLayer({ ...layer, analytic: true } as AuthorLayer)).toBe(false)
  })
  it('换成铺满 bounds 的一层，生成器排在作者效果之前；没给 bounds 时铺满画布', () => {
    const own = { id: 'blur', params: { amount: 10 } } as const
    const converted = authorFillLayer({ id: 'bg', bounds: [10, 20, 60, 40], fill: () => gradient, effects: () => [own] }, CODE_AUTHOR_FILL_MIN_API_VERSION, 100, 50)
    expect(converted.fill).toBeUndefined()
    expect(isAuthorAnalyticLayer({ ...converted })).toBe(true)
    expect(converted.bounds).toEqual([10, 20, 60, 40])
    expect(converted.effects!(0)).toEqual([gradient, own])
    const painted: unknown[] = []
    converted.draw!({ set fillStyle(value: unknown) { painted.push(value) }, fillRect: (...rect: number[]) => painted.push(rect) } as unknown as OffscreenCanvasRenderingContext2D, 0)
    expect(painted.at(-1)).toEqual([10, 20, 50, 20])
    expect(authorFillLayer({ fill: () => gradient }, CODE_AUTHOR_FILL_MIN_API_VERSION, 100, 50).bounds).toEqual([0, 0, 100, 50])
  })
  it('写法不对时指出原因：与 draw、adjust 同时出现，不是函数，返回的不是原生生成器', () => {
    expect(() => authorFillLayer({ fill: () => gradient, draw: () => {} }, CODE_AUTHOR_FILL_MIN_API_VERSION, 1, 1)).toThrow('fill 与 draw 二选一')
    expect(() => authorFillLayer({ id: 'a', fill: () => gradient, adjust: () => [] }, CODE_AUTHOR_FILL_MIN_API_VERSION, 1, 1)).toThrow('互斥')
    expect(() => authorFillLayer({ fill: gradient }, CODE_AUTHOR_FILL_MIN_API_VERSION, 1, 1)).toThrow('fill 必须是函数')
    const blur = authorFillLayer({ fill: () => ({ id: 'blur' }) }, CODE_AUTHOR_FILL_MIN_API_VERSION, 1, 1)
    expect(() => blur.effects!(0)).toThrow('只接受原生生成器')
    const wrapped = authorFillLayer({ fill: () => ({ id: 'noise' }) }, CODE_AUTHOR_FILL_MIN_API_VERSION, 1, 1)
    expect(() => wrapped.effects!(0)).toThrow('只接受原生生成器')
  })
  it('确定性包装按作者接口版本转换 layers() 返回的图层，fill 在同一时刻得到同一描述', () => {
    const module = deterministicAuthorModule({ name: '背景', layers: () => [{ id: 'bg', fill: (t: number) => ({ id: 'gradient', params: { start_y: Math.round(Math.random() * 100) + t } }) }] }, CODE_AUTHOR_FILL_MIN_API_VERSION)
    const [layer] = module.layers!({}, 320, 180, {}, { time: 1, frameDuration: 1 / 30, clip: { time: 1, duration: 2 } })
    expect(layer.bounds).toEqual([0, 0, 320, 180])
    expect(layer.effects!(1)).toEqual(layer.effects!(1))
  })
})

import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { parseSeedreamLayerStack } from '../../src/structured-output'
import type { JsonValue } from '../../src/types/runtime'

function fixture(name: string): JsonValue {
  const filePath = fileURLToPath(new URL(`../fixtures/structured-output/${name}`, import.meta.url))
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonValue
}

describe('Seedream 图层结构化输出', () => {
  it.each([
    ['volcengine', 'seedream-volcengine-layers.json'],
    ['apimart', 'seedream-apimart-layers.json'],
    ['kie', 'seedream-kie-layers.json'],
  ] as const)('%s 官方结构映射为同一 layer-stack V1', (provider, name) => {
    const result = parseSeedreamLayerStack(provider, fixture(name))
    expect(result).toMatchObject({
      version: 1,
      kind: 'layer-stack',
      primary: { zIndex: 0, role: 'base', sourceOutputIndex: 0 },
      metadata: { colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over' },
    })
    expect(result.outputs.map((layer) => [layer.zIndex, layer.role, layer.format])).toEqual([
      [0, 'base', 'jpeg'],
      [1, 'content', 'png'],
    ])
  })

  it('KIE Seedream 5.5 的 resultJson 多带 resultUrls，图层仍从 layers_data 读取', () => {
    const result = parseSeedreamLayerStack('kie', fixture('seedream55-kie-layers.json'))
    expect(result.outputs.map((layer) => [layer.sourceOutputIndex, layer.zIndex, layer.role, layer.format, layer.url])).toEqual([
      [0, 0, 'base', 'png', 'https://fixtures.invalid/base.png'],
      [1, 1, 'content', 'png', 'https://fixtures.invalid/title.png'],
      [2, 2, 'content', 'png', 'https://fixtures.invalid/parrot.png'],
    ])
    expect(result.outputs[2]).toMatchObject({ width: 823, height: 1275, boundingBox: { normalized: [230, 181, 758, 1000] } })
  })

  it('Fal 从 layers[].image 读地址、尺寸与格式，下标对应 images 的落盘顺序', () => {
    const result = parseSeedreamLayerStack('fal', fixture('seedream-fal-layers.json'))
    expect(result.outputs.map((layer) => [layer.sourceOutputIndex, layer.zIndex, layer.role, layer.format, layer.width, layer.height])).toEqual([
      [0, 0, 'base', 'png', 1024, 1024],
      [1, 1, 'content', 'png', 670, 139],
    ])
    expect(result.outputs[1]).toMatchObject({ url: 'https://fixtures.invalid/title.png', name: '标题文字', boundingBox: { normalized: [187, 58, 806, 186] } })
    expect(() => parseSeedreamLayerStack('fal', { layers: [{ image: { url: 'https://fixtures.invalid/a.png', content_type: 'image/png' }, z_index: 0 }] })).toThrow(/size 缺失/)
  })

  it('拒绝空输出、18 层、重复/越界/不连续 z、缺底图和内容层非 PNG', () => {
    const valid = fixture('seedream-volcengine-layers.json') as Record<string, unknown>
    const data = valid.data as Array<Record<string, unknown>>
    const parse = (layers: Array<Record<string, unknown>>) => parseSeedreamLayerStack('volcengine', {
      data: layers as JsonValue,
    })
    expect(() => parse([])).toThrow(/1\.\.17/)
    expect(() => parse(Array.from({ length: 18 }, (_, index) => ({ ...data[0], z_index: index })))).toThrow(/1\.\.17/)
    expect(() => parse([{ ...data[0] }, { ...data[1], z_index: 0 }])).toThrow(/重复/)
    expect(() => parse([{ ...data[0], z_index: 17 }])).toThrow(/无效/)
    expect(() => parse([{ ...data[1], z_index: 1 }])).toThrow(/缺少/)
    expect(() => parse([{ ...data[0] }, { ...data[1], z_index: 2 }])).toThrow(/连续/)
    expect(() => parse([{ ...data[0] }, { ...data[1], output_format: 'jpeg' }])).toThrow(/必须为 PNG/)
  })

  it('拒绝 APIMart 平行数组错位、KIE 非法 resultJson 与 bbox 越界', () => {
    const apiMart = fixture('seedream-apimart-layers.json') as Record<string, unknown>
    const apiData = apiMart.data as Record<string, unknown>
    const apiResult = apiData.result as Record<string, unknown>
    const apiImages = apiResult.images as Array<Record<string, unknown>>
    expect(() => parseSeedreamLayerStack('apimart', {
      data: { result: { images: [{ ...apiImages[0], sizes: ['2048x2048'] }] } },
    })).toThrow(/长度不一致/)
    expect(() => parseSeedreamLayerStack('kie', { data: { resultJson: '{' } })).toThrow(/合法 JSON/)
    const volc = fixture('seedream-volcengine-layers.json') as Record<string, unknown>
    const layers = volc.data as Array<Record<string, unknown>>
    expect(() => parseSeedreamLayerStack('volcengine', {
      data: [layers[0], {
        ...layers[1],
        bounding_box: { absolute: [0, 0, 10, 10], normalized: [0, 0, 1001, 10] },
      }] as JsonValue,
    })).toThrow(/0\.\.1000/)
  })
})

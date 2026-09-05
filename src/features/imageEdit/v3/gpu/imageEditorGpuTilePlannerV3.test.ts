import { describe, expect, it } from 'vitest'

import { createDefaultImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { createImageEditorGpuPyramidDescriptorV3, planImageEditorGpuRasterTilesV3 } from './imageEditorGpuTilePlannerV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'

const RESOURCE = `sha256:${'a'.repeat(64)}` as const

function scene(): Pick<ImageEditorGpuRasterSceneV3, 'width' | 'height' | 'color' | 'geometry' | 'layers'> {
  return {
    width: 8_192,
    height: 8_192,
    geometry: {
      width: 8_192, height: 8_192, crop: null,
      orientation: { rotate: 0, mirrored: false },
    },
    color: createDefaultImageEditColorModeV3(),
    layers: [{
      layerId: 'large', sourceKind: 'raster', resourceRef: RESOURCE,
      contentVersion: `${RESOURCE}:1`, sparseTiles: {},
      visible: true, opacity: 1, transform: [1, 0, 0, 1, 0, 0],
    }],
  }
}

describe('GPU 大图视口瓦片规划', () => {
  it('不同供应商十个异形源按自身金字塔规划，边缘核心尺寸不借用画布', () => {
    const sizes = [[2672, 1504], [1522, 1520], [1631, 1111], [3600, 549], [1275, 1870],
      [933, 1068], [1809, 1597], [1748, 1816], [2019, 713], [1847, 872]]
    const document = createImageEditDocumentV3({ width: 2672, height: 1504 })
    const refs = sizes.map((_, index) => `sha256:${index.toString(16).repeat(64)}` as const)
    document.layers = refs.map((ref, index) => createImageEditRasterLayerV3(`layer-${index}`, '图层', ref))
    const pyramids = Object.fromEntries(sizes.map(([width, height], index) => (
      [refs[index], createImageEditorGpuPyramidDescriptorV3(width, height)]
    )))
    const compiled = compileImageEditorGpuRasterSceneV3(document,
      refs.map((resourceRef) => ({ resourceRef, byteLength: 1, mediaType: 'image/png' })), pyramids)
    expect(compiled.supported).toBe(true)
    if (!compiled.supported) return
    for (const layer of compiled.scene.layers) {
      const plan = planImageEditorGpuRasterTilesV3(compiled.scene, layer, {
        stageWidth: 1336, stageHeight: 752, viewportKey: '真实异形源',
        viewport: { documentX: 0, documentY: 0, width: 1336, height: 752, zoom: 0.5, devicePixelRatio: 1 },
      })
      const mip = pyramids[layer.resourceRef!].levels.find((level) => level.mip === plan.mip)!
      expect(plan.tiles.length).toBeGreaterThan(0)
      for (const tile of plan.tiles) {
        expect(tile.key.tileX).toBeLessThan(mip.columns)
        expect(tile.key.tileY).toBeLessThan(mip.rows)
        expect(tile.coreWidth).toBe(Math.min(512, mip.width - tile.coreOriginX))
        expect(tile.coreHeight).toBe(Math.min(512, mip.height - tile.coreOriginY))
      }
    }
  })

  it('小源之外的稀疏画笔仍保留，空白区域不会请求不存在的源瓦片', () => {
    const value = scene()
    const brush = `sha256:${'f'.repeat(64)}` as const
    const plan = planImageEditorGpuRasterTilesV3(value, {
      ...value.layers[0], sourcePyramid: createImageEditorGpuPyramidDescriptorV3(600, 100),
      sparseTiles: { '0/2/0': { resourceRef: brush, contentVersion: 'stroke', byteLength: 32 } },
    }, {
      stageWidth: 2048, stageHeight: 512, viewportKey: '扩展画笔',
      viewport: { documentX: 0, documentY: 0, width: 2048, height: 512, zoom: 1, devicePixelRatio: 1 },
    })
    expect([...plan.tiles].sort((a, b) => a.key.tileX - b.key.tileX)
      .map((tile) => [tile.key.resourceRef, tile.key.tileX, tile.coreWidth, tile.coreHeight]))
      .toEqual([[RESOURCE, 0, 512, 100], [RESOURCE, 1, 88, 100], [brush, 2, 512, 512]])
  })

  it('大于画布的源添加画笔后不会截掉可由图层缩放带入视口的像素', () => {
    const value = scene()
    value.width = 2672
    value.height = 1504
    value.geometry = { ...value.geometry, width: value.width, height: value.height }
    const brush = `sha256:${'f'.repeat(64)}` as const
    const plan = planImageEditorGpuRasterTilesV3(value, {
      ...value.layers[0], sourcePyramid: createImageEditorGpuPyramidDescriptorV3(3600, 549),
      transform: [0.5, 0, 0, 0.5, 0, 0],
      sparseTiles: { '0/0/0': { resourceRef: brush, contentVersion: 'stroke', byteLength: 32 } },
    }, { stageWidth: 2672, stageHeight: 1504, viewportKey: '大源缩放',
      viewport: { documentX: 0, documentY: 0, width: 2672, height: 1504, zoom: 1, devicePixelRatio: 1 } })
    expect(plan.tiles.find((tile) => tile.key.tileX === 7 && tile.key.tileY === 0))
      .toMatchObject({ coreWidth: 16, coreHeight: 512, key: { resourceRef: RESOURCE } })
  })

  it('复用视口 planner 按缩放选 mip，不会要求 8192 整图纹理', () => {
    const value = scene()
    const layer = value.layers[0]
    const plan = planImageEditorGpuRasterTilesV3(value, layer, {
      stageWidth: 1_024,
      stageHeight: 768,
      viewportKey: 'large',
      viewport: {
        documentX: 3_072, documentY: 3_200, width: 1_024, height: 768,
        zoom: 0.125, devicePixelRatio: 2,
      },
    })

    expect(plan.mip).toBe(2)
    expect(plan.tiles.length).toBeGreaterThan(0)
    expect(plan.tiles.length).toBeLessThan(64)
    expect(new Set(plan.tiles.map((tile) => tile.key.mip))).toEqual(new Set([2]))
    expect(Math.max(...plan.tiles.map((tile) => tile.coreWidth))).toBeLessThanOrEqual(512)
  })

  it('平移后只更换局部瓦片，缩放临界点使用 previousMip 防抖', () => {
    const value = scene()
    const layer = value.layers[0]
    const first = planImageEditorGpuRasterTilesV3(value, layer, {
      stageWidth: 800, stageHeight: 600, viewportKey: 'a',
      viewport: { documentX: 0, documentY: 0, width: 800, height: 600, zoom: 0.5, devicePixelRatio: 1 },
    })
    const shifted = planImageEditorGpuRasterTilesV3(value, layer, {
      stageWidth: 800, stageHeight: 600, viewportKey: 'b',
      viewport: { documentX: 256, documentY: 0, width: 800, height: 600, zoom: 0.51, devicePixelRatio: 1 },
    }, first.mip)
    const firstKeys = new Set(first.tiles.map((tile) => `${tile.key.tileX}/${tile.key.tileY}`))
    const shiftedKeys = new Set(shifted.tiles.map((tile) => `${tile.key.tileX}/${tile.key.tileY}`))
    const retained = [...firstKeys].filter((key) => shiftedKeys.has(key))

    expect(shifted.mip).toBe(first.mip)
    expect(retained.length).toBeGreaterThan(0)
    expect(retained.length).toBeLessThanOrEqual(firstKeys.size)
  })

  it('多瓦片稀疏画笔固定mip0且只规划视口相交的内容版本', () => {
    const value = scene()
    const brushA = `sha256:${'b'.repeat(64)}` as const
    const brushB = `sha256:${'c'.repeat(64)}` as const
    const plan = planImageEditorGpuRasterTilesV3(value, {
      ...value.layers[0], resourceRef: null, contentVersion: 'empty',
      sparseTiles: {
        '0/0/0': { resourceRef: brushA, contentVersion: 'brush-a-v1', byteLength: 64 },
        '0/7/7': { resourceRef: brushB, contentVersion: 'brush-b-v1', byteLength: 64 },
      },
    }, {
      stageWidth: 512, stageHeight: 512, viewportKey: 'brush',
      viewport: { documentX: 0, documentY: 0, width: 512, height: 512,
        zoom: 1, devicePixelRatio: 1 },
    })
    expect(plan.mip).toBe(0)
    expect(plan.tiles.map((tile) => tile.key)).toEqual([expect.objectContaining({
      resourceRef: brushA, tileX: 0, tileY: 0,
      contentVersion: 'brush-a-v1', format: 'rgba16float',
    })])
  })

  it('连续100次笔画采样只更换脏tile key，不重传未变化tile', () => {
    const value = scene()
    const active = `sha256:${'d'.repeat(64)}` as const
    const stable = `sha256:${'e'.repeat(64)}` as const
    const layout = { stageWidth: 1024, stageHeight: 512, viewportKey: 'stroke-100',
      viewport: { documentX: 0, documentY: 0, width: 1024, height: 512,
        zoom: 1, devicePixelRatio: 1 } }
    let previous = new Map<string, string>()
    let changedActive = 0
    let retransmittedStable = 0
    for (let sample = 0; sample < 100; sample += 1) {
      const plan = planImageEditorGpuRasterTilesV3(value, {
        ...value.layers[0], resourceRef: null, contentVersion: 'stroke',
        sparseTiles: {
          '0/0/0': { resourceRef: active, contentVersion: `active-${sample}`, byteLength: 64 },
          '0/1/0': { resourceRef: stable, contentVersion: 'stable-1', byteLength: 64 },
        },
      }, layout)
      const current = new Map(plan.tiles.map((tile) => (
        [`${tile.key.tileX}/${tile.key.tileY}`, tile.key.contentVersion]
      )))
      if (sample > 0) {
        if (current.get('0/0') !== previous.get('0/0')) changedActive += 1
        if (current.get('1/0') !== previous.get('1/0')) retransmittedStable += 1
      }
      previous = current
    }
    expect(changedActive).toBe(99)
    expect(retransmittedStable).toBe(0)
  })
})

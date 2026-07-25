import { describe, expect, it } from 'vitest'
import {
  createImageEditExportPlan,
  fitWithinPixelBudget,
  IMAGE_EDIT_EXPORT_TILE_SIZE,
  IMAGE_EDIT_GLOBAL_SCATTER_MAX_DIMENSION,
} from './exportPrototype'
import { isImageEditWorkerEvent } from './protocol'
import { createDefaultDiffusionOperationParams } from '../diffusionParams'
import { compileDiffusionRecipe } from '../diffusionRecipe'
import { rebaseDiffusionRecipeForTile } from '../webgpu/exportRenderer'

describe('图片编辑 Worker 导出原型', () => {
  it('把 24MP 图片拆成有 halo 的完整无重叠逻辑 Tile', () => {
    const plan = createImageEditExportPlan(6000, 4000)
    expect(plan.tileSize).toBe(IMAGE_EDIT_EXPORT_TILE_SIZE)
    expect(plan.totalTiles).toBe(12)
    expect(Math.max(plan.globalScatterWidth, plan.globalScatterHeight))
      .toBe(IMAGE_EDIT_GLOBAL_SCATTER_MAX_DIMENSION)

    const coveredPixels = plan.tiles.reduce(
      (sum, tile) => sum + tile.width * tile.height,
      0
    )
    expect(coveredPixels).toBe(6000 * 4000)
    expect(plan.tiles[0]).toMatchObject({
      x: 0,
      y: 0,
      cropX: 0,
      cropY: 0,
    })
    const middleTile = plan.tiles.find((tile) => tile.x > 0 && tile.y > 0)
    expect(middleTile?.cropX).toBe(plan.halo)
    expect(middleTile?.cropY).toBe(plan.halo)
  })

  it('把预览限制在像素预算内并保持宽高比', () => {
    expect(fitWithinPixelBudget(6000, 4000)).toEqual({
      width: 1732,
      height: 1154,
    })
    expect(fitWithinPixelBudget(800, 600)).toEqual({
      width: 800,
      height: 600,
    })
  })

  it('只接受定义过的 Worker 事件类型', () => {
    expect(isImageEditWorkerEvent({ type: 'capabilities' })).toBe(true)
    expect(isImageEditWorkerEvent({ type: 'untrusted-event' })).toBe(false)
    expect(isImageEditWorkerEvent(null)).toBe(false)
  })

  it('Tile 重基准保持原图半径对应的像素尺度', () => {
    const recipe = compileDiffusionRecipe(
      createDefaultDiffusionOperationParams(),
      { width: 6000, height: 4000, quality: 'high' }
    )
    const tileRecipe = rebaseDiffusionRecipeForTile(recipe, 1664, 1664)
    expect(
      tileRecipe.scales[0].radius * tileRecipe.image.referenceDimension
    ).toBeCloseTo(
      recipe.scales[0].radius * recipe.image.referenceDimension,
      10
    )
  })
})

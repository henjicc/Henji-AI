import { describe, expect, it } from 'vitest'

import { createImageEditDocumentV3, ImageEditResourceBudget } from '@/core/imageEdit/v3'
import { prepareImageEditorViewportCompositeV3 } from './viewportCompositeDocumentV3'
import { planImageEditorViewportTilesV3 } from './viewportTilePlannerV3'
import { imageEditorViewportCompositeCandidateFitsBudgetV3 } from './viewportCompositeAdmissionV3'

const RESOURCE = `sha256:${'a'.repeat(64)}` as const

function pyramid(width: number, height: number) {
  const levels = []
  for (let mip = 0; mip <= 30; mip += 1) {
    const levelWidth = Math.max(1, Math.ceil(width / (2 ** mip)))
    const levelHeight = Math.max(1, Math.ceil(height / (2 ** mip)))
    levels.push({
      mip,
      width: levelWidth,
      height: levelHeight,
      columns: Math.ceil(levelWidth / 512),
      rows: Math.ceil(levelHeight / 512),
    })
    if (levelWidth === 1 && levelHeight === 1) break
  }
  return { tileSize: 512 as const, levels }
}

describe('视口合成候选联合预算', () => {
  it('在读取源瓦片前同时计算传输、Float32 工作集和成品资源', () => {
    const document = createImageEditDocumentV3({
      width: 20_000,
      height: 10_000,
      sourceResourceId: RESOURCE,
      idFactory: () => 'source',
    })
    const prepared = prepareImageEditorViewportCompositeV3(document, 'stable', [])
    const candidate = planImageEditorViewportTilesV3({
      resourceRef: RESOURCE,
      documentSize: { width: 20_000, height: 10_000 },
      pyramid: pyramid(20_000, 10_000),
      viewport: {
        documentX: 0, documentY: 0, width: 1_440, height: 900,
        zoom: 1_440 / 20_000, devicePixelRatio: 1,
      },
      bitDepth: 32,
    })
    const shared = { prepared, document, candidate, bitDepth: 32 as const, wholeSource: false }

    expect(imageEditorViewportCompositeCandidateFitsBudgetV3({
      ...shared,
      budget: new ImageEditResourceBudget({
        totalBytes: 1 * 1024 * 1024,
        cpuCacheTargetBytes: 0,
        gpuTargetBytes: 0,
      }),
    })).toBe(false)
    expect(imageEditorViewportCompositeCandidateFitsBudgetV3({
      ...shared,
      budget: new ImageEditResourceBudget(),
    })).toBe(true)
  })
})

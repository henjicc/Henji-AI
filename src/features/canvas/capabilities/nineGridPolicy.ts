import type { StoryboardGenNodeData } from '../domain/canvasNodes'
import type { CanvasGenerationOutputBatchContractV1 } from '../domain/generationOutputs'

export const NINE_GRID_PRESET_ID = 'nine-grid-v1' as const
export const NINE_GRID_PROMPT_TEMPLATE_VERSION = 'nine-grid-storyboard-v1' as const
export const NINE_GRID_ROWS = 3
export const NINE_GRID_COLS = 3
export const NINE_GRID_CELL_COUNT = NINE_GRID_ROWS * NINE_GRID_COLS

export type NineGridPresetId = typeof NINE_GRID_PRESET_ID

export interface NineGridNodeInitialData {
  displayName: string
  capabilityId: 'image.nine-grid'
  gridRows: number
  gridCols: number
  frames: StoryboardGenNodeData['frames']
  storyboardPreset: NineGridPresetId
  promptTemplateVersion: typeof NINE_GRID_PROMPT_TEMPLATE_VERSION
}

export function createNineGridNodeInitialData(): NineGridNodeInitialData {
  return {
    displayName: '九宫格',
    capabilityId: 'image.nine-grid',
    gridRows: NINE_GRID_ROWS,
    gridCols: NINE_GRID_COLS,
    frames: Array.from({ length: NINE_GRID_CELL_COUNT }, (_, index) => ({
      id: `nine-grid-frame-${index + 1}`,
      description: '',
      referenceIndex: null,
    })),
    storyboardPreset: NINE_GRID_PRESET_ID,
    promptTemplateVersion: NINE_GRID_PROMPT_TEMPLATE_VERSION,
  }
}

export function isNineGridStoryboard(data: StoryboardGenNodeData): boolean {
  return data.storyboardPreset === NINE_GRID_PRESET_ID
}

export function normalizeNineGridStoryboardData(data: DynamicValueMap): void {
  if (data.storyboardPreset !== NINE_GRID_PRESET_ID) return
  const defaults = createNineGridNodeInitialData()
  data.gridRows = NINE_GRID_ROWS
  data.gridCols = NINE_GRID_COLS
  data.promptTemplateVersion = NINE_GRID_PROMPT_TEMPLATE_VERSION
  const existingFrames = Array.isArray(data.frames) ? data.frames : []
  data.frames = defaults.frames.map((fallback, index) => {
    const frame = existingFrames[index]
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return fallback
    const record = frame as DynamicValueMap
    return {
      id: typeof record.id === 'string' && record.id.trim() ? record.id : fallback.id,
      description: typeof record.description === 'string' ? record.description : '',
      ...(record.descriptionDocument && typeof record.descriptionDocument === 'object'
        ? { descriptionDocument: record.descriptionDocument }
        : {}),
      referenceIndex: typeof record.referenceIndex === 'number'
        && Number.isInteger(record.referenceIndex)
        ? record.referenceIndex
        : null,
    }
  })
}

export function createStoryboardGridOutputContract(input: {
  sources: readonly string[]
  rows: number
  cols: number
  frameNotes?: readonly string[]
}): CanvasGenerationOutputBatchContractV1 {
  const rows = Math.max(1, Math.floor(input.rows))
  const cols = Math.max(1, Math.floor(input.cols))
  const cellCount = rows * cols
  if (input.sources.length !== 1 && input.sources.length !== cellCount) {
    throw new Error(`宫格生成预期 1 张组合图或 ${cellCount} 张独立图，实际 ${input.sources.length} 张`)
  }

  if (input.sources.length === 1) {
    return {
      version: 1,
      strategy: 'single',
      resultKind: 'image',
      expectedOutputCount: 1,
      outputs: [{
        source: input.sources[0],
        descriptor: {
          version: 1,
          outputId: 'grid-composite',
          order: 0,
          sourceOutputIndex: 0,
          mediaType: 'image',
          semantic: { kind: 'grid-composite', resultKind: 'image' },
          metadata: { gridRows: rows, gridCols: cols, cellCount },
        },
      }],
    }
  }

  return {
    version: 1,
    strategy: 'assetGroup',
    resultKind: 'image-group',
    expectedOutputCount: cellCount,
    outputs: input.sources.map((source, index) => ({
      source,
      descriptor: {
        version: 1,
        outputId: `grid-cell-${index + 1}`,
        order: index,
        sourceOutputIndex: index,
        mediaType: 'image',
        semantic: {
          kind: 'grid-cell',
          resultKind: 'image',
          label: `宫格 ${String(index + 1).padStart(2, '0')}`,
        },
        metadata: {
          gridRows: rows,
          gridCols: cols,
          row: Math.floor(index / cols),
          column: index % cols,
          note: input.frameNotes?.[index]?.trim() ?? '',
        },
      },
    })),
  }
}

function stableHash(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(36)
}

export function createGridSplitCompletionId(input: {
  sourceNodeId: string
  sourceImageUrl: string
  rows: number
  cols: number
  lineThicknessPercent?: number
}): string {
  const fingerprint = [
    input.sourceImageUrl,
    Math.max(1, Math.floor(input.rows)),
    Math.max(1, Math.floor(input.cols)),
    Number.isFinite(input.lineThicknessPercent) ? input.lineThicknessPercent : 0,
  ].join('|')
  return `grid-split:${input.sourceNodeId}:${stableHash(fingerprint)}`
}

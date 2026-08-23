import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

export const GENERATION_PROMPT_MIN_HEIGHT_PX = 100

// GenerationNodeShell 当前的纵向固定占位：根节点 p-2（16px）+ 上下边框（2px）
// + 提示词区与参数区之间的 gap-1.5（6px）。长提示词正文不参与这个计算。
const GENERATION_NODE_FIXED_VERTICAL_SPACE_PX = 24
const GENERATION_NODE_MINIMUM_HEIGHT_CSS_VAR = '--generation-node-min-height'

interface GenerationNodeMinimumHeightResult {
  rootRef: RefObject<HTMLDivElement>
  inputRowsRef: RefObject<HTMLDivElement>
  minimumHeight: number
}

export function resolveGenerationNodeMinimumHeight(
  configuredMinimumHeight: number,
  inputRowsHeight: number,
): number {
  const safeConfiguredMinimum = Number.isFinite(configuredMinimumHeight)
    ? Math.max(0, configuredMinimumHeight)
    : 0
  const safeInputRowsHeight = Number.isFinite(inputRowsHeight)
    ? Math.max(0, Math.ceil(inputRowsHeight))
    : 0

  return Math.max(
    safeConfiguredMinimum,
    GENERATION_PROMPT_MIN_HEIGHT_PX
      + GENERATION_NODE_FIXED_VERTICAL_SPACE_PX
      + safeInputRowsHeight,
  )
}

/**
 * ReactFlow 会把内容测量尺寸也通过 NodeProps.width/height 回传。只有用户确实拖拽过尺寸时，
 * 才能把这个值当成显式尺寸；否则参数组曾经内联展开产生的旧测量值会永久撑高节点。
 */
export function resolveGenerationNodeManualDimension(
  measuredDimension: number | undefined,
  minimumDimension: number,
  isSizeManuallyAdjusted: boolean,
): number | null {
  if (!isSizeManuallyAdjusted || !Number.isFinite(measuredDimension)) return null
  return Math.max(minimumDimension, Math.round(measuredDimension as number))
}

/**
 * 只测量不会随节点纵向拖拽伸缩的参数区，用数值型下限约束节点。
 * 提示词正文被刻意排除，因此无论文本多长，都只在编辑器内部滚动。
 */
export function useGenerationNodeMinimumHeight(
  configuredMinimumHeight: number,
): GenerationNodeMinimumHeightResult {
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRowsRef = useRef<HTMLDivElement>(null)
  const [inputRowsHeight, setInputRowsHeight] = useState(0)
  const minimumHeight = resolveGenerationNodeMinimumHeight(
    configuredMinimumHeight,
    inputRowsHeight,
  )

  useLayoutEffect(() => {
    const element = inputRowsRef.current
    if (!element) return

    const measure = (): void => {
      const nextHeight = Math.max(0, Math.ceil(element.offsetHeight))
      setInputRowsHeight((currentHeight) => (
        currentHeight === nextHeight ? currentHeight : nextHeight
      ))
    }

    measure()
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const reactFlowNode = rootRef.current?.closest<HTMLElement>('.react-flow__node')
    if (!reactFlowNode) return

    reactFlowNode.style.setProperty(
      GENERATION_NODE_MINIMUM_HEIGHT_CSS_VAR,
      `${minimumHeight}px`,
    )
    return () => {
      reactFlowNode.style.removeProperty(GENERATION_NODE_MINIMUM_HEIGHT_CSS_VAR)
    }
  }, [minimumHeight])

  return { rootRef, inputRowsRef, minimumHeight }
}

import type { PointerEvent as ReactPointerEvent } from 'react'

import type { MarkItem } from '@/core/imageEdit/types'
import { ANNOTATION_TRANSFORMER_HEX } from '@/core/theme/colorTokens'
import { getAnnotationBoundsV3 } from './annotationModelV3'
import type { AnnotationResizeHandleV3 } from './annotationModelV3'

interface AnnotationSvgShapeV3Props {
  annotation: MarkItem
  selected?: boolean
  draft?: boolean
  onPointerDown?: (event: ReactPointerEvent<SVGGElement>) => void
  onResizePointerDown?: (
    event: ReactPointerEvent<SVGCircleElement>,
    handle: AnnotationResizeHandleV3,
  ) => void
  handleRadius?: number
}

function annotationPath(annotation: Extract<MarkItem, { type: 'arrow' | 'pen' }>): string {
  if (annotation.type === 'pen') {
    const pairs: string[] = []
    for (let index = 0; index + 1 < annotation.points.length; index += 2) {
      pairs.push(`${annotation.points[index]},${annotation.points[index + 1]}`)
    }
    return pairs.length > 0 ? `M ${pairs.join(' L ')}` : ''
  }
  const [x1, y1, x2, y2] = annotation.points
  return annotation.curveControl
    ? `M ${x1} ${y1} Q ${annotation.curveControl[0]} ${annotation.curveControl[1]} ${x2} ${y2}`
    : `M ${x1} ${y1} L ${x2} ${y2}`
}

function HitTarget({ annotation }: { annotation: MarkItem }): JSX.Element {
  if (annotation.type === 'rect' || annotation.type === 'mosaic') {
    return (
      <rect
        x={annotation.x}
        y={annotation.y}
        width={annotation.width}
        height={annotation.height}
        fill="transparent"
        stroke="transparent"
        strokeWidth={Math.max(12, 'lineWidth' in annotation ? annotation.lineWidth : 1)}
        pointerEvents="all"
      />
    )
  }
  if (annotation.type === 'ellipse') {
    return (
      <ellipse
        cx={annotation.x + annotation.width / 2}
        cy={annotation.y + annotation.height / 2}
        rx={Math.abs(annotation.width / 2)}
        ry={Math.abs(annotation.height / 2)}
        fill="transparent"
        stroke="transparent"
        strokeWidth={Math.max(12, annotation.lineWidth)}
        pointerEvents="all"
      />
    )
  }
  if (annotation.type === 'arrow' || annotation.type === 'pen') {
    return (
      <path
        d={annotationPath(annotation)}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(12, annotation.lineWidth)}
        strokeLinecap="round"
        strokeLinejoin="round"
        pointerEvents="stroke"
      />
    )
  }
  const bounds = getAnnotationBoundsV3(annotation)
  return (
    <rect
      x={bounds.x}
      y={bounds.y}
      width={Math.max(1, bounds.width)}
      height={Math.max(1, bounds.height)}
      fill="transparent"
      pointerEvents="all"
    />
  )
}

function DraftShape({ annotation }: { annotation: MarkItem }): JSX.Element | null {
  if (annotation.type === 'rect') {
    return (
      <rect
        x={annotation.x}
        y={annotation.y}
        width={annotation.width}
        height={annotation.height}
        fill="none"
        stroke={annotation.stroke}
        strokeWidth={annotation.lineWidth}
      />
    )
  }
  if (annotation.type === 'ellipse') {
    return (
      <ellipse
        cx={annotation.x + annotation.width / 2}
        cy={annotation.y + annotation.height / 2}
        rx={Math.abs(annotation.width / 2)}
        ry={Math.abs(annotation.height / 2)}
        fill="none"
        stroke={annotation.stroke}
        strokeWidth={annotation.lineWidth}
      />
    )
  }
  if (annotation.type === 'arrow' || annotation.type === 'pen') {
    return (
      <path
        d={annotationPath(annotation)}
        fill="none"
        stroke={annotation.stroke}
        strokeWidth={annotation.lineWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    )
  }
  if (annotation.type === 'text') {
    return (
      <text
        x={annotation.x}
        y={annotation.y}
        fill={annotation.color}
        fontSize={annotation.fontSize}
      >
        {annotation.text}
      </text>
    )
  }
  if (annotation.type === 'number') {
    return (
      <text
        x={annotation.x}
        y={annotation.y}
        fill={annotation.color}
        fontSize={annotation.fontSize}
      >
        •
      </text>
    )
  }
  if (annotation.type === 'mosaic') {
    return (
      <rect
        x={annotation.x}
        y={annotation.y}
        width={annotation.width}
        height={annotation.height}
        fill="none"
        stroke={ANNOTATION_TRANSFORMER_HEX}
        strokeWidth={1.5}
        strokeDasharray="5 4"
        vectorEffect="non-scaling-stroke"
      />
    )
  }
  return null
}

export function AnnotationSvgShapeV3({
  annotation,
  selected = false,
  draft = false,
  onPointerDown,
  onResizePointerDown,
  handleRadius = 5,
}: AnnotationSvgShapeV3Props): JSX.Element {
  const bounds = getAnnotationBoundsV3(annotation)
  const padding = Math.max(4, 'lineWidth' in annotation ? annotation.lineWidth : 2)
  return (
    <g
      data-annotation-id={annotation.id}
      data-annotation-draft={draft ? 'true' : undefined}
      onPointerDown={onPointerDown}
      className={onPointerDown ? 'cursor-move' : undefined}
    >
      {draft ? <DraftShape annotation={annotation} /> : null}
      {onPointerDown ? <HitTarget annotation={annotation} /> : null}
      {selected ? (
        <>
          <rect
            data-annotation-selection
            x={bounds.x - padding}
            y={bounds.y - padding}
            width={Math.max(1, bounds.width + padding * 2)}
            height={Math.max(1, bounds.height + padding * 2)}
            fill="none"
            stroke={ANNOTATION_TRANSFORMER_HEX}
            strokeWidth={1.5}
            strokeDasharray="5 4"
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          {onResizePointerDown ? ([
            ['nw', bounds.x - padding, bounds.y - padding],
            ['n', bounds.x + bounds.width / 2, bounds.y - padding],
            ['ne', bounds.x + bounds.width + padding, bounds.y - padding],
            ['e', bounds.x + bounds.width + padding, bounds.y + bounds.height / 2],
            ['se', bounds.x + bounds.width + padding, bounds.y + bounds.height + padding],
            ['s', bounds.x + bounds.width / 2, bounds.y + bounds.height + padding],
            ['sw', bounds.x - padding, bounds.y + bounds.height + padding],
            ['w', bounds.x - padding, bounds.y + bounds.height / 2],
          ] as const).map(([handle, cx, cy]) => (
            <circle
              key={handle}
              data-annotation-resize-handle={handle}
              cx={cx}
              cy={cy}
              r={handleRadius}
              fill="currentColor"
              stroke={ANNOTATION_TRANSFORMER_HEX}
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
              className="text-text-dark"
              onPointerDown={(event) => onResizePointerDown(event, handle)}
            />
          )) : null}
        </>
      ) : null}
    </g>
  )
}

import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CANVAS_GRID_ALT_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens'
import { MULTI_ANGLE_DISCRETE_VIEW_PRESETS, type MultiAngleViewV1 } from '@/features/canvas/capabilities/multiAnglePolicy'
import { MULTI_ANGLE_ORBIT_PATHS, multiAngleMarkerPosition, projectMultiAnglePoint } from './multiAngleOrbitGeometry'
import { imagePlateGeometry } from '../relightSpatialState'
import { snapContinuousCamera, snapFluxCamera } from './multiAngleCameraVisualizerState'

export const MultiAngleOrbitScene = memo(function MultiAngleOrbitScene({ views, selectedViewId, sourceImage, sourceAlt = '', dragging = false, previewPosition }: {
  views: MultiAngleViewV1[]
  selectedViewId: string
  sourceImage?: string | null
  sourceAlt?: string
  dragging?: boolean
  previewPosition?: [number, number, number] | null
}): JSX.Element {
  const { t } = useTranslation()
  const [imageSize, setImageSize] = useState({ source: '', aspect: 1 })
  const plate = imagePlateGeometry(imageSize.source === sourceImage ? imageSize.aspect : 1, point => {
    const p = projectMultiAnglePoint([point.x * 1.4, point.y * 1.4, point.z * 1.4])
    return { x: p.x, y: p.y, z: -p.depth }
  })
  const selected = views.find(view => view.viewId === selectedViewId)
  const target = selected?.kind === 'continuous' ? { ...selected, ...snapContinuousCamera(selected) }
    : selected?.kind === 'flux' ? { ...selected, ...snapFluxCamera(selected) } : selected
  const targetPoint = target ? projectMultiAnglePoint(multiAngleMarkerPosition(target)) : null
  const stops = useMemo(() => {
    if (!selected) return []
    if (selected.kind === 'discrete') return MULTI_ANGLE_DISCRETE_VIEW_PRESETS.map(item => item.view)
    if (selected.kind === 'continuous') return [-90, -45, 0, 45, 90].map(yawControlDeg => ({ ...selected, yawControlDeg }))
    return [0, 45, 90, 135, 180, 225, 270, 315].map(horizontalAngleDeg => ({ ...selected, horizontalAngleDeg }))
  }, [selected])
  const markers = useMemo(() => views.map(view => {
    const position = view.viewId === selectedViewId && previewPosition ? previewPosition : multiAngleMarkerPosition(view)
    return { viewId: view.viewId, position, ...projectMultiAnglePoint(position) }
  }).sort((a, b) => b.depth - a.depth), [views, selectedViewId, previewPosition])
  const marker = (point: typeof markers[number]): JSX.Element => <g key={point.viewId} data-camera-selected={point.viewId === selectedViewId} data-camera-depth={point.position[2] < 0 ? 'back' : 'front'}>
    {point.viewId === selectedViewId && <path d={`M${point.x},${point.y} L50,50`} className="stroke-accent" strokeWidth="0.4"
      strokeDasharray={point.position[2] < 0 ? '1.2 1.2' : undefined} opacity="0.55" />}
    <circle cx={point.x} cy={point.y} r={0.075 * point.scale * (point.viewId === selectedViewId ? 1.35 : 0.85)}
      fill={point.viewId === selectedViewId ? CANVAS_TEXT_HEX : CANVAS_GRID_ALT_HEX} />
  </g>
  return (
    // icon-token-allow：轨道和相机标记由三维方位数据投影生成，不是图标；无 RAF 或 WebGL 上下文。
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" data-multi-angle-orbit-scene="true">
      {MULTI_ANGLE_ORBIT_PATHS.map((path, index) => <g key={index}>
        <path d={path.back} fill="none" className="stroke-veil-subtle" strokeWidth="0.25" strokeDasharray="0.8 1.4" />
        <path d={path.front} fill="none" className="stroke-veil-soft" strokeWidth="0.3" />
      </g>)}
      {markers.filter(point => point.position[2] < 0).map(marker)}
      {plate.sides.map((points, index) => <polygon key={index} points={points} data-image-thickness="true" className="fill-text-muted stroke-veil-soft" strokeWidth="0.15" />)}
      <g transform={plate.matrix} data-multi-angle-image-plane="true" data-image-aspect={plate.width / plate.height}>
        {sourceImage ? <foreignObject x={-plate.width * 50} y={-plate.height * 50} width={plate.width * 100} height={plate.height * 100}>
          <img src={sourceImage} alt={sourceAlt} draggable={false} className="block h-full w-full" onLoad={event => {
            const image = event.currentTarget
            if (image.naturalWidth && image.naturalHeight) setImageSize({ source: sourceImage, aspect: image.naturalWidth / image.naturalHeight })
          }} />
        </foreignObject> : <rect x={-plate.width * 50} y={-plate.height * 50} width={plate.width * 100} height={plate.height * 100} className="fill-surface-dark stroke-veil-soft" strokeWidth="0.6" />}
      </g>
      {markers.filter(point => point.position[2] >= 0).map(marker)}
      {stops.map((stop, index) => {
        const snappedStop = stop.kind === 'continuous' ? { ...stop, verticalControl: target?.kind === 'continuous' ? target.verticalControl : stop.verticalControl }
          : stop.kind === 'flux' ? { ...stop, verticalAngleDeg: target?.kind === 'flux' ? target.verticalAngleDeg : stop.verticalAngleDeg } : stop
        const p = projectMultiAnglePoint(multiAngleMarkerPosition(snappedStop))
        const active = dragging && targetPoint && Math.hypot(targetPoint.x - p.x, targetPoint.y - p.y) < 0.1
        return <g key={index} data-camera-stop={stop.kind === 'discrete' ? stop.preset : index} data-snap-active={Boolean(active)}>
          <circle cx={p.x} cy={p.y} r={active ? 3.8 : 0.6} fill="none" className={active ? 'stroke-accent' : 'stroke-veil-soft'} strokeWidth={active ? 0.45 : 0.25} />
          {active && <text x={p.x} y={p.y - 5} fontSize="2.8" textAnchor="middle" className="fill-text-dark">{stop.kind === 'discrete'
            ? t(`node.multiAngleEditor.presets.discrete.${stop.preset}`, { defaultValue: stop.label })
            : `${stop.kind === 'continuous' ? stop.yawControlDeg : stop.horizontalAngleDeg}°`}</text>}
        </g>
      })}
      {[-1, 1].map(z => {
        const p = projectMultiAnglePoint([0, -0.78 / 0.59, z * 0.72 / 0.59])
        return <text key={z} x={p.x} y={p.y} fontSize="2.7" textAnchor="middle" className="fill-text-muted">{t(z > 0 ? 'node.multiAngleEditor.presets.discrete.front' : 'node.multiAngleEditor.presets.discrete.back', { defaultValue: z > 0 ? '正面' : '背面' })}</text>
      })}
    </svg>
  )
})

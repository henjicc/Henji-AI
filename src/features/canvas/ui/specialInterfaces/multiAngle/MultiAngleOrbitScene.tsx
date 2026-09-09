import { memo, useMemo } from 'react'
import { CANVAS_GRID_ALT_HEX, CANVAS_TEXT_HEX } from '@/core/theme/colorTokens'
import type { MultiAngleViewV1 } from '@/features/canvas/capabilities/multiAnglePolicy'
import { MULTI_ANGLE_ORBIT_PATHS, multiAngleMarkerPosition, projectMultiAnglePoint } from './multiAngleOrbitGeometry'

export const MultiAngleOrbitScene = memo(function MultiAngleOrbitScene({ views, selectedViewId }: {
  views: MultiAngleViewV1[]
  selectedViewId: string
}): JSX.Element {
  const markers = useMemo(() => views.map(view => ({ viewId: view.viewId,
    ...projectMultiAnglePoint(multiAngleMarkerPosition(view)) })).sort((a, b) => b.depth - a.depth), [views])
  return (
    // icon-token-allow：轨道和相机标记由三维方位数据投影生成，不是图标；无 RAF 或 WebGL 上下文。
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" data-multi-angle-orbit-scene="true">
      {MULTI_ANGLE_ORBIT_PATHS.map((path, index) => <path key={index} d={path} fill="none"
        stroke={CANVAS_GRID_ALT_HEX} strokeWidth={index === 0 ? 0.4 : 0.3} opacity="0.9" />)}
      {markers.map(marker => <circle key={marker.viewId} cx={marker.x} cy={marker.y}
        r={0.075 * marker.scale * (marker.viewId === selectedViewId ? 1.35 : 0.85)}
        fill={marker.viewId === selectedViewId ? CANVAS_TEXT_HEX : CANVAS_GRID_ALT_HEX} />)}
    </svg>
  )
})

import { memo, useMemo, useState } from 'react'
import type { MultiAngleViewV1 } from '@/features/canvas/capabilities/multiAnglePolicy'
import { imageBlockGeometry, multiAngleOrientation, type MultiAngleOrientation } from './multiAngleOrbitGeometry'

export const MultiAngleOrbitScene = memo(function MultiAngleOrbitScene({ views, selectedViewId, sourceImage, sourceAlt = '', previewOrientation }: {
  views: MultiAngleViewV1[]
  selectedViewId: string
  sourceImage?: string | null
  sourceAlt?: string
  previewOrientation?: MultiAngleOrientation | null
}): JSX.Element {
  const [imageSize, setImageSize] = useState({ source: '', aspect: 1 })
  const selected = views.find(view => view.viewId === selectedViewId) ?? views[0]
  const pose = previewOrientation ?? (selected ? multiAngleOrientation(selected) : { azimuth: 0, elevation: 0 })
  const zoom = selected?.kind === 'continuous' ? selected.proximity : selected?.kind === 'flux' ? selected.zoom : 5
  const aspect = imageSize.source === sourceImage ? imageSize.aspect : 1
  const block = useMemo(() => imageBlockGeometry(aspect, { azimuth: pose.azimuth, elevation: pose.elevation }, zoom), [aspect, pose.azimuth, pose.elevation, zoom])
  return (
    // icon-token-allow：六个面由视角数据投影；仅在角度变化时更新，不创建 GPU 上下文或刷新循环。
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true"
      data-multi-angle-image-block="true" data-block-azimuth={pose.azimuth} data-block-elevation={pose.elevation} data-image-aspect={aspect}>
      {block.faces.map(face => <g key={face.name} data-block-face={face.name} visibility={face.visible ? 'visible' : 'hidden'}>
        <polygon points={face.points} className={`${face.name === 'top' ? 'fill-text-muted' : face.name === 'bottom' ? 'fill-surface-dark' : face.name === 'back' ? 'fill-layer' : 'fill-panel'} stroke-veil-soft`} strokeWidth="0.3" strokeLinejoin="round" />
        {face.name === 'front' && sourceImage && <foreignObject transform={block.matrix} width={block.width} height={block.height}>
          <img src={sourceImage} alt={sourceAlt} draggable={false} className="block h-full w-full" onLoad={event => {
            const image = event.currentTarget
            if (image.naturalWidth && image.naturalHeight) setImageSize({ source: sourceImage, aspect: image.naturalWidth / image.naturalHeight })
          }} />
        </foreignObject>}
      </g>)}
    </svg>
  )
})

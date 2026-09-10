import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@/core/logging'
import type { MultiAngleViewV1, MultiAngleDiscretePreset } from '@/features/canvas/capabilities/multiAnglePolicy'
import { MultiAngleViewNavigator } from './MultiAngleViewNavigator'
import { imageBlockGeometry, multiAngleOrientation, type MultiAngleOrientation } from './multiAngleOrbitGeometry'
import { getImageBlockAppearance, peekImageBlockAppearance } from './imageBlockTextureCache'
import type { ImageBlockTextures } from './imageBlockTextures'

const logger = createLogger('features.canvas.multiAngle')

export const MultiAngleOrbitScene = memo(function MultiAngleOrbitScene({ views, selectedViewId, sourceImage, sourceAlt = '', previewOrientation, onDiscretePresetChange }: {
  views: MultiAngleViewV1[]
  selectedViewId: string
  sourceImage?: string | null
  sourceAlt?: string
  previewOrientation?: MultiAngleOrientation | null
  onDiscretePresetChange?: (preset: MultiAngleDiscretePreset) => void
}): JSX.Element {
  const [imageSize, setImageSize] = useState<{ source: string; aspect: number; textures: ImageBlockTextures | null }>({ source: '', aspect: 1, textures: null })
  const loading = useRef({ revision: 0 }).current
  useEffect(() => { loading.revision++; return () => { loading.revision++ } }, [sourceImage, loading])
  const [corsFallback, setCorsFallback] = useState('')
  const selected = views.find(view => view.viewId === selectedViewId) ?? views[0]
  const pose = previewOrientation ?? (selected ? multiAngleOrientation(selected) : { azimuth: 0, elevation: 0 })
  const zoom = selected?.kind === 'continuous' ? selected.proximity : selected?.kind === 'flux' ? selected.zoom : 5
  const appearance = imageSize.source === sourceImage ? imageSize : sourceImage ? peekImageBlockAppearance(sourceImage) : undefined
  const aspect = appearance?.aspect ?? 1
  const textures = appearance?.textures ?? null
  const block = useMemo(() => imageBlockGeometry(aspect, { azimuth: pose.azimuth, elevation: pose.elevation }, zoom), [aspect, pose.azimuth, pose.elevation, zoom])
  return (
    // icon-token-allow：六个面由视角数据投影，边缘贴图载入时烘焙；不创建 WebGL 上下文或刷新循环。
    <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden={onDiscretePresetChange ? undefined : true}
      data-multi-angle-image-block="true" data-block-azimuth={pose.azimuth} data-block-elevation={pose.elevation} data-image-aspect={aspect}>
      {block.faces.map(face => <g key={face.name} data-block-face={face.name} visibility={face.visible ? 'visible' : 'hidden'}>
        <polygon points={face.points} className={`${face.name === 'top' ? 'fill-text-muted' : face.name === 'bottom' ? 'fill-surface-dark' : face.name === 'back' ? 'fill-layer' : 'fill-panel'} stroke-veil-soft`} strokeWidth="0.3" strokeLinejoin="round" />
        {face.name !== 'front' && textures && <image data-block-texture={face.name} href={textures[face.name]}
          width="1" height="1" preserveAspectRatio="none" transform={face.textureMatrix} opacity={face.name === 'bottom' ? 0.65 : face.name === 'back' ? 0.8 : 0.9} />}
        {face.name === 'front' && sourceImage && <foreignObject transform={block.matrix} width={block.width} height={block.height}>
          <img src={sourceImage} crossOrigin={corsFallback !== sourceImage && /^(?:https?:|asset:|henji-media:)/i.test(sourceImage) ? 'anonymous' : undefined} alt={sourceAlt} draggable={false} className="block h-full w-full"
            onError={event => { if (event.currentTarget.crossOrigin) setCorsFallback(sourceImage) }} onLoad={async event => {
            const image = event.currentTarget
            if (!image.naturalWidth || !image.naturalHeight) return
            const revision = ++loading.revision
            const loadedAspect = image.naturalWidth / image.naturalHeight
            try {
              const next = await getImageBlockAppearance(sourceImage, image)
              if (revision === loading.revision) setImageSize(previous => previous.source === sourceImage && previous.textures === next.textures ? previous : { source: sourceImage, ...next })
            } catch (error) {
              logger.warn('图片块边缘贴图生成失败，保留基础面色', { event: 'multi_angle.edge_texture.failed', error })
              if (revision === loading.revision) setImageSize({ source: sourceImage, aspect: loadedAspect, textures: null })
            }
          }} />
        </foreignObject>}
      </g>)}
      {selected?.kind === 'discrete' && onDiscretePresetChange && (
        <MultiAngleViewNavigator selectedPreset={selected.preset} onSelect={onDiscretePresetChange} block={block} pose={pose} />
      )}
    </svg>
  )
})

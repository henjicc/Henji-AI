import { useId, useState } from 'react'
import { UI_LIGHTING_COLORS } from '@/components/ui/styleTokens'
import type { RelightVisualizerView } from './relightDirectionVisualizerState'
import { imagePlaneSize, lightPosition, projectedConeOutline, projectSpatialPoint, type LightPose, type SpatialPoint } from './relightSpatialState'

interface Props {
  main: LightPose
  rim: LightPose | null
  view: RelightVisualizerView
  color: string
  intensity: number
  sourceImage: string | null
  sourceAlt: string
}

export function RelightSpatialScene({ main, rim, view, color, intensity, sourceImage, sourceAlt }: Props): JSX.Element {
  const id = useId().replace(/:/g, '')
  const [imageSize, setImageSize] = useState({ source: '', aspect: 1 })
  const size = imagePlaneSize(imageSize.source === sourceImage ? imageSize.aspect : 1)
  const project = (p: SpatialPoint): SpatialPoint => projectSpatialPoint(p, view)
  const axisX = project({ x: 1, y: 0, z: 0 })
  const axisY = project({ x: 0, y: -1, z: 0 })
  const matrix = `matrix(${(axisX.x - 50) / 100} ${(axisX.y - 50) / 100} ${(axisY.x - 50) / 100} ${(axisY.y - 50) / 100} 50 50)`
  const lights = [{ key: 'main', pose: main, strength: intensity },
    ...(rim ? [{ key: 'rim', pose: rim, strength: intensity * 0.65 }] : [])]
    .map(lamp => ({ ...lamp, position: lightPosition(lamp.pose) }))
    .sort((a, b) => project(a.position).z - project(b.position).z)
  const frontIllumination = lights.reduce((sum, lamp) => sum + Math.max(0, lamp.position.z) * lamp.strength, 0)
  const polygon = (points: SpatialPoint[]): string => points.map(p => { const s = project(p); return `${s.x},${s.y}` }).join(' ')
  const lamp = (light: typeof lights[number]): JSX.Element => {
    const source = project(light.position)
    // A cone ends on the actual image plane, rather than at an unrelated screen-space point.
    const radius = light.key === 'main' ? 0.3 : 0.15
    const target = light.key === 'main' ? { x: 0, y: 0, z: 0 }
      : { x: Math.sign(light.position.x) * size.width * 0.38, y: Math.sign(light.position.y) * size.height * 0.2, z: 0 }
    const ring = Array.from({ length: 24 }, (_, i) => ({ x: target.x + Math.cos(i * Math.PI / 12) * radius,
      y: target.y + Math.sin(i * Math.PI / 12) * radius, z: 0 }))
    const end = project(target)
    return <g key={light.key} data-relight-light={light.key} data-relight-depth={light.position.z >= 0 ? 'front' : 'back'}>
      <defs>
        <linearGradient id={`${id}-${light.key}-beam`} gradientUnits="userSpaceOnUse" x1={source.x} y1={source.y} x2={end.x} y2={end.y}>
          <stop offset="0" stopColor={color} stopOpacity={light.strength * 0.5} />
          <stop offset="1" stopColor={color} stopOpacity={light.strength * 0.015} />
        </linearGradient>
        <radialGradient id={`${id}-${light.key}-lamp`} cx="35%" cy="28%">
          <stop offset="0" stopColor={UI_LIGHTING_COLORS.neutral} />
          <stop offset="0.45" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.18" />
        </radialGradient>
      </defs>
      <polygon data-relight-beam="true" points={projectedConeOutline([light.position, ...ring], view)}
        fill={`url(#${id}-${light.key}-beam)`} filter={`url(#${id}-soft)`} />
      <circle cx={source.x} cy={source.y} r={light.key === 'main' ? 6 : 4.5} fill={`url(#${id}-glow)`} opacity={light.strength} />
      <circle cx={source.x} cy={source.y} r={light.key === 'main' ? 2.8 : 1.9}
        fill={`url(#${id}-${light.key}-lamp)`} className="stroke-veil-bright" strokeWidth="0.3" />
    </g>
  }
  return (
    // icon-token-allow：三维灯位、球面网格和图片平面共用投影矩阵，是交互数据图形。
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <filter id={`${id}-soft`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="0.3" /></filter>
        <radialGradient id={`${id}-sphere`} cx="35%" cy="25%" r="80%">
          <stop offset="0" stopColor={UI_LIGHTING_COLORS.neutral} stopOpacity="0.08" />
          <stop offset="0.75" stopColor={UI_LIGHTING_COLORS.neutral} stopOpacity="0.015" />
          <stop offset="1" stopColor={UI_LIGHTING_COLORS.neutral} stopOpacity="0.07" />
        </radialGradient>
        <radialGradient id={`${id}-glow`}>
          <stop offset="0" stopColor={color} stopOpacity="0.7" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="41" fill={`url(#${id}-sphere)`} className="stroke-veil-subtle" strokeWidth="0.3" />
      {[0, 1, 2].map(axis => <polygon key={axis} points={polygon(Array.from({ length: 96 }, (_, i) => {
        const a = i * Math.PI / 48
        return axis === 0 ? { x: Math.cos(a), y: 0, z: Math.sin(a) }
          : axis === 1 ? { x: 0, y: Math.cos(a), z: Math.sin(a) } : { x: Math.cos(a), y: Math.sin(a), z: 0 }
      }))} fill="none" className="stroke-veil-subtle" strokeWidth="0.22" />)}
      {lights.filter(light => light.position.z < 0).map(lamp)}
      <g transform={matrix} data-relight-image-plane="true" data-image-aspect={size.width / size.height}>
        {sourceImage ? <foreignObject x={-size.width * 50} y={-size.height * 50} width={size.width * 100} height={size.height * 100}>
          <img src={sourceImage} alt={sourceAlt} draggable={false} className="block h-full w-full"
            style={{ filter: `brightness(${0.62 + frontIllumination * 0.55})` }}
            onLoad={event => { const image = event.currentTarget; if (image.naturalWidth && image.naturalHeight)
              setImageSize({ source: sourceImage, aspect: image.naturalWidth / image.naturalHeight }) }} />
        </foreignObject> : <rect x={-size.width * 50} y={-size.height * 50} width={size.width * 100} height={size.height * 100}
          className="fill-surface-dark stroke-veil-soft" strokeWidth="0.8" />}
      </g>
      {lights.filter(light => light.position.z >= 0).map(lamp)}
    </svg>
  )
}

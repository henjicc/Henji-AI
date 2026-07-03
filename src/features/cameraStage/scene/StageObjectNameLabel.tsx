import React, { useMemo, useRef } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Box3, Group, Vector3 } from 'three'
import type { StageNameLabelSettings, StageObject } from '../domain/sceneTypes'

interface StageObjectNameLabelProps {
  object: StageObject
  targetRef: React.RefObject<Group>
  settings: StageNameLabelSettings
}

function getLabelPadding(object: StageObject, boundsHeight: number): number {
  if (object.type === 'character') {
    return Math.max(0.28, boundsHeight * 0.16)
  }

  if (object.type === 'camera') {
    return Math.max(0.16, boundsHeight * 0.14)
  }

  return Math.max(0.18, boundsHeight * 0.14)
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function toRgba(hex: string, alpha: number): string {
  const normalized = hex.trim().replace('#', '')
  const safeAlpha = clamp01(alpha)

  if (/^[0-9a-fA-F]{3}$/.test(normalized)) {
    const r = Number.parseInt(normalized[0] + normalized[0], 16)
    const g = Number.parseInt(normalized[1] + normalized[1], 16)
    const b = Number.parseInt(normalized[2] + normalized[2], 16)
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
  }

  if (/^[0-9a-fA-F]{6}$/.test(normalized)) {
    const r = Number.parseInt(normalized.slice(0, 2), 16)
    const g = Number.parseInt(normalized.slice(2, 4), 16)
    const b = Number.parseInt(normalized.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`
  }

  return hex
}

const StageObjectNameLabel: React.FC<StageObjectNameLabelProps> = ({ object, targetRef, settings }) => {
  const anchorRef = useRef<Group>(null)
  const label = useMemo(() => object.name.trim(), [object.name])
  const bounds = useMemo(() => new Box3(), [])
  const worldCenter = useMemo(() => new Vector3(), [])
  const worldTop = useMemo(() => new Vector3(), [])
  const localPosition = useMemo(() => new Vector3(), [])
  const worldScale = useMemo(() => new Vector3(), [])
  const effectiveBackgroundColor = settings.followObjectColor ? object.color : settings.backgroundColor
  const backgroundColor = toRgba(effectiveBackgroundColor, settings.backgroundOpacity)
  const shadowColor = toRgba(settings.shadowColor, settings.shadowOpacity)
  const shadowRadians = settings.shadowAngle * (Math.PI / 180)
  const shadowOffsetX = Math.cos(shadowRadians) * settings.shadowDistance
  const shadowOffsetY = Math.sin(shadowRadians) * settings.shadowDistance
  const textShadow = `${shadowOffsetX.toFixed(2)}px ${shadowOffsetY.toFixed(2)}px ${settings.shadowBlur.toFixed(2)}px ${shadowColor}`

  useFrame(() => {
    const anchor = anchorRef.current
    const target = targetRef.current
    const parent = anchor?.parent
    if (!anchor || !target || !(parent instanceof Group)) return

    bounds.setFromObject(target)
    if (bounds.isEmpty()) return

    const height = Math.max(0.01, bounds.max.y - bounds.min.y)
    const padding = getLabelPadding(object, height)
    bounds.getCenter(worldCenter)
    worldTop.set(
      worldCenter.x + settings.offset.x,
      bounds.max.y + padding + settings.offset.y,
      worldCenter.z + settings.offset.z,
    )

    parent.worldToLocal(localPosition.copy(worldTop))
    anchor.position.copy(localPosition)

    parent.getWorldScale(worldScale)
    anchor.scale.set(
      Math.abs(worldScale.x) > 1e-4 ? 1 / worldScale.x : 1,
      Math.abs(worldScale.y) > 1e-4 ? 1 / worldScale.y : 1,
      Math.abs(worldScale.z) > 1e-4 ? 1 / worldScale.z : 1,
    )
  })

  if (!label) return null

  return (
    <group ref={anchorRef}>
      <Html
        center
        transform
        sprite
        distanceFactor={8}
        occlude={false}
        style={{ pointerEvents: 'none', userSelect: 'none' }}
      >
        <div
          className="rounded-md border border-border-dark px-2 py-1 text-xs font-medium shadow-lg shadow-black/20"
          style={{
            color: settings.textColor,
            backgroundColor,
            textShadow,
            transform: `scale(${settings.scale})`,
            transformOrigin: 'center center',
          }}
        >
          {label}
        </div>
      </Html>
    </group>
  )
}

export default StageObjectNameLabel

import React, { useEffect, useMemo } from 'react'
import { Grid } from '@react-three/drei'
import { CanvasTexture, Color, RepeatWrapping } from 'three'
import { WHITE_HEX } from '@/core/theme/colorTokens'
import type { StageGroundSettings } from '../domain/sceneTypes'

const GROUND_SIZE = 160

function colorToHex(color: Color): string {
  return `#${color.getHexString()}`
}

function createCheckerTexture(baseColor: string): CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const context = canvas.getContext('2d')
  const texture = new CanvasTexture(canvas)
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  if (!context) {
    return texture
  }

  const base = new Color(baseColor)
  const light = base.clone().offsetHSL(0, 0, 0.08)
  const dark = base.clone().offsetHSL(0, 0, -0.08)
  const half = canvas.width / 2

  context.fillStyle = colorToHex(light)
  context.fillRect(0, 0, half, half)
  context.fillRect(half, half, half, half)
  context.fillStyle = colorToHex(dark)
  context.fillRect(half, 0, half, half)
  context.fillRect(0, half, half, half)

  return texture
}

const StageGround: React.FC<{ settings: StageGroundSettings }> = ({ settings }) => {
  const texture = useMemo(
    () => (settings.pattern === 'checker' ? createCheckerTexture(settings.color) : null),
    [settings.color, settings.pattern],
  )

  useEffect(() => () => texture?.dispose(), [texture])

  useEffect(() => {
    if (!texture) return
    texture.repeat.set(settings.density, settings.density)
    texture.needsUpdate = true
  }, [settings.density, texture])

  const baseColor = useMemo(() => new Color(settings.color), [settings.color])
  const gridCellColor = useMemo(
    () => colorToHex(baseColor.clone().offsetHSL(0, 0, 0.06)),
    [baseColor],
  )
  const gridSectionColor = useMemo(
    () => colorToHex(baseColor.clone().offsetHSL(0, 0, 0.14)),
    [baseColor],
  )
  const gridCellSize = useMemo(() => Math.max(0.25, 4 / settings.density), [settings.density])

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        <meshStandardMaterial
          color={settings.pattern === 'checker' ? WHITE_HEX : settings.color}
          map={texture ?? undefined}
        />
      </mesh>
      {settings.pattern === 'grid' && (
        <Grid
          infiniteGrid
          position={[0, 0.001, 0]}
          cellSize={gridCellSize}
          sectionSize={gridCellSize * 5}
          cellColor={gridCellColor}
          sectionColor={gridSectionColor}
          fadeDistance={40}
        />
      )}
    </>
  )
}

export default StageGround

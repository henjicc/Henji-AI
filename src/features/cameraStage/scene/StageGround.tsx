import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import { Grid } from '@react-three/drei'
import { Color } from 'three'
import type { MeshStandardMaterial, Shader } from 'three'
import { BLACK_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import type { StageGroundSettings } from '../domain/sceneTypes'

const GROUND_SIZE = 160
const CHECKER_BASE_CELL = 2
const GRID_BASE_CELL = 2

interface CheckerShader extends Shader {
  uniforms: Shader['uniforms'] & {
    uCheckerScale: { value: number }
    uCheckerDark: { value: [number, number, number] }
    uCheckerLight: { value: [number, number, number] }
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '')
  const int = Number.parseInt(normalized, 16)
  return [
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255,
  ]
}

const StageGround: React.FC<{ settings: StageGroundSettings }> = ({ settings }) => {
  const checkerShaderRef = useRef<CheckerShader | null>(null)
  const checkerMaterialRef = useRef<MeshStandardMaterial>(null)

  const checkerScale = useMemo(() => settings.density / CHECKER_BASE_CELL, [settings.density])
  const gridCellSize = useMemo(() => Math.max(0.04, GRID_BASE_CELL / settings.density), [settings.density])
  const checkerDark = useMemo(() => hexToRgb(BLACK_HEX), [])
  const checkerLight = useMemo(() => hexToRgb(WHITE_HEX), [])
  const gridBaseColor = useMemo(() => new Color(settings.color), [settings.color])
  const gridCellColor = useMemo(
    () => `#${gridBaseColor.clone().offsetHSL(0, 0, 0.06).getHexString()}`,
    [gridBaseColor],
  )
  const gridSectionColor = useMemo(
    () => `#${gridBaseColor.clone().offsetHSL(0, 0, 0.14).getHexString()}`,
    [gridBaseColor],
  )

  const handleCheckerCompile = useCallback(
    (shader: Shader): void => {
      const checkerShader = shader as CheckerShader
      checkerShader.uniforms.uCheckerScale = { value: checkerScale }
      checkerShader.uniforms.uCheckerDark = { value: checkerDark }
      checkerShader.uniforms.uCheckerLight = { value: checkerLight }

      checkerShader.vertexShader = `
        varying vec3 vWorldPosition;
      ${checkerShader.vertexShader}`.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWorldPosition = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`,
      )

      checkerShader.fragmentShader = `
        varying vec3 vWorldPosition;
        uniform float uCheckerScale;
        uniform vec3 uCheckerDark;
        uniform vec3 uCheckerLight;
      ${checkerShader.fragmentShader}`.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `
          float checker = mod(
            floor(vWorldPosition.x * uCheckerScale) + floor(vWorldPosition.z * uCheckerScale),
            2.0
          );
          vec3 checkerColor = mix(uCheckerDark, uCheckerLight, checker);
          vec4 diffuseColor = vec4(checkerColor, opacity);
        `,
      )

      checkerShaderRef.current = checkerShader
    },
    [checkerDark, checkerLight, checkerScale],
  )

  useEffect(() => {
    const checkerShader = checkerShaderRef.current
    if (!checkerShader) return
    checkerShader.uniforms.uCheckerScale.value = checkerScale
  }, [checkerScale])

  useEffect(() => {
    if (settings.pattern !== 'checker') {
      checkerShaderRef.current = null
      return
    }
    if (!checkerMaterialRef.current) return
    checkerMaterialRef.current.needsUpdate = true
  }, [settings.pattern])

  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
        {settings.pattern === 'checker' ? (
          <meshStandardMaterial
            ref={checkerMaterialRef}
            color={WHITE_HEX}
            onBeforeCompile={handleCheckerCompile}
            customProgramCacheKey={() => 'camera-stage-checker-ground'}
          />
        ) : (
          <meshStandardMaterial color={settings.color} />
        )}
      </mesh>
      {settings.pattern === 'grid' && (
        <Grid
          infiniteGrid
          position={[0, 0.001, 0]}
          cellSize={gridCellSize}
          sectionSize={gridCellSize * 5}
          cellColor={gridCellColor}
          sectionColor={gridSectionColor}
          cellThickness={0.6}
          sectionThickness={1.1}
          fadeDistance={46}
          fadeStrength={1.3}
        />
      )}
    </>
  )
}

export default StageGround

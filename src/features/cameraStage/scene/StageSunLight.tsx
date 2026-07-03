import React, { useMemo } from 'react'
import { Color } from 'three'
import { CAMERA_STAGE_COLOR_HEX } from '@/core/theme/colorTokens'
import type { StageSceneSettings } from '../domain/sceneTypes'

function colorToHex(color: Color): string {
  return `#${color.getHexString()}`
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

const StageSunLight: React.FC<{ settings: StageSceneSettings }> = ({ settings }) => {
  const { ground, sky, sunlight } = settings

  const lighting = useMemo(() => {
    const time = ((sunlight.timeOfDay % 24) + 24) % 24
    const daylight = clamp01(Math.sin(((time - 6) / 12) * Math.PI))
    const noonFactor = clamp01(1 - Math.abs(time - 12) / 4)
    const warmFactor = daylight * (1 - noonFactor)

    const nightColor = new Color(CAMERA_STAGE_COLOR_HEX.sunlightNight)
    const warmColor = new Color(CAMERA_STAGE_COLOR_HEX.sunlightWarm)
    const noonColor = new Color(CAMERA_STAGE_COLOR_HEX.sunlightNoon)
    const sunColor = nightColor.clone().lerp(warmColor, daylight).lerp(noonColor, noonFactor)

    const orbit = ((time - 6) / 12) * Math.PI
    const distance = 14
    const height = Math.max(0.8, 1 + daylight * 11)

    return {
      directionalColor: colorToHex(sunColor),
      directionalIntensity: sunlight.enabled ? sunlight.intensity * (0.12 + daylight * 1.05) : 0,
      ambientIntensity: 0.16 + (sunlight.enabled ? sunlight.intensity * (0.1 + daylight * 0.14) : 0),
      hemisphereIntensity: 0.28 + (sunlight.enabled ? sunlight.intensity * (0.08 + daylight * 0.22) : 0),
      skyColor: colorToHex(new Color(sky.color).clone().offsetHSL(0, 0, warmFactor * 0.04)),
      groundColor: colorToHex(new Color(ground.color).clone().offsetHSL(0, 0, -0.02)),
      position: [Math.cos(orbit) * distance, height, Math.sin(orbit) * distance] as [number, number, number],
    }
  }, [ground.color, sky.color, sunlight.enabled, sunlight.intensity, sunlight.timeOfDay])

  return (
    <>
      <ambientLight intensity={lighting.ambientIntensity} />
      <hemisphereLight
        args={[lighting.skyColor, lighting.groundColor, lighting.hemisphereIntensity]}
      />
      {sunlight.enabled && (
        <directionalLight
          position={lighting.position}
          intensity={lighting.directionalIntensity}
          color={lighting.directionalColor}
        />
      )}
    </>
  )
}

export default StageSunLight

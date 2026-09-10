import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { UiButton } from '@/components/ui'
import type { MultiAngleDiscretePreset } from '@/features/canvas/capabilities/multiAnglePolicy'
import { multiAngleDirectionGeometry, type MultiAngleOrientation } from './multiAngleOrbitGeometry'
import { translateMultiAngleViewLabel } from './multiAngleLocalization'

export const MultiAngleViewNavigator = memo(function MultiAngleViewNavigator({
  selectedPreset, onSelect, block, pose,
}: {
  selectedPreset: MultiAngleDiscretePreset
  onSelect: (preset: MultiAngleDiscretePreset) => void
  block: { width: number; height: number; depth: number }
  pose: MultiAngleOrientation
}): JSX.Element {
  const { t } = useTranslation()
  const directions = useMemo(() => multiAngleDirectionGeometry(block, pose), [block, pose])
  return (
    <g data-multi-angle-navigator="true">
      {directions.map(({ view, x, y, depth, size, opacity, occluded }) => {
        const active = selectedPreset === view.preset
        const label = translateMultiAngleViewLabel(t, view)
        return (
          <foreignObject key={view.preset} x={x - 3} y={y - 3} width="6" height="6"
            visibility={occluded ? 'hidden' : 'visible'} data-direction-depth={depth}>
            <UiButton
              type="button" variant="plain" aria-label={label} aria-pressed={active} title={label}
              tabIndex={occluded ? -1 : 0}
              data-multi-angle-direction={view.preset}
              className="group/direction pointer-events-auto !flex !h-full !w-full !rounded-full !border-0 !bg-transparent !p-0"
              onPointerDown={event => { if (!active) event.stopPropagation() }}
              onKeyDown={event => event.stopPropagation()}
              onClick={event => { event.stopPropagation(); onSelect(view.preset) }}
            >
              <span aria-hidden="true"
                className={`relative block rounded-full bg-gradient-to-br group-hover/direction:brightness-125 ${active
                  ? 'from-text via-accent to-accent'
                  : 'from-text via-text-muted to-bg-dark'}`}
                style={{ width: `${size / 6 * 100}%`, height: `${size / 6 * 100}%`, opacity }}>
                <span className="absolute left-1/4 top-1/4 h-1/4 w-1/4 rounded-full bg-text/70" />
              </span>
            </UiButton>
          </foreignObject>
        )
      })}
    </g>
  )
})

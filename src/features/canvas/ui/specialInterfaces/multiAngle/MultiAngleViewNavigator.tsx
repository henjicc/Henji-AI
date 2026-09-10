import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { UiButton } from '@/components/ui'
import { MULTI_ANGLE_DISCRETE_VIEW_PRESETS, type MultiAngleDiscretePreset } from '@/features/canvas/capabilities/multiAnglePolicy'
import { multiAngleOrientation, orientationVector, rotateImageBlock } from './multiAngleOrbitGeometry'
import { translateMultiAngleViewLabel } from './multiAngleLocalization'

// A fixed oblique projection keeps front/back distinct and targets stationary while dragging.
// Compute once; the navigator only changes when the nearest of the nine directions changes.
const DIRECTIONS = MULTI_ANGLE_DISCRETE_VIEW_PRESETS.map(({ view }) => {
  const [x, y, depth] = rotateImageBlock(orientationVector(multiAngleOrientation(view)), { azimuth: 35, elevation: 25 })
  return { view, x: 50 + x * 43, y: 50 - y * 43, depth, size: 12 + depth * 3 }
})

export const MultiAngleViewNavigator = memo(function MultiAngleViewNavigator({
  selectedPreset,
  onSelect,
}: {
  selectedPreset: MultiAngleDiscretePreset
  onSelect: (preset: MultiAngleDiscretePreset) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="pointer-events-none absolute inset-0" data-multi-angle-navigator="true">
      {DIRECTIONS.map(({ view, x, y, depth, size }) => {
        const active = selectedPreset === view.preset
        const label = translateMultiAngleViewLabel(t, view)
        return (
          <UiButton
            key={view.preset}
            type="button"
            variant="ghost"
            aria-label={label}
            aria-pressed={active}
            title={label}
            data-multi-angle-direction={view.preset}
            className="group/direction pointer-events-auto absolute !h-9 !w-9 -translate-x-1/2 -translate-y-1/2 !rounded-full !p-0 hover:!bg-transparent"
            style={{ left: `${x}%`, top: `${y}%`, zIndex: depth > 0 ? 2 : 1 }}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onSelect(view.preset) }}
          >
            <span
              aria-hidden="true"
              className={`relative block rounded-full border bg-gradient-to-br shadow-sm ${active
                ? 'border-accent from-text via-accent to-accent ring-4 ring-accent/20'
                : `border-veil-strong from-text/90 via-text-muted to-bg-dark group-hover/direction:ring-4 group-hover/direction:ring-veil-subtle ${depth < 0 ? 'opacity-50' : 'opacity-90'}`}`}
              style={{ width: size, height: size }}
            >
              <span className="absolute left-1/4 top-1/4 h-1/4 w-1/4 rounded-full bg-text/70" />
            </span>
            <span className={`pointer-events-none absolute top-full mt-0.5 whitespace-nowrap rounded-md bg-bg-dark/90 px-2 py-1 text-xs ${active ? 'text-text' : 'invisible text-text-soft group-hover/direction:visible group-focus-visible/direction:visible'}`}>
              {label}
            </span>
          </UiButton>
        )
      })}
    </div>
  )
})

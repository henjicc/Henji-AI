interface CanvasEmptyHintProps {
  title: string
  subtitle: string
}

export function CanvasEmptyHint({ title, subtitle }: CanvasEmptyHintProps): JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center">
        <div className={`mb-2 ${UI_TEXT_TITLE_CLASS}`}>{title}</div>
        <div className={`${UI_TEXT_META_CLASS} opacity-60`}>{subtitle}</div>
      </div>
    </div>
  )
}
import { UI_TEXT_META_CLASS, UI_TEXT_TITLE_CLASS } from '@/components/ui'

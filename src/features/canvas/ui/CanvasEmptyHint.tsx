interface CanvasEmptyHintProps {
  title: string
  subtitle: string
}

export function CanvasEmptyHint({ title, subtitle }: CanvasEmptyHintProps): JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="text-center">
        <div className={`mb-2 ${UI_TEXT_TITLE_CLASS}`}>{title}</div>
        {/* 不再叠 opacity：辅助文字令牌本身已按 4.5:1 求解，再淡化就不可读（4.1） */}
        <div className={UI_TEXT_META_CLASS}>{subtitle}</div>
      </div>
    </div>
  )
}
import { UI_TEXT_META_CLASS, UI_TEXT_TITLE_CLASS } from '@/components/ui'

import { UiEmpty } from '@/components/ui'

interface CanvasEmptyHintProps {
  title: string
  subtitle: string
}

/** 空画布提示：统一空状态组件，悬在画布中央、不拦截画布操作。 */
export function CanvasEmptyHint({ title, subtitle }: CanvasEmptyHintProps): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <UiEmpty title={title} description={subtitle} />
    </div>
  )
}

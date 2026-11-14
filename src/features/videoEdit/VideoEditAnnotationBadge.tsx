import { videoEditAnnotationFillClass } from './videoEditAnnotationPalette'

const SIZE_CLASS = { md: 'h-5 w-5 text-2xs', sm: 'h-4 w-4 text-3xs' } as const

/**
 * 批注序号徽标：列表、画面标签、时间线标尺上同一条批注同一个颜色与序号，靠它把三处对上。
 * 轮换色都是中高亮度，序号一律用深色字。
 */
export function VideoEditAnnotationBadge({ number, size = 'md', muted }: { number: number; size?: keyof typeof SIZE_CLASS; muted?: boolean }): React.ReactElement {
  return <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none tabular-nums text-annotation-ink ${SIZE_CLASS[size]} ${videoEditAnnotationFillClass(number)} ${muted ? 'opacity-50' : ''}`}>{number}</span>
}

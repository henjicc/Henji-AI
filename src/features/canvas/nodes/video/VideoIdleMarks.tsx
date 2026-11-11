import { Play } from 'lucide-react'
import { UiIconButton } from '@/components/ui'
import { useTranslation } from 'react-i18next'
import { formatVideoTime } from './formatVideoTime'

/**
 * 视频节点没在播放时的记号：画面中央一个圆形播放键、右下角时长，和生成页、资产库的视频一个样，
 * 画布缩小后也一眼认得出是视频。播放键点了就在节点里播放；悬停出底栏后时长让给底栏里的时间读数。
 */
export function VideoIdleMarks({ durationSec, onPlay, hideDurationOnHover }: {
  durationSec: number | null | undefined
  onPlay: () => void
  /** 播放器悬停会出底栏（含时间读数）：悬停时把右下时长藏起来，免得两处时间叠在一起。 */
  hideDurationOnHover?: boolean
}): JSX.Element {
  const { t } = useTranslation()
  const hideClass = hideDurationOnHover ? 'group-hover/player:opacity-0' : ''
  return (
    <>
      <UiIconButton
        size="xl"
        tone="media"
        shape="circle"
        aria-label={t('node.videoNode.play')}
        className="nodrag nowheel absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          onPlay()
        }}
      >
        <Play />
      </UiIconButton>
      {typeof durationSec === 'number' && durationSec > 0 && (
        <span className={`pointer-events-none absolute bottom-2 right-2 rounded-control bg-media-scrim px-1.5 py-0.5 text-2xs tabular-nums text-on-media transition-opacity duration-120 ${hideClass}`}>
          {formatVideoTime(durationSec)}
        </span>
      )}
    </>
  )
}

import { useSyncExternalStore } from 'react'
import { videoEditSafeArea } from '@/core/videoEdit/safeMargins'
import { subscribeVideoEdit } from './application/videoEditService'
import { videoEditSafeMarginsVisible } from './application/videoEditSafeMargins'

/**
 * 监视器上的安全框：动作安全区、字幕与图形安全区两个框加画面中心十字。铺满画面盒子（盒子就是合成画面的显示区域，
 * 缩放与留黑都已算进去），线宽按屏幕像素固定，不挡指针。像 PR 一样是白色细线，底下垫一道深色描边，白底黑底都看得清。
 */
export function VideoEditSafeMarginsOverlay(): React.ReactElement | null {
  const shown = useSyncExternalStore(subscribeVideoEdit, videoEditSafeMarginsVisible)
  if (!shown) return null
  const rect = (kind: 'action' | 'title') => { const area = videoEditSafeArea(kind); return { x: area.x * 1000, y: area.y * 1000, width: area.width * 1000, height: area.height * 1000 } }
  const guides = (className: string, strokeWidth: number, marked: boolean) => <g fill="none" className={className} strokeWidth={strokeWidth}>
    <rect {...rect('action')} vectorEffect="non-scaling-stroke" data-video-edit-safe-margin={marked ? 'action' : undefined} />
    <rect {...rect('title')} vectorEffect="non-scaling-stroke" data-video-edit-safe-margin={marked ? 'title' : undefined} />
    <path d="M 485 500 H 515 M 500 485 V 515" vectorEffect="non-scaling-stroke" />
  </g>
  // icon-token-allow: 安全框是按画面比例计算的辅助线，不是图标
  return <svg aria-hidden="true" data-video-edit-safe-margins className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
    {guides('stroke-media-scrim', 3, false)}
    {guides('stroke-on-media/80', 1, true)}
  </svg>
}

import React, { useEffect } from 'react'
import { UI_GLASS_ADAPTIVE_DIVIDER_CLASS, UI_GLASS_ADAPTIVE_REGION_CLASS, UI_TEXT_TITLE_CLASS, UiIconButton, UiLoading, UiModal } from '@/components/ui'
import { X } from 'lucide-react'
import { useI18n } from '@/hooks/useI18n'
import { setSettingsPlaceholderShown } from './settingsPlaceholderState'

/**
 * 设置弹窗外壳：真弹窗与懒加载占位共用，保证两者外观一致、交接时不跳。
 *
 * 设置面板整棵子树是懒加载的。首次打开时 chunk 还没取回（开发态冷启动要现场转译几十个模块，
 * 要好几秒），以前 Suspense 的占位是 null：点了没反应，等弹出来时进入动画早已错过。
 * 现在占位直接渲染这个外壳并播进入动画，真弹窗挂载时以 appear={false} 接替，不再淡入第二次。
 */
export function SettingsModalFrame({ isOpen, onClose, appear, children, surfaceId }: {
  isOpen: boolean
  onClose: () => void
  appear?: boolean
  children: React.ReactNode
  surfaceId?: string
}): React.JSX.Element {
  const { t } = useI18n('settings')
  return (
    <UiModal
      isOpen={isOpen}
      title={t('title')}
      onClose={onClose}
      hideHeader
      appear={appear}
      // 设置弹窗铺满 90vw，背后压着的是画布/生成结果这类用户内容而不是纯色 UI，
      // 所以整块走玻璃；内部区域、目录与中性控件由 UI_GLASS_ADAPTIVE_* 跟随开关退化。
      surface="glass"
      // 只给内边距，不要在这里再铺一层底色：UiModal 内部已经有一层会做淡入淡出的
      // 遮罩，外层再叠 bg-black/70 会（1）把背景压到近 86% 黑，(2) 因为外层没有过渡，
      // 打开时先闪一帧纯黑、关闭时黑幕又突然消失。
      overlayClassName="p-4"
      size="settings"
      contentPadding="none" contentScroll="none" contentClassName="flex min-h-0 flex-1"
    >
      {/* relative：让内容压在 .ui-glass::after 的噪点层同一层，避免文字被颗粒扰动 */}
      <div data-application-surface-id={surfaceId} className={`relative flex h-full w-full flex-col ${UI_GLASS_ADAPTIVE_REGION_CLASS}`}>
        <div className={`flex h-14 shrink-0 items-center justify-between border-b px-4 ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`}>
          <h2 className={UI_TEXT_TITLE_CLASS}>{t('title')}</h2>
          <UiIconButton onClick={onClose} aria-label={t('actions.close')} tooltip={t('actions.close')}>
            <X  />
          </UiIconButton>
        </div>
        {children}
      </div>
    </UiModal>
  )
}

/** 懒加载期间的占位：外壳 + 加载状态。关闭按钮直接卸载（还没有内容可收起）。 */
export function SettingsModalPlaceholder({ onClose }: { onClose: () => void }): React.JSX.Element {
  // 真弹窗在交接那次渲染里读取标记，早于这里的清理；中途关掉占位时清理保证下次打开照常播进入动画
  useEffect(() => {
    setSettingsPlaceholderShown(true)
    return () => setSettingsPlaceholderShown(false)
  }, [])
  return (
    <SettingsModalFrame isOpen onClose={onClose}>
      <div className="flex min-h-0 flex-1 items-center justify-center"><UiLoading size="sm" /></div>
    </SettingsModalFrame>
  )
}

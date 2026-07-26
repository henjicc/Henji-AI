import React, { useEffect, useRef, useState } from 'react'
import { UI_FIELD_CONTROL_HEIGHT_CLASS, UI_TEXT_TITLE_CLASS, UiButton, UiIconButton, UiModal, UiNavButton } from '@/components/ui'
import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion'
import { KeyRound, LayoutGrid, Settings2, SlidersHorizontal } from 'lucide-react'
import GeneralTab from './tabs/GeneralTab'
import ApiKeysTab from './tabs/ApiKeysTab'
import InterfaceTab from './tabs/InterfaceTab'
import ModelsTab from './tabs/ModelsTab'
import { useI18n } from '@/hooks/useI18n'
import type { SettingsNavigationTarget, SettingsTabId } from '@/core/types/settingsNavigation'

interface SettingsModalProps {
  onClose: () => void
  /** 由 uiStore 传入的定位目标（如错误弹窗「去设置」直达平台密钥）；省略则用默认分节 */
  target?: SettingsNavigationTarget | null
}

type SettingsTab = SettingsTabId
type SettingsSection = { id: string; label: string }

// 静态导航结构，提到模块作用域后初始 state 可以直接查表定位到目标分节
const SECTION_MAP: Record<SettingsTab, SettingsSection[]> = {
  general: [
    { id: 'general-basic', label: '基础设置' },
    { id: 'general-storage', label: '数据与下载' },
    { id: 'general-behavior', label: '行为与并发' },
    { id: 'general-maintenance', label: '更新维护' }
  ],
  api: [
    { id: 'api-keys', label: '平台密钥' },
    { id: 'api-upload', label: '上传策略' },
    { id: 'api-llm', label: '大语言模型' },
    { id: 'api-agent-preferences', label: '助手用户指令' }
  ],
  interface: [
    { id: 'interface-layout', label: '布局行为' },
    { id: 'interface-assets', label: '资产库' },
    { id: 'interface-canvas', label: '画布' },
    { id: 'interface-theme', label: '主题外观' }
  ],
  models: [
    { id: 'models-visibility', label: '显示与管理' }
  ]
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, target }) => {
  const { t } = useI18n('settings')
  const initialTab: SettingsTab = target?.tab ?? 'general'
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab)
  const [activeSectionId, setActiveSectionId] = useState<string>(
    target?.sectionId ?? SECTION_MAP[initialTab][0]?.id ?? ''
  )
  const [closing, setClosing] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)

  // 关闭分两步：先让 UiModal 播完淡出，再由 App 卸载本组件。
  // 等待时长必须跟着 UiModal 的过渡走，此前写死 300ms 比实际过渡长 120ms，
  // 那段时间里弹窗已经全透明却还占着 DOM。
  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, UI_DIALOG_TRANSITION_MS)
  }

  const tabs = [
    { id: 'general' as const, label: t('tabs.general.label'), icon: Settings2, component: GeneralTab },
    { id: 'api' as const, label: t('tabs.api.label'), icon: KeyRound, component: ApiKeysTab },
    { id: 'interface' as const, label: t('tabs.interface.label'), icon: LayoutGrid, component: InterfaceTab },
    { id: 'models' as const, label: t('tabs.models.label'), icon: SlidersHorizontal, component: ModelsTab }
  ]

  const ActiveTabComponent = tabs.find(t => t.id === activeTab)?.component
  const activeSections = SECTION_MAP[activeTab]

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = 0
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab, activeSectionId])

  const handleTabSelect = (tabId: SettingsTab): void => {
    setActiveTab(tabId)
    setActiveSectionId(SECTION_MAP[tabId][0]?.id ?? '')
  }

  const handleSectionSelect = (sectionId: string): void => {
    setActiveSectionId(sectionId)
  }

  return (
    <UiModal
      isOpen={!closing}
      title={t('title')}
      onClose={handleClose}
      hideHeader
      // 只给内边距，不要在这里再铺一层底色：UiModal 内部已经有一层会做淡入淡出的
      // 遮罩，外层再叠 bg-black/70 会（1）把背景压到近 86% 黑，(2) 因为外层没有过渡，
      // 打开时先闪一帧纯黑、关闭时黑幕又突然消失。
      overlayClassName="p-4"
      widthClassName="flex w-[min(90vw,1200px)] overflow-hidden"
      contentClassName="flex min-h-0 flex-1"
    >
      <div
        className="flex w-full"
        style={{ height: '76vh', minHeight: '500px', maxHeight: '940px' }}
      >
        <div className="flex w-[156px] flex-col border-r border-border-dark bg-app">
          {/* 这一格原先是纯占位（只有边框没有内容），弹窗又用了 hideHeader，
              结果整个设置面板没有标题、左上角是个突兀的空格子。 */}
          <div className={`flex h-[58px] items-center border-b border-border-dark px-4 ${UI_TEXT_TITLE_CLASS}`}>
            {t('title')}
          </div>
          <div className="flex-1 py-3">
            {tabs.map(tab => (
                <UiNavButton
                  key={tab.id}
                  active={activeTab === tab.id}
                  onClick={() => handleTabSelect(tab.id)}
                >
                <tab.icon className="h-[18px] w-[18px] shrink-0" />
                <span className="ml-3 font-medium text-15 leading-none text-left">{tab.label}</span>
              </UiNavButton>
            ))}
          </div>
        </div>

        <div className="flex h-full flex-1 flex-col bg-app">
          <div className="flex h-[58px] items-center justify-end border-b border-border-dark bg-app px-3">
            <UiIconButton
              onClick={handleClose}
              aria-label={t('actions.close')}
              showBorder={false}
              appearance="hover-only"
              className="!h-9 !w-9 rounded-lg text-text-soft hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </UiIconButton>
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="w-[190px] border-r border-border-dark bg-app py-3">
              <div className="space-y-1.5">
                {activeSections.map(section => (
                  <UiNavButton
                    key={section.id}
                    active={activeSectionId === section.id}
                    onClick={() => handleSectionSelect(section.id)}
                    className="!h-10 !px-3 !gap-0 text-sm"
                  >
                    {section.label}
                  </UiNavButton>
                ))}
              </div>
            </div>

            <div ref={contentRef} className="settings-scroll-body flex-1 overflow-y-auto bg-app">
              {ActiveTabComponent && <ActiveTabComponent sectionId={activeSectionId} />}
            </div>
          </div>

          <div className="flex justify-end border-t border-border-dark bg-app px-5 py-4">
            <UiButton
              onClick={handleClose}
              variant="primary"
              size="sm"
              className={`${UI_FIELD_CONTROL_HEIGHT_CLASS} px-5 text-base font-medium`}
            >
              {t('actions.close')}
            </UiButton>
          </div>
        </div>
      </div>
    </UiModal>
  )
}

export default SettingsModal

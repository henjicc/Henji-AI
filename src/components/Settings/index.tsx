import React, { useEffect, useRef, useState } from 'react'
import { UiButton, UiIconButton, UiNavButton } from '@/components/ui'
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

  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, 300)
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
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`flex w-[min(90vw,1200px)] scale-100 transform overflow-hidden rounded-2xl border border-border-dark bg-panel shadow-2xl transition-all duration-300 ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
        style={{ height: '76vh', minHeight: '500px', maxHeight: '940px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex w-[156px] flex-col border-r border-border-dark bg-app">
          <div className="h-[58px] border-b border-border-dark" />
          <div className="flex-1 py-3">
            {tabs.map(tab => (
                <UiNavButton
                  key={tab.id}
                  active={activeTab === tab.id}
                  onClick={() => handleTabSelect(tab.id)}
                >
                <tab.icon className="h-[18px] w-[18px] shrink-0" />
                <span className="ml-3 font-medium text-[15px] leading-none text-left">{tab.label}</span>
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
              className="!h-9 !w-9 rounded-lg text-zinc-300 hover:text-white"
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
              className="h-[42px] px-5 text-[16px] font-medium shadow-lg"
            >
              {t('actions.close')}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { UiButton, UiIconButton, UiNavButton } from '@/components/ui'
import { KeyRound, LayoutGrid, Settings2, SlidersHorizontal } from 'lucide-react'
import GeneralTab from './tabs/GeneralTab'
import ApiKeysTab from './tabs/ApiKeysTab'
import InterfaceTab from './tabs/InterfaceTab'
import ModelsTab from './tabs/ModelsTab'
import { useI18n } from '@/hooks/useI18n'

interface SettingsModalProps {
  onClose: () => void
}

type SettingsTab = 'general' | 'api' | 'interface' | 'models'
type SettingsSection = { id: string; label: string }

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { t } = useI18n('settings')
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [activeSectionId, setActiveSectionId] = useState<string>('general-basic')
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
  const sectionMap = useMemo<Record<SettingsTab, SettingsSection[]>>(() => ({
    general: [
      { id: 'general-basic', label: '基础设置' },
      { id: 'general-storage', label: '数据与下载' },
      { id: 'general-behavior', label: '行为与并发' },
      { id: 'general-maintenance', label: '更新维护' }
    ],
    api: [
      { id: 'api-keys', label: '平台密钥' },
      { id: 'api-upload', label: '上传策略' }
    ],
    interface: [
      { id: 'interface-layout', label: '布局行为' },
      { id: 'interface-theme', label: '主题外观' }
    ],
    models: [
      { id: 'models-visibility', label: '显示与管理' }
    ]
  }), [])

  const activeSections = sectionMap[activeTab]

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = 0
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab, activeSectionId])

  useEffect(() => {
    setActiveSectionId(activeSections[0]?.id ?? '')
  }, [activeSections])

  const handleSectionSelect = (sectionId: string): void => {
    setActiveSectionId(sectionId)
  }

  return (
    <div
      className={`fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-panel/95 backdrop-blur-xl border border-zinc-700/50 rounded-2xl w-[min(92vw,1320px)] shadow-2xl transform transition-all duration-300 scale-100 flex overflow-hidden ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
        style={{ height: '76vh', minHeight: '500px', maxHeight: '940px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-[156px] bg-zinc-950/58 border-r border-zinc-700/45 flex flex-col">
          <div className="h-[58px] border-b border-zinc-700/45" />
          <div className="flex-1 py-3">
            {tabs.map(tab => (
              <UiNavButton
                key={tab.id}
                active={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                <tab.icon className="h-[18px] w-[18px] shrink-0 opacity-90" />
                <span className="ml-3 font-medium text-[15px] leading-none text-left">{tab.label}</span>
              </UiNavButton>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col h-full">
          <div className="h-[58px] border-b border-zinc-700/45 bg-zinc-900/20 px-3 flex items-center justify-end">
            <UiIconButton
              onClick={handleClose}
              aria-label={t('actions.close')}
              showBorder={false}
              className="!h-9 !w-9 rounded-lg border border-transparent bg-transparent text-zinc-400 hover:border-zinc-700/45 hover:bg-zinc-900/45 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </UiIconButton>
          </div>

          <div className="flex-1 min-h-0 flex">
            <div className="w-[190px] border-r border-zinc-700/45 p-3">
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

            <div ref={contentRef} className="flex-1 overflow-y-auto settings-scroll-body">
              {ActiveTabComponent && <ActiveTabComponent sectionId={activeSectionId} />}
            </div>
          </div>

          <div className="px-5 py-4 border-t border-zinc-700/45 bg-zinc-900/20 flex justify-end">
            <UiButton
              onClick={handleClose}
              variant="primary"
              size="sm"
              className="h-12 px-8 text-base shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30"
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


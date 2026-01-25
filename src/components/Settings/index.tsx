import React, { useEffect, useRef, useState } from 'react'
import GeneralTab from './tabs/GeneralTab'
import ApiKeysTab from './tabs/ApiKeysTab'
import InterfaceTab from './tabs/InterfaceTab'
import ModelsTab from './tabs/ModelsTab'
import { useI18n } from '@/hooks/useI18n'

interface SettingsModalProps {
  onClose: () => void
}

type SettingsTab = 'general' | 'api' | 'interface' | 'models'

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const { t } = useI18n('settings')
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [closing, setClosing] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)

  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, 300)
  }

  const tabs = [
    { id: 'general' as const, label: t('tabs.general.label'), component: GeneralTab },
    { id: 'api' as const, label: t('tabs.api.label'), component: ApiKeysTab },
    { id: 'interface' as const, label: t('tabs.interface.label'), component: InterfaceTab },
    { id: 'models' as const, label: t('tabs.models.label'), component: ModelsTab }
  ]

  const ActiveTabComponent = tabs.find(t => t.id === activeTab)?.component

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop = 0
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [activeTab])

  return (
    <div
      className={`fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 ${closing ? 'animate-fade-out' : 'animate-fade-in'}`}
      onClick={handleClose}
    >
      <div
        className={`bg-[#131313]/95 backdrop-blur-xl border border-zinc-700/50 rounded-2xl w-full max-w-4xl shadow-2xl transform transition-all duration-300 scale-100 flex overflow-hidden ${closing ? 'animate-scale-out' : 'animate-scale-in'}`}
        style={{ height: '70vh', minHeight: '450px', maxHeight: '900px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-56 bg-zinc-900/50 border-r border-zinc-700/50 flex flex-col">
          <div className="p-4 border-b border-zinc-700/50">
            <h2 className="text-lg font-bold text-[#007eff]">{t('title')}</h2>
          </div>
          <div className="flex-1 py-3 space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`w-full px-4 py-2.5 flex items-center space-x-3 transition-colors duration-200 ${
                  activeTab === tab.id
                    ? 'bg-[#007eff]/10 text-[#007eff] border-r-2 border-[#007eff]'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="font-medium text-sm">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 flex flex-col h-full">
          <div className="p-4 border-b border-zinc-700/50 flex justify-between items-center bg-zinc-900/20">
            <h3 className="text-base font-medium text-white">
              {tabs.find(tab => tab.id === activeTab)?.label}
            </h3>
            <button
              onClick={handleClose}
              aria-label={t('actions.close')}
              className="text-zinc-400 hover:text-white transition-colors duration-200 p-1 rounded-full hover:bg-zinc-800/50"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={contentRef} className="flex-1 overflow-y-auto settings-scroll-body">
            {ActiveTabComponent && <ActiveTabComponent />}
          </div>

          <div className="p-4 border-t border-zinc-700/50 bg-zinc-900/20 flex justify-end">
            <button
              onClick={handleClose}
              className="px-6 py-2 bg-[#007eff] hover:bg-[#006add] text-white shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 rounded-lg transition-all duration-300 font-medium text-sm"
            >
              {t('actions.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal

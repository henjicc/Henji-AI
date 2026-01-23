import React, { useState, useRef } from 'react'
import GeneralTab from './tabs/GeneralTab'
import ApiKeysTab from './tabs/ApiKeysTab'
import InterfaceTab from './tabs/InterfaceTab'
import ModelsTab from './tabs/ModelsTab'

interface SettingsModalProps {
  onClose: () => void
}

type SettingsTab = 'general' | 'api' | 'interface' | 'models'

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [closing, setClosing] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const handleClose = () => {
    setClosing(true)
    setTimeout(onClose, 180)
  }

  const tabs = [
    { id: 'general' as const, label: '通用', component: GeneralTab },
    { id: 'api' as const, label: 'API 密钥', component: ApiKeysTab },
    { id: 'interface' as const, label: '界面', component: InterfaceTab },
    { id: 'models' as const, label: '模型', component: ModelsTab }
  ]

  const ActiveTabComponent = tabs.find(t => t.id === activeTab)?.component

  return (
    <div
      className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 ${closing ? 'animate-fadeOut' : 'animate-fadeIn'}`}
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        className={`bg-zinc-900 rounded-lg shadow-xl w-full max-w-3xl max-h-[80vh] overflow-hidden ${closing ? 'animate-scaleOut' : 'animate-scaleIn'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-zinc-800">
          <h2 className="text-xl font-semibold text-white">设置</h2>
          <button
            onClick={handleClose}
            className="text-zinc-400 hover:text-white transition-colors text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="flex">
          <div className="w-48 border-r border-zinc-800 bg-zinc-900/50">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`w-full text-left px-6 py-3 transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto max-h-[calc(80vh-80px)]">
            {ActiveTabComponent && <ActiveTabComponent />}
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal

import React from 'react'
import { useI18n } from '@/hooks/useI18n'

/**
 * 画布工作区占位组件
 */
const NodeEditorPlaceholder: React.FC = () => {
    const { t } = useI18n('ui')
    return (
        <div className="flex-1 flex items-center justify-center h-full bg-[#0a0a0a]">
            <div className="text-gray-500 text-lg">{t('placeholders.developing')}</div>
        </div>
    )
}

export default NodeEditorPlaceholder

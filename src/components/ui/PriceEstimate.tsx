import React, { useMemo, useState, useEffect } from 'react'
import { registry } from '@/core/ModelRegistry'
import { useI18n } from '@/hooks/useI18n'
import {
    formatPriceEstimate,
    PRICE_SETTING_CHANGED_EVENT,
    readPriceEstimateDisplaySettings,
} from '@/core/pricing/priceDisplay'

interface PriceEstimateProps {
    providerId: string
    modelId: string
    params: Record<string, unknown>
}

const PriceEstimate: React.FC<PriceEstimateProps> = ({ modelId, params }) => {
    const model = useMemo(() => registry.getModel(modelId), [modelId])
    const { t, i18n } = useI18n('ui')

    // 计算价格
    const price = useMemo(() => {
        if (!model) return null
        return registry.calculatePrice(modelId, params)
    }, [model, modelId, params])

    // 检查用户是否开启价格显示
    const [priceSettings, setPriceSettings] = useState(() => readPriceEstimateDisplaySettings())

    // 监听 storage 变化
    useEffect(() => {
        const handleStorageChange = () => {
            setPriceSettings(readPriceEstimateDisplaySettings())
        }

        // 监听 storage 事件（跨标签页）
        window.addEventListener('storage', handleStorageChange)

        // 自定义事件监听（同一页面内）
        window.addEventListener(PRICE_SETTING_CHANGED_EVENT, handleStorageChange)

        return () => {
            window.removeEventListener('storage', handleStorageChange)
            window.removeEventListener(PRICE_SETTING_CHANGED_EVENT, handleStorageChange)
        }
    }, [])

    // 如果不显示、无配置或价格为null，则不渲染
    if (!priceSettings.showPriceEstimate || !model || price === null) {
        return null
    }

    const priceDisplay = formatPriceEstimate({
        amount: price,
        sourceCurrencySymbol: model.pricing.currency,
        displayCurrencyMode: priceSettings.currencyMode,
        language: i18n.language,
        usdToCnyRate: priceSettings.usdToCnyRate,
    }).display

    return (
        <div className="flex items-center gap-1.5 text-xs text-zinc-400 bg-zinc-800/50 px-3 py-1.5 rounded-lg border border-zinc-700/50 backdrop-blur-sm">
            <svg
                className="w-3.5 h-3.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
            </svg>
            <span className="whitespace-nowrap">
                {t('priceEstimate.label')}: <span className="text-zinc-300">{priceDisplay}</span>
            </span>
        </div>
    )
}

export default PriceEstimate

import React, { useMemo, useState, useEffect } from 'react'
import { registry } from '@/core/ModelRegistry'
import { useI18n } from '@/hooks/useI18n'
import { CircleDollarSign } from 'lucide-react'
import {
    formatPriceEstimate,
    PRICE_SETTING_CHANGED_EVENT,
    readPriceEstimateDisplaySettings,
} from '@/core/pricing/priceDisplay'
import { UI_GLASS_ADAPTIVE_CONTROL_CLASS } from './styleTokens'
import { usePriceEstimateMediaContext } from '@/hooks/usePriceEstimateMediaContext'

interface PriceEstimateProps {
    providerId: string
    modelId: string
    params: DynamicValueMap
    /** panel=对话模式面板样式（默认）；badge=画布节点紧凑徽标 */
    variant?: 'panel' | 'badge'
}

const PriceEstimate: React.FC<PriceEstimateProps> = ({ modelId, params, variant = 'panel' }) => {
    const model = useMemo(() => registry.getModel(modelId), [modelId])
    const { t, i18n } = useI18n('ui')
    const resolvedContext = usePriceEstimateMediaContext(model?.pricing.mediaContext, params)

    // 计算价格
    const price = useMemo(() => {
        if (!model || !resolvedContext.ready) return null
        return registry.calculatePrice(modelId, resolvedContext.params)
    }, [model, modelId, resolvedContext.params, resolvedContext.ready])

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
    if (!priceSettings.showPriceEstimate || !model || price === null || !Number.isFinite(price)) {
        return null
    }

    const priceDisplay = formatPriceEstimate({
        amount: price,
        sourceCurrencySymbol: model.pricing.currency,
        displayCurrencyMode: priceSettings.currencyMode,
        language: i18n.resolvedLanguage ?? i18n.language,
        usdToCnyRate: priceSettings.usdToCnyRate,
    }).display
    const priceDisplayWithUnit = model.pricing.estimateMode === 'unit'
        && model.pricing.estimateUnit
        ? `${priceDisplay}/${model.pricing.estimateUnit}`
        : priceDisplay

    if (variant === 'badge') {
        return (
            <span
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-border-dark/60 bg-bg-dark/65 px-1.5 py-1 text-3xs leading-none text-text-muted"
                title={`${t('priceEstimate.label')}: ${priceDisplayWithUnit}`}
            >
                {priceDisplayWithUnit}
            </span>
        )
    }

    return (
        <div className={`flex items-center gap-1.5 rounded-lg border border-border-dark/50 bg-surface-dark/50 px-3 py-1.5 text-xs text-text-muted ${UI_GLASS_ADAPTIVE_CONTROL_CLASS}`}>
            <CircleDollarSign className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="whitespace-nowrap">
                {t('priceEstimate.label')}: <span className="text-text-dark/85">{priceDisplayWithUnit}</span>
            </span>
        </div>
    )
}

export default PriceEstimate

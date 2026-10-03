import React, { useMemo, useState, useEffect } from 'react'
import { registry } from '@/core/ModelRegistry'
import { useI18n } from '@/hooks/useI18n'
import {
    formatPriceEstimate,
    PRICE_SETTING_CHANGED_EVENT,
    readPriceEstimateDisplaySettings,
} from '@/core/pricing/priceDisplay'
import { usePriceEstimateMediaContext } from '@/hooks/usePriceEstimateMediaContext'

interface PriceEstimateProps {
    providerId: string
    modelId: string
    params: DynamicValueMap
    /** panel=生成输入区底栏的辅助文字（默认）；badge=画布节点紧凑徽标 */
    variant?: 'panel' | 'badge'
    /** 相同计价参数的请求次数；单位参考价仍按单位展示。 */
    requestCount?: number
}

const PriceEstimate: React.FC<PriceEstimateProps> = ({ modelId, params, variant = 'panel', requestCount = 1 }) => {
    const model = useMemo(() => registry.getModel(modelId), [modelId])
    const { t, i18n } = useI18n('ui')
    const resolvedContext = usePriceEstimateMediaContext(model?.pricing.mediaContext, params)

    // 计算价格
    const price = useMemo(() => {
        if (!model || !resolvedContext.ready || !Number.isSafeInteger(requestCount) || requestCount < 1) return null
        const estimate = registry.calculatePrice(modelId, resolvedContext.params)
        return estimate === null ? null : estimate * (model.pricing.estimateMode === 'unit' ? 1 : requestCount)
    }, [model, modelId, resolvedContext.params, resolvedContext.ready, requestCount])

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
                className="inline-flex shrink-0 items-center whitespace-nowrap rounded-md border border-border-dark/60 bg-bg-dark/65 px-1.5 py-1 text-2xs leading-none text-text-muted"
                title={`${t('priceEstimate.label')}: ${priceDisplayWithUnit}`}
            >
                {priceDisplayWithUnit}
            </span>
        )
    }

    // 输入区底栏里的一段辅助文字（设计稿 Generation：生成按钮左侧的“预计费用”），不画框不铺底
    return (
        <span
            className="whitespace-nowrap px-1.5 text-xs tabular-nums text-text3"
            title={`${t('priceEstimate.label')}: ${priceDisplayWithUnit}`}
        >
            {t('priceEstimate.label')} {priceDisplayWithUnit}
        </span>
    )
}

export default PriceEstimate

import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Dropdown, UI_TEXT_META_CLASS, UiButton, UiFormRow, UiInlineStatus } from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { createLogger } from '@/core/logging'
import { formatMediaCacheBytes, MEDIA_CACHE_CATEGORIES, MEDIA_CACHE_RETENTION_DAYS, type MediaCacheCategory, type MediaCacheRetentionDays, type MediaCacheUsage } from '@/core/media/mediaCache'
import { getPlatform } from '@/platform/runtime'
import { getMediaCacheSettings, subscribeMediaCacheSettings, updateMediaCacheSettings } from '@/services/mediaCache/mediaCacheSettings'
import SettingsSegmented from '../components/SettingsSegmented'

const logger = createLogger('settings.mediaCache')
/** 总容量上限的可选档位（GB）；自动按所在盘可用空间计算。 */
const BUDGET_CHOICES = [10, 20, 50, 100, 200, 500] as const

/**
 * 文件与下载 › 缓存管理：预渲染、代理、智能分析、缩略图与波形、口播处理的缓存都在作品目录下的隐藏文件夹里，
 * 删了能重建。这里看占用、定总容量上限与按最后使用时间自动清理，并按类或全部清除。
 */
const MediaCacheSection: React.FC = () => {
  const { t } = useI18n('settings')
  const settings = useSyncExternalStore(subscribeMediaCacheSettings, getMediaCacheSettings)
  const [usage, setUsage] = useState<MediaCacheUsage | null>(null)
  const [busy, setBusy] = useState<MediaCacheCategory | 'all' | null>(null)
  const [error, setError] = useState('')

  const refresh = useCallback(() => {
    void getPlatform().mediaCache.usage().then(setUsage, (reason: unknown) => {
      logger.warn('缓存占用读取失败', { event: 'media_cache.usage.failed', error: reason })
      setError(t('sections.mediaCache.loadFailed'))
    })
  }, [t])
  useEffect(() => {
    refresh()
    try { return getPlatform().mediaCache.onChanged(refresh) } catch { return undefined }
  }, [refresh])

  const clear = async (category: MediaCacheCategory | 'all'): Promise<void> => {
    setBusy(category); setError('')
    try { await getPlatform().mediaCache.clear(category) } catch (reason) {
      logger.warn('缓存清除失败', { event: 'media_cache.clear.failed', error: reason, context: { category } })
      setError(t('sections.mediaCache.clearFailed'))
    } finally { setBusy(null); refresh() }
  }
  const save = (patch: Parameters<typeof updateMediaCacheSettings>[0]): void => {
    setError('')
    void updateMediaCacheSettings(patch).then(refresh, () => setError(t('sections.mediaCache.saveFailed')))
  }

  const budgetValue = settings.budgetGb === null ? 'auto' : String(settings.budgetGb)
  const budgetOptions = [
    { value: 'auto', label: usage ? t('sections.mediaCache.budgetAutoWithSize', { size: formatMediaCacheBytes(usage.autoBudgetBytes) }) : t('sections.mediaCache.budgetAuto') },
    ...[...new Set<number>([...BUDGET_CHOICES, ...(settings.budgetGb === null ? [] : [settings.budgetGb])])].sort((a, b) => a - b).map(value => ({ value: String(value), label: `${value} GB` })),
  ]

  return (
    <>
      <UiFormRow label={t('sections.mediaCache.usageLabel')} info={t('sections.mediaCache.usageInfo')} inline>
        <div className="flex items-center gap-2">
          <span className={UI_TEXT_META_CLASS}>{usage ? t('sections.mediaCache.usageValue', { used: formatMediaCacheBytes(usage.totalBytes), budget: formatMediaCacheBytes(usage.budgetBytes) }) : '—'}</span>
          <UiButton variant="danger" size="sm" loading={busy === 'all'} disabled={!usage?.totalBytes || busy !== null} onClick={() => { void clear('all') }}>{t('sections.mediaCache.clearAll')}</UiButton>
        </div>
      </UiFormRow>
      {MEDIA_CACHE_CATEGORIES.map(category => {
        const item = usage?.categories.find(value => value.category === category)
        return (
          <UiFormRow key={category} label={t(`sections.mediaCache.category.${category}`)} info={t(`sections.mediaCache.categoryInfo.${category}`)} inline>
            <div className="flex items-center gap-2">
              <span className={UI_TEXT_META_CLASS}>{item ? formatMediaCacheBytes(item.bytes) : '—'}</span>
              <UiButton variant="danger" size="sm" loading={busy === category} disabled={!item?.bytes || busy !== null} onClick={() => { void clear(category) }}>{t('sections.mediaCache.clear')}</UiButton>
            </div>
          </UiFormRow>
        )
      })}
      <UiFormRow label={t('sections.mediaCache.budgetLabel')} info={t('sections.mediaCache.budgetInfo')} inline>
        <Dropdown ariaLabel={t('sections.mediaCache.budgetLabel')} value={budgetValue} options={budgetOptions} onSelect={value => save({ budgetGb: value === 'auto' ? null : Number(value) })} />
      </UiFormRow>
      <UiFormRow label={t('sections.mediaCache.retentionLabel')} info={t('sections.mediaCache.retentionInfo')} inline>
        <SettingsSegmented<MediaCacheRetentionDays>
          ariaLabel={t('sections.mediaCache.retentionLabel')}
          value={settings.retentionDays}
          options={MEDIA_CACHE_RETENTION_DAYS.map(value => ({ value, label: value === 0 ? t('sections.mediaCache.retentionNever') : t('sections.mediaCache.retentionDays', { count: value }) }))}
          onChange={value => save({ retentionDays: value })}
        />
      </UiFormRow>
      {error ? <UiInlineStatus tone="error">{error}</UiInlineStatus> : null}
    </>
  )
}

export default MediaCacheSection

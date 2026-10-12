import { useI18n } from '@/hooks/useI18n'
import { useEffect, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiGroup } from '@/components/ui'
import Dropdown from '@/components/ui/Dropdown'
import NumberInput from '@/components/ui/NumberInput'
import { getAppSetting, setAppSetting } from '@/commands/appSettings'
import { DEFAULT_PAID_APPROVAL_SETTINGS, PAID_APPROVAL_SETTING_KEY, paidApprovalSettingsSchema, type PaidApprovalSettings } from '@/core/application-control/paidApproval'
import { createLogger } from '@/core/logging'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'

const logger = createLogger('settings.paid_approval')
const loadSettings = async () => paidApprovalSettingsSchema.parse(JSON.parse(await getAppSetting(PAID_APPROVAL_SETTING_KEY) ?? '{}'))
export default function PaidApprovalSection(): JSX.Element {
  const { t } = useI18n('settings')
  const [settings, setSettings] = useState(DEFAULT_PAID_APPROVAL_SETTINGS)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void loadSettings().then(value => { if (active) setSettings(value) }).catch(cause => {
      logger.error('AI 付费设置读取失败', { event: 'settings.paid_approval.load.failed', error: cause })
      if (active) setError(t('paidApproval.loadFailed'))
    }).finally(() => { if (active) setBusy(false) })
    return () => { active = false }
  }, [t])
  const save = async (update: (current: PaidApprovalSettings) => PaidApprovalSettings) => {
    setBusy(true); setError('')
    try {
      const next = paidApprovalSettingsSchema.parse(update(await loadSettings()))
      await setAppSetting(PAID_APPROVAL_SETTING_KEY, JSON.stringify(next), 'json')
      setSettings(next)
      logger.info('AI 付费设置已保存', { event: 'settings.paid_approval.save.completed' })
    } catch (cause) {
      logger.error('AI 付费设置保存失败', { event: 'settings.paid_approval.save.failed', error: cause })
      setError(t('paidApproval.saveFailed'))
    } finally { setBusy(false) }
  }
  return <UiGroup title={t('paidApproval.title')}>
    {error && <UiError message={error} />}
    <UiFormRow label={t('paidApproval.mode')} info={t('paidApproval.modeHint')} inline>
      <Dropdown value={settings.mode} disabled={busy} options={[{ value: 'ask', label: t('paidApproval.ask') }, { value: 'auto', label: t('paidApproval.auto') }, { value: 'bypass', label: t('paidApproval.bypass') }]}
        onSelect={value => { void save(current => ({ ...current, mode: value as PaidApprovalSettings['mode'] })) }} />
    </UiFormRow>
    {settings.mode === 'auto' && <UiFormRow label={t('paidApproval.single')} inline>
      <div className="flex items-center gap-2"><NumberInput value={settings.singleLimitCny} min={0} step={0.1} disabled={busy} widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
        onChange={value => { void save(current => ({ ...current, singleLimitCny: value })) }} /><span>{t('paidApproval.unit')}</span></div>
    </UiFormRow>}
    {settings.mode !== 'ask' && <UiFormRow label={t('paidApproval.daily')} inline>
      <div className="flex items-center gap-2"><NumberInput value={settings.dailyLimitCny} min={0} step={1} disabled={busy} widthClassName={SETTINGS_INLINE_CONTROL_CLASS}
        onChange={value => { void save(current => ({ ...current, dailyLimitCny: value })) }} /><span>{t('paidApproval.unit')}</span></div>
    </UiFormRow>}
    {!!settings.projects.length && <UiGroup title={t('paidApproval.projects')}>
      {settings.projects.map(project => <UiFormRow key={`${project.id}:${project.category}`} label={`${project.name} · ${t(`paidApproval.categories.${project.category}`)}`} inline>
        <UiButton variant="quiet" disabled={busy} onClick={() => { void save(current => ({ ...current, projects: current.projects.filter(value => value.id !== project.id || value.category !== project.category) })) }}>{t('paidApproval.revoke')}</UiButton>
      </UiFormRow>)}
    </UiGroup>}
  </UiGroup>
}

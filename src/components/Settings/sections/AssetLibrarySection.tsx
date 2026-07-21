import React from 'react'
import { UiPanel, UiSelect, UiSwitch, UiRangeInput } from '@/components/ui'
import { useSettingsStore } from '@/stores/settingsStore'
import { useI18n } from '@/hooks/useI18n'

const Row: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => <div className="flex items-center justify-between gap-6 py-3"><div><div className="text-sm text-text-dark">{label}</div>{hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}</div><div className="w-48 shrink-0">{children}</div></div>

const AssetLibrarySection: React.FC = () => {
  const { t } = useI18n('settings')
  const s = useSettingsStore()
  return <UiPanel className="p-4"><h3 className="mb-2 text-base font-medium">{t('sections.assetLibrary.title')}</h3>
    <Row label={t('sections.assetLibrary.tabAction')}><UiSelect value={s.assetTabAction} onChange={(e) => s.setAssetTabAction(e.target.value as 'floating' | 'workspace')}><option value="floating">{t('sections.assetLibrary.floating')}</option><option value="workspace">{t('sections.assetLibrary.workspace')}</option></UiSelect></Row>
    <Row label={t('sections.assetLibrary.panelPosition')}><UiSelect value={s.assetPanelPosition} onChange={(e) => s.setAssetPanelPosition(e.target.value as 'top' | 'left' | 'right')}><option value="top">{t('sections.assetLibrary.top')}</option><option value="left">{t('sections.assetLibrary.left')}</option><option value="right">{t('sections.assetLibrary.right')}</option></UiSelect></Row>
    <Row label={t('sections.assetLibrary.edgeTrigger')} hint={t('sections.assetLibrary.edgeHint')}><div className="flex justify-end"><UiSwitch checked={s.assetEdgeTriggerEnabled} onCheckedChange={s.setAssetEdgeTriggerEnabled} /></div></Row>
    <Row label={t('sections.assetLibrary.triggerEdge')}><UiSelect value={s.assetTriggerEdge} onChange={(e) => s.setAssetTriggerEdge(e.target.value as 'left' | 'right')}><option value="left">{t('sections.assetLibrary.left')}</option><option value="right">{t('sections.assetLibrary.right')}</option></UiSelect></Row>
    <Row label={t('sections.assetLibrary.delay', { value: s.assetEdgeDelayMs })}><UiRangeInput min={100} max={2000} step={50} value={s.assetEdgeDelayMs} onChange={(e) => s.setAssetEdgeDelayMs(Number(e.target.value))} /></Row>
  </UiPanel>
}
export default AssetLibrarySection

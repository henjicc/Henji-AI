import { UiRecordItem, UiRecordList } from '@/components/ui'
import React, { useEffect, useState } from 'react'
import { UI_TEXT_META_CLASS, UiButton, UiError, UiFormRow, UiGroup, UiInput, UiLoading, UiPanel, UiSwitch } from '@/components/ui'
import { Virtuoso } from 'react-virtuoso'
import NumberInput from '@/components/ui/NumberInput'
import { getMcpConnectionService } from '@/commands/mcp'
import { writeClipboardText } from '@/commands/clipboard'
import { type McpConnectionInfo, type McpStatus } from '@/core/application-control/localHostContracts'
import { useI18n } from '@/hooks/useI18n'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'

const describeMcpError = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

export default function McpSection(): React.JSX.Element {
  const { t } = useI18n('settings')
  const [status, setStatus] = useState<McpStatus>()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState('')
  const [port, setPort] = useState(43821)
  const refresh = async (): Promise<void> => { const next = await getMcpConnectionService().status(); setStatus(next); setPort(next.port) }
  useEffect(() => {
    const update = (): void => { void refresh().catch((cause) => setError(describeMcpError(cause))) }
    update()
    window.addEventListener('focus', update)
    return () => window.removeEventListener('focus', update)
  }, [])
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (cause) { setError(describeMcpError(cause)) }
    finally { setBusy(false) }
  }
  const connectionRow = (index: number, connection: McpConnectionInfo): React.JSX.Element => {
    return <UiRecordItem key={connection.id} index={index} density="page" title={<span className="break-words">{connection.name}</span>}
      actions={(
        <div className="flex items-center gap-2">
          <UiButton variant="quiet" disabled={busy} onClick={() => void act(async () => {
            const value = await getMcpConnectionService().connectionConfig({ id: connection.id })
            setConfig(value)
            await writeClipboardText(value)
          })}>{t('mcp.copy')}</UiButton>
          <UiButton variant="quiet" disabled={busy} onClick={() => void act(async () => { await getMcpConnectionService().revoke({ id: connection.id }); setConfig('') })}>{t('mcp.revoke')}</UiButton>
        </div>
      )}>
    </UiRecordItem>
  }
  return <>
    {error && <UiError size="xs" align="start" title={error} message="" onRetry={() => void act(refresh)} />}
    {!status ? <UiLoading size="sm" message={t('mcp.loading')} /> : <>
      <UiFormRow label={t('mcp.enable')} hint={status.enabled && status.issue ? t(status.issue === 'port_in_use' ? 'mcp.issuePortInUse' : 'mcp.issueConnecting') : undefined} inline>
        <UiSwitch checked={status.enabled} disabled={busy} onCheckedChange={(enabled) => void act(() => getMcpConnectionService().configure({ enabled, port }))} />
      </UiFormRow>
      <UiFormRow label={t('mcp.port')} info={t('mcp.portHint')} inline>
        <NumberInput value={port} onChange={setPort} min={1024} max={65535} disabled={status.enabled || busy} widthClassName={SETTINGS_INLINE_CONTROL_CLASS} />
      </UiFormRow>

      <UiGroup title={t('mcp.newConnectionTitle')} titleTone="overline">
        <UiFormRow label={t('mcp.name')}>
          <div className="flex items-center gap-2">
            <UiInput className="min-w-0 flex-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder={t('mcp.namePlaceholder')} />
            <UiButton className="shrink-0" variant="secondary" disabled={busy || !name.trim()} onClick={() => void act(async () => { await getMcpConnectionService().authorize({ name }); setName('') })}>{t('mcp.authorize')}</UiButton>
          </div>
        </UiFormRow>
      </UiGroup>

      <UiGroup title={t('mcp.connectionsTitle')} titleTone="overline">
        {status.connections.length === 0 ? <p className={UI_TEXT_META_CLASS}>{t('mcp.noConnections')}</p> : null}
        {status.connections.length > 50
          ? <Virtuoso role="list" className="h-96" data={status.connections} computeItemKey={(_index, connection) => connection.id} itemContent={connectionRow} />
          : <UiRecordList>{status.connections.map((connection, index) => connectionRow(index, connection))}</UiRecordList>}
        {/* 复制出的连接配置是只读预览：下沉为 inset 面，等宽字体 */}
        {config && <UiPanel variant="inset" className="p-3"><pre data-observation-sensitive className="overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-text2">{config}</pre></UiPanel>}
      </UiGroup>
    </>}
  </>
}

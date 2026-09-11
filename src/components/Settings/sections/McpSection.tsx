import React, { useEffect, useState } from 'react'
import { UiButton, UiError, UiFormRow, UiInput, UiLoading, UiSwitch } from '@/components/ui'
import NumberInput from '@/components/ui/NumberInput'
import { getMcpConnectionService } from '@/commands/mcp'
import { writeClipboardText } from '@/commands/clipboard'
import type { McpStatus } from '@/core/application-control/localHostContracts'
import { useI18n } from '@/hooks/useI18n'

export default function McpSection(): React.JSX.Element {
  const { t } = useI18n('settings')
  const [status, setStatus] = useState<McpStatus>()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState('')
  const [port, setPort] = useState(43821)
  const refresh = async (): Promise<void> => { const next = await getMcpConnectionService().status(); setStatus(next); setPort(next.port) }
  useEffect(() => { void refresh().catch((cause) => setError(String(cause))) }, [])
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await action(); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <>
    {error && <UiError message={error} onRetry={() => void act(refresh)} />}
    {!status ? <UiLoading message={t('mcp.loading')} /> : <>
      <UiFormRow label={t('mcp.enable')} inline info={t('mcp.readOnly')}>
        <UiSwitch checked={status.enabled} disabled={busy} onCheckedChange={(enabled) => void act(() => getMcpConnectionService().configure({ enabled, port }))} />
      </UiFormRow>
      <UiFormRow label={t('mcp.port')} inline>
        <NumberInput value={port} onChange={setPort} min={1024} max={65535} disabled={status.enabled || busy} />
      </UiFormRow>
      <UiFormRow label={t('mcp.name')}>
        <div className="flex items-center gap-2">
          <UiInput className="min-w-0 flex-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder={t('mcp.namePlaceholder')} />
          <UiButton className="shrink-0 whitespace-nowrap" variant="primary" disabled={busy || !name.trim()} onClick={() => void act(async () => { await getMcpConnectionService().authorize({ name }); setName('') })}>{t('mcp.authorize')}</UiButton>
        </div>
      </UiFormRow>
      {status.connections.map((connection) => <UiFormRow key={connection.id} label={connection.name} inline>
        <div className="flex items-center gap-2">
          <UiButton variant="ghost" disabled={busy} onClick={() => void act(async () => {
            const value = await getMcpConnectionService().connectionConfig({ id: connection.id })
            setConfig(value)
            await writeClipboardText(value)
          })}>{t('mcp.copy')}</UiButton>
          <UiButton variant="ghost" disabled={busy} onClick={() => void act(async () => { await getMcpConnectionService().revoke({ id: connection.id }); setConfig('') })}>{t('mcp.revoke')}</UiButton>
        </div>
      </UiFormRow>)}
      {config && <pre data-observation-sensitive className="overflow-auto whitespace-pre-wrap break-all text-xs text-text-muted">{config}</pre>}
    </>}
  </>
}

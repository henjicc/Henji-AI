import React, { useEffect, useState } from 'react'
import { UI_TEXT_META_CLASS, UI_TEXT_SECONDARY_CLASS, UiButton, UiError, UiFormRow, UiGroup, UiInput, UiLoading, UiPanel, UiSwitch } from '@/components/ui'
import { Virtuoso } from 'react-virtuoso'
import NumberInput from '@/components/ui/NumberInput'
import { getMcpConnectionService } from '@/commands/mcp'
import { writeClipboardText } from '@/commands/clipboard'
import { DEFAULT_MCP_PREFERENCES, type McpConnectionAccess, type McpConnectionInfo, type McpStatus } from '@/core/application-control/localHostContracts'
import { useI18n } from '@/hooks/useI18n'
import { SETTINGS_INLINE_CONTROL_CLASS } from '../settingsLayout'
import SettingsDependentRows from '../components/SettingsDependentRows'

const describeMcpError = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/** 新建连接与修改已有连接共用同一组权限开关：删除与付费都从属于“允许修改内容”。 */
function McpAccessSwitches({ access, disabled, onChange }: { access: McpConnectionAccess; disabled: boolean; onChange: (access: McpConnectionAccess) => void }): React.JSX.Element {
  const { t } = useI18n('settings')
  const { allowWrites, allowDestructive, allowPaid } = access
  return <>
    <UiFormRow label={t('mcp.allowWrites')} inline info={t('mcp.writeScope')}>
      <UiSwitch checked={allowWrites} disabled={disabled} onCheckedChange={(value) => onChange({ allowWrites: value, allowDestructive, allowPaid })} />
    </UiFormRow>
    <SettingsDependentRows open={allowWrites}>
      <UiFormRow label={t('mcp.allowDelete')} inline>
        <UiSwitch checked={allowDestructive} disabled={disabled} onCheckedChange={(value) => onChange({ allowWrites, allowDestructive: value, allowPaid })} />
      </UiFormRow>
      <UiFormRow label={t('mcp.allowPaid')} inline info={t('mcp.paidScope')}>
        <UiSwitch checked={allowPaid} disabled={disabled} onCheckedChange={(value) => onChange({ allowWrites, allowDestructive, allowPaid: value })} />
      </UiFormRow>
    </SettingsDependentRows>
  </>
}

/**
 * 外部智能体连接。
 *
 * 顺序按用户的操作顺序排：服务开关与端口 → 新建连接（先选权限、再起名创建）→ 已授权的连接。
 * 以前「创建授权」排在权限开关前面，点创建时还没看到这条连接会拿到什么权限。
 * 权限开关存的是主进程里的「新连接默认权限」，创建时随名称一起生效。
 */
export default function McpSection(): React.JSX.Element {
  const { t } = useI18n('settings')
  const [status, setStatus] = useState<McpStatus>()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState('')
  const [port, setPort] = useState(43821)
  const [editingId, setEditingId] = useState<string>()
  const defaultAccess = status?.defaultAccess ?? DEFAULT_MCP_PREFERENCES.defaultAccess
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
    const editing = editingId === connection.id
    return <div key={connection.id} className={`flex flex-col gap-2 py-5 ${index ? 'border-t border-line' : ''}`}>
      <UiFormRow label={<span className="break-words">{connection.name}</span>} inline>
        <div className="flex items-center gap-2">
          <UiButton variant="quiet" disabled={busy} onClick={() => setEditingId(editing ? undefined : connection.id)}>{t(editing ? 'mcp.editDone' : 'mcp.edit')}</UiButton>
          <UiButton variant="quiet" disabled={busy} onClick={() => void act(async () => {
            const value = await getMcpConnectionService().connectionConfig({ id: connection.id })
            setConfig(value)
            await writeClipboardText(value)
          })}>{t('mcp.copy')}</UiButton>
          <UiButton variant="quiet" disabled={busy} onClick={() => void act(async () => { await getMcpConnectionService().revoke({ id: connection.id }); setConfig(''); setEditingId(undefined) })}>{t('mcp.revoke')}</UiButton>
        </div>
      </UiFormRow>
      {editing
        ? <div className="pl-6"><McpAccessSwitches access={connection} disabled={busy} onChange={(access) => void act(() => getMcpConnectionService().update({ id: connection.id, access }))} /></div>
        : <p className={UI_TEXT_SECONDARY_CLASS}>{[t(connection.allowDestructive ? 'mcp.accessDelete' : connection.allowWrites ? 'mcp.accessWrite' : 'mcp.accessRead'), ...(connection.allowPaid ? [t('mcp.accessPaid')] : [])].join(' · ')}</p>}
    </div>
  }
  return <>
    {error && <UiError size="xs" align="start" title={error} message="" onRetry={() => void act(refresh)} />}
    {!status ? <UiLoading size="sm" message={t('mcp.loading')} /> : <>
      <UiFormRow label={t('mcp.enable')} inline info={t('mcp.readOnly')}>
        <UiSwitch checked={status.enabled} disabled={busy} onCheckedChange={(enabled) => void act(() => getMcpConnectionService().configure({ enabled, port }))} />
      </UiFormRow>
      <UiFormRow label={t('mcp.port')} info={t('mcp.portHint')} inline>
        <NumberInput value={port} onChange={setPort} min={1024} max={65535} disabled={status.enabled || busy} widthClassName={SETTINGS_INLINE_CONTROL_CLASS} />
      </UiFormRow>

      <UiGroup title={t('mcp.newConnectionTitle')} titleTone="overline">
        <McpAccessSwitches access={defaultAccess} disabled={busy} onChange={(access) => void act(() => getMcpConnectionService().configure({ enabled: status.enabled, port, defaultAccess: access }))} />
        <UiFormRow label={t('mcp.name')}>
          <div className="flex items-center gap-2">
            <UiInput className="min-w-0 flex-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder={t('mcp.namePlaceholder')} />
            <UiButton className="shrink-0" variant="secondary" disabled={busy || !name.trim()} onClick={() => void act(async () => { await getMcpConnectionService().authorize({ name, ...defaultAccess }); setName('') })}>{t('mcp.authorize')}</UiButton>
          </div>
        </UiFormRow>
      </UiGroup>

      <UiGroup title={t('mcp.connectionsTitle')} titleTone="overline">
        {status.connections.length === 0 ? <p className={UI_TEXT_META_CLASS}>{t('mcp.noConnections')}</p> : null}
        {status.connections.length > 50
          ? <Virtuoso className="h-96" data={status.connections} computeItemKey={(_index, connection) => connection.id} itemContent={connectionRow} />
          : status.connections.map((connection, index) => connectionRow(index, connection))}
        {/* 复制出的连接配置是只读预览：下沉为 inset 面，等宽字体 */}
        {config && <UiPanel variant="inset" className="p-3"><pre data-observation-sensitive className="overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-text2">{config}</pre></UiPanel>}
      </UiGroup>
    </>}
  </>
}

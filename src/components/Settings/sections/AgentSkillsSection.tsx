import { FolderOpen, Package, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TFunction } from 'i18next'

import {
  installAssistantSkill,
  listAssistantSkills,
  openAssistantSkillsDirectory,
  setAssistantSkillEnabled,
  uninstallAssistantSkill,
} from '@/commands/assistant'
import {
  UI_FORM_ROW_GAP_CLASS,
  UI_TEXT_BODY_CLASS,
  UI_TEXT_META_CLASS,
  UiButton,
  UiEmpty,
  UiGroup,
  UiIconButton,
  UiSwitch,
} from '@/components/ui'
import type {
  AssistantSkillInstallResult,
  AssistantSkillManifest,
  AssistantSkillMetadata,
} from '@/core/assistant/skills'
import { createLogger } from '@/core/logging'
import { useI18n } from '@/hooks/useI18n'
import { extname, getPathForFile, openDialog } from '@/platform/desktopApi'
import SettingsDialog from '../components/SettingsDialog'

const logger = createLogger('components.Settings.AgentSkillsSection')

/** 状态行：失败用危险文字色，与进行中、已完成的提示区分开（5.6 第二批）。 */
interface StatusLine { text: string; failed: boolean }
const info = (text: string): StatusLine => ({ text, failed: false })
const failure = (text: string): StatusLine => ({ text, failed: true })

const EMPTY_MANIFEST: AssistantSkillManifest = {
  schemaVersion: 'assistant-skill/v1',
  skills: [],
  invalid: [],
}

interface PendingConfirm {
  kind: 'overwrite' | 'disable-builtin' | 'uninstall'
  title: string
  description: string
  confirmLabel: string
  run: () => Promise<void>
}

function describeInstallResult(result: AssistantSkillInstallResult, t: TFunction): string {
  const parts: string[] = []
  const separator = t('agentSkills.listSeparator')
  if (result.installed.length > 0) parts.push(t('agentSkills.installed', { names: result.installed.join(separator) }))
  if (result.replaced.length > 0) parts.push(t('agentSkills.replaced', { names: result.replaced.join(separator) }))
  if (result.skippedFiles.length > 0) {
    parts.push(t('agentSkills.skippedCount', { count: result.skippedFiles.length }))
  }
  return parts.length > 0 ? t('agentSkills.installSummary', { parts: parts.join(t('agentSkills.clauseSeparator')) }) : t('agentSkills.nothingToInstall')
}

export default function AgentSkillsSection(): JSX.Element {
  const { t } = useI18n('settings')
  const [manifest, setManifest] = useState<AssistantSkillManifest>(EMPTY_MANIFEST)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState<StatusLine>(() => info(t('agentSkills.reading')))
  const [skipped, setSkipped] = useState<AssistantSkillInstallResult['skippedFiles']>([])
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null)

  const userSkills = useMemo(
    () => manifest.skills.filter((skill) => skill.source === 'user'),
    [manifest]
  )
  const builtinSkills = useMemo(
    () => manifest.skills.filter((skill) => skill.source === 'builtin'),
    [manifest]
  )

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await listAssistantSkills()
      setManifest(next)
      setStatus(info(t('agentSkills.summary', { total: next.skills.length, disabled: next.skills.filter((skill) => !skill.enabled).length })))
    } catch (error) {
      setStatus(failure(error instanceof Error ? error.message : t('agentSkills.readFailed')))
      logger.error('读取助手技能清单失败', error, { event: 'settings.agent_skills.read.failed' })
    } finally {
      setBusy(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const runInstall = useCallback(async (sourcePath: string, overwrite: boolean): Promise<void> => {
    setBusy(true)
    setSkipped([])
    setStatus(info(t('agentSkills.installing')))
    logger.info('安装助手技能开始', {
      event: 'settings.agent_skills.install.start',
      context: { extension: extname(sourcePath) },
    })
    try {
      const result = await installAssistantSkill({ sourcePath, overwrite })
      setSkipped(result.skippedFiles)
      setStatus(info(describeInstallResult(result, t)))
      await load()
      logger.info('安装助手技能完成', {
        event: 'settings.agent_skills.install.completed',
        context: { installedCount: result.installed.length },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : t('agentSkills.installFailed')
      if (message.includes('同名技能已存在')) {
        setStatus(info(''))
        setConfirm({
          kind: 'overwrite',
          title: t('agentSkills.overwriteTitle'),
          description: t('agentSkills.overwriteDescription'),
          confirmLabel: t('agentSkills.overwriteConfirm'),
          run: () => runInstall(sourcePath, true),
        })
        return
      }
      setStatus(failure(message))
      logger.error('安装助手技能失败', error, { event: 'settings.agent_skills.install.failed' })
    } finally {
      setBusy(false)
    }
  }, [load, t])

  const pickAndInstall = useCallback(async (): Promise<void> => {
    const selected = await openDialog({
      filters: [{ name: t('agentSkills.fileFilter'), extensions: ['md', 'zip'] }],
    })
    const sourcePath = Array.isArray(selected) ? selected[0] : selected
    if (!sourcePath) return
    await runInstall(sourcePath, false)
  }, [runInstall, t])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files.item(0)
    if (!file) return
    const sourcePath = getPathForFile(file).trim()
    if (!sourcePath) {
      setStatus(failure(t('agentSkills.dropPathFailed')))
      return
    }
    void runInstall(sourcePath, false)
  }, [runInstall, t])

  const toggleSkill = useCallback((skill: AssistantSkillMetadata): void => {
    const apply = async (): Promise<void> => {
      setBusy(true)
      try {
        setManifest(await setAssistantSkillEnabled({ name: skill.name, enabled: !skill.enabled }))
        setStatus(info(t(skill.enabled ? 'agentSkills.disabledNotice' : 'agentSkills.enabledNotice', { name: skill.name })))
      } catch (error) {
        setStatus(failure(error instanceof Error ? error.message : t('agentSkills.toggleFailed')))
      } finally {
        setBusy(false)
      }
    }
    // 只有"停用内置技能"需要二次确认：内置技能承载助手在该领域的核心操作流程，
    // 误关之后助手会在对应场景明显变笨，而用户未必能把这个现象和自己关过的开关联系起来。
    // 启用和停用自己的技能都不弹窗——反向操作不会造成能力缺失，不该打扰用户。
    if (skill.enabled && skill.source === 'builtin') {
      setConfirm({
        kind: 'disable-builtin',
        title: t('agentSkills.disableBuiltinTitle', { name: skill.name }),
        description: t('agentSkills.disableBuiltinDescription'),
        confirmLabel: t('agentSkills.disableConfirm'),
        run: apply,
      })
      return
    }
    void apply()
  }, [t])

  const removeSkill = useCallback((skill: AssistantSkillMetadata): void => {
    setConfirm({
      kind: 'uninstall',
      title: t('agentSkills.uninstallTitle', { name: skill.name }),
      description: t('agentSkills.uninstallDescription'),
      confirmLabel: t('agentSkills.uninstallConfirm'),
      run: async () => {
        setBusy(true)
        try {
          await uninstallAssistantSkill(skill.name)
          setStatus(info(t('agentSkills.uninstalled', { name: skill.name })))
          await load()
        } catch (error) {
          setStatus(failure(error instanceof Error ? error.message : t('agentSkills.uninstallFailed')))
        } finally {
          setBusy(false)
        }
      },
    })
  }, [load, t])

  const openDirectory = useCallback(async (): Promise<void> => {
    try {
      await openAssistantSkillsDirectory()
      // 刻意不显示目录的绝对路径：这段文本会被 Surface 观察截图原样带给模型。
      setStatus(info(t('agentSkills.directoryOpened')))
    } catch (error) {
      setStatus(failure(error instanceof Error ? error.message : t('agentSkills.openDirectoryFailed')))
    }
  }, [t])

  const renderSkillRow = (skill: AssistantSkillMetadata): JSX.Element => (
    <div key={`${skill.source}:${skill.name}`} className="flex items-start gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={UI_TEXT_BODY_CLASS}>{skill.name}</span>
          {skill.overridesBuiltin ? (
            <span className={UI_TEXT_META_CLASS}>{t('agentSkills.overridesBuiltin')}</span>
          ) : null}
          {skill.referencePaths.length > 0 ? (
            <span className={UI_TEXT_META_CLASS}>{t('agentSkills.referenceCount', { count: skill.referencePaths.length })}</span>
          ) : null}
        </div>
        <p className={`mt-0.5 leading-5 ${UI_TEXT_META_CLASS}`}>{skill.description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <UiSwitch
          checked={skill.enabled}
          disabled={busy}
          onCheckedChange={() => toggleSkill(skill)}
          aria-label={t('agentSkills.enableSkill', { name: skill.name })}
        />
        {skill.source === 'user' ? (
          <UiIconButton
            type="button"
            tone="danger"
            disabled={busy}
            title={t('agentSkills.removeSkill', { name: skill.name })}
            aria-label={t('agentSkills.removeSkill', { name: skill.name })}
            onClick={() => removeSkill(skill)}
          >
            <Trash2 className="h-4 w-4" />
          </UiIconButton>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className={UI_FORM_ROW_GAP_CLASS}>
      <UiGroup title={t('agentSkills.userGroup')}>
        {userSkills.length > 0
          ? userSkills.map(renderSkillRow)
          : (
            <UiEmpty
              size="sm"
              title={t('agentSkills.userEmptyTitle')}
              description={t('agentSkills.userEmptyDescription')}
            />
          )}
      </UiGroup>

      <UiGroup title={t('agentSkills.builtinGroup')} divided>
        {builtinSkills.length > 0
          ? builtinSkills.map(renderSkillRow)
          : <p className={UI_TEXT_META_CLASS}>{t('agentSkills.builtinEmpty')}</p>}
      </UiGroup>

      {manifest.invalid.length > 0 ? (
        <UiGroup title={t('agentSkills.invalidGroup')} divided>
          {manifest.invalid.map((entry) => (
            /* 失败条目会带出技能文件夹的本地绝对路径，必须声明为观察敏感区域。 */
            <div key={entry.path} data-observation-sensitive className="py-1">
              <p className={`break-all ${UI_TEXT_BODY_CLASS}`}>{entry.path}</p>
              <p className={`mt-0.5 leading-5 ${UI_TEXT_META_CLASS}`}>{entry.reason}</p>
            </div>
          ))}
        </UiGroup>
      ) : null}

      <UiGroup title={t('agentSkills.installGroup')} divided>
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg px-3 py-4 text-center transition-colors ${
            dragging ? 'bg-hover' : 'bg-window/40'
          }`}
        >
          <Package size={18} className="mx-auto mb-2 text-text2" />
          <p className={UI_TEXT_META_CLASS}>{t('agentSkills.dropHint')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 助手大类整页只留一个实底主动作（“保存指令”），安装技能用次级档 */}
          <UiButton type="button" variant="secondary" disabled={busy} onClick={() => void pickAndInstall()}>
            <Upload className="h-4 w-4" />
            {t('agentSkills.pickFile')}
          </UiButton>
          <UiButton type="button" variant="secondary" disabled={busy} onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            {t('agentSkills.reload')}
          </UiButton>
          <UiButton type="button" variant="secondary" disabled={busy} onClick={() => void openDirectory()}>
            <FolderOpen className="h-4 w-4" />
            {t('agentSkills.openDirectory')}
          </UiButton>
        </div>
        {skipped.length > 0 ? (
          <div>
            <p className={UI_TEXT_META_CLASS}>{t('agentSkills.skippedHeading')}</p>
            {skipped.map((file) => (
              <p key={file.path} className={`break-all leading-5 ${UI_TEXT_META_CLASS}`}>
                {file.path} —— {file.reason}
              </p>
            ))}
          </div>
        ) : null}
        <p className={`leading-5 ${status.failed ? 'text-2xs font-medium text-danger-text' : UI_TEXT_META_CLASS}`}>{status.text}</p>
      </UiGroup>

      <SettingsDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        onClose={() => setConfirm(null)}
        actions={[
          { label: t('agentSkills.cancel'), onClick: () => setConfirm(null), variant: 'secondary' },
          {
            label: confirm?.confirmLabel ?? t('agentSkills.confirm'),
            variant: confirm?.kind === 'uninstall' ? 'danger' : 'primary',
            onClick: () => {
              const pending = confirm
              setConfirm(null)
              if (pending) void pending.run()
            },
          },
        ]}
      />
    </div>
  )
}

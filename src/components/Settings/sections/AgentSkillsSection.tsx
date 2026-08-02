import { FolderOpen, Package, RefreshCw, Trash2, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

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
import { extname, getPathForFile, openDialog } from '@/platform/desktopApi'
import SettingsDialog from '../components/SettingsDialog'

const logger = createLogger('components.Settings.AgentSkillsSection')

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

function describeInstallResult(result: AssistantSkillInstallResult): string {
  const parts: string[] = []
  if (result.installed.length > 0) parts.push(`已安装 ${result.installed.join('、')}`)
  if (result.replaced.length > 0) parts.push(`其中替换了 ${result.replaced.join('、')}`)
  if (result.skippedFiles.length > 0) {
    parts.push(`跳过 ${result.skippedFiles.length} 个非纯文本文件`)
  }
  return parts.length > 0 ? `${parts.join('，')}。` : '没有可安装的技能。'
}

export default function AgentSkillsSection(): JSX.Element {
  const [manifest, setManifest] = useState<AssistantSkillManifest>(EMPTY_MANIFEST)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState('正在读取技能清单…')
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
      setStatus(`共 ${next.skills.length} 个技能，其中 ${next.skills.filter((skill) => !skill.enabled).length} 个已停用。`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '读取技能清单失败')
      logger.error('读取助手技能清单失败', error, { event: 'settings.agent_skills.read.failed' })
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const runInstall = useCallback(async (sourcePath: string, overwrite: boolean): Promise<void> => {
    setBusy(true)
    setSkipped([])
    setStatus('正在安装…')
    logger.info('安装助手技能开始', {
      event: 'settings.agent_skills.install.start',
      context: { extension: extname(sourcePath) },
    })
    try {
      const result = await installAssistantSkill({ sourcePath, overwrite })
      setSkipped(result.skippedFiles)
      setStatus(describeInstallResult(result))
      await load()
      logger.info('安装助手技能完成', {
        event: 'settings.agent_skills.install.completed',
        context: { installedCount: result.installed.length },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : '安装技能失败'
      if (message.includes('同名技能已存在')) {
        setStatus('')
        setConfirm({
          kind: 'overwrite',
          title: '替换同名技能',
          description: '数据目录里已经有同名技能了。继续会整个文件夹替换，原来的正文和引用文件不会保留。',
          confirmLabel: '替换',
          run: () => runInstall(sourcePath, true),
        })
        return
      }
      setStatus(message)
      logger.error('安装助手技能失败', error, { event: 'settings.agent_skills.install.failed' })
    } finally {
      setBusy(false)
    }
  }, [load])

  const pickAndInstall = useCallback(async (): Promise<void> => {
    const selected = await openDialog({
      filters: [{ name: '技能文件', extensions: ['md', 'zip'] }],
    })
    const sourcePath = Array.isArray(selected) ? selected[0] : selected
    if (!sourcePath) return
    await runInstall(sourcePath, false)
  }, [runInstall])

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files.item(0)
    if (!file) return
    const sourcePath = getPathForFile(file).trim()
    if (!sourcePath) {
      setStatus('无法读取拖入文件的路径，请改用“选择文件”。')
      return
    }
    void runInstall(sourcePath, false)
  }, [runInstall])

  const toggleSkill = useCallback((skill: AssistantSkillMetadata): void => {
    const apply = async (): Promise<void> => {
      setBusy(true)
      try {
        setManifest(await setAssistantSkillEnabled({ name: skill.name, enabled: !skill.enabled }))
        setStatus(`已${skill.enabled ? '停用' : '启用'}技能 ${skill.name}。下一次助手任务生效。`)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : '更新技能状态失败')
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
        title: `停用内置技能「${skill.name}」`,
        description: '这是随应用发布的内置技能。停用后助手在对应场景会失去这部分操作指导，可能给出更笼统的结果。你可以随时重新启用。',
        confirmLabel: '停用',
        run: apply,
      })
      return
    }
    void apply()
  }, [])

  const removeSkill = useCallback((skill: AssistantSkillMetadata): void => {
    setConfirm({
      kind: 'uninstall',
      title: `删除技能「${skill.name}」`,
      description: '会从数据目录里删除这个技能文件夹，包含它的引用文件。此操作不可撤销。',
      confirmLabel: '删除',
      run: async () => {
        setBusy(true)
        try {
          await uninstallAssistantSkill(skill.name)
          setStatus(`已删除技能 ${skill.name}。`)
          await load()
        } catch (error) {
          setStatus(error instanceof Error ? error.message : '删除技能失败')
        } finally {
          setBusy(false)
        }
      },
    })
  }, [load])

  const openDirectory = useCallback(async (): Promise<void> => {
    try {
      await openAssistantSkillsDirectory()
      // 刻意不显示目录的绝对路径：这段文本会被 Surface 观察截图原样带给模型。
      setStatus('已在文件管理器中打开技能目录。改完文件后点“重新读取”。')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '打开技能目录失败')
    }
  }, [])

  const renderSkillRow = (skill: AssistantSkillMetadata): JSX.Element => (
    <div key={`${skill.source}:${skill.name}`} className="flex items-start gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={UI_TEXT_BODY_CLASS}>{skill.name}</span>
          {skill.overridesBuiltin ? (
            <span className={UI_TEXT_META_CLASS}>已覆盖同名内置技能</span>
          ) : null}
          {skill.referencePaths.length > 0 ? (
            <span className={UI_TEXT_META_CLASS}>{skill.referencePaths.length} 个引用文件</span>
          ) : null}
        </div>
        <p className={`mt-0.5 leading-5 ${UI_TEXT_META_CLASS}`}>{skill.description}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <UiSwitch
          checked={skill.enabled}
          disabled={busy}
          onCheckedChange={() => toggleSkill(skill)}
          aria-label={`启用技能 ${skill.name}`}
        />
        {skill.source === 'user' ? (
          <UiIconButton
            type="button"
            showBorder={false}
            appearance="hover-only"
            disabled={busy}
            aria-label={`删除技能 ${skill.name}`}
            onClick={() => removeSkill(skill)}
          >
            <Trash2 size={14} />
          </UiIconButton>
        ) : null}
      </div>
    </div>
  )

  return (
    <div className={UI_FORM_ROW_GAP_CLASS}>
      <UiGroup title="我的技能">
        {userSkills.length > 0
          ? userSkills.map(renderSkillRow)
          : (
            <UiEmpty
              title="还没有自己的技能"
              description="技能是一段按需加载的提示词。安装后助手会在相关场景自己读取它，不会改变权限和审批规则。"
            />
          )}
      </UiGroup>

      <UiGroup title="内置技能" divided>
        {builtinSkills.length > 0
          ? builtinSkills.map(renderSkillRow)
          : <p className={UI_TEXT_META_CLASS}>没有读取到内置技能。</p>}
      </UiGroup>

      {manifest.invalid.length > 0 ? (
        <UiGroup title="解析失败" divided>
          {manifest.invalid.map((entry) => (
            /* 失败条目会带出技能文件夹的本地绝对路径，必须声明为观察敏感区域。 */
            <div key={entry.path} data-observation-sensitive className="py-1">
              <p className={`break-all ${UI_TEXT_BODY_CLASS}`}>{entry.path}</p>
              <p className={`mt-0.5 leading-5 ${UI_TEXT_META_CLASS}`}>{entry.reason}</p>
            </div>
          ))}
        </UiGroup>
      ) : null}

      <UiGroup title="安装技能" divided>
        <div
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`rounded-lg px-3 py-4 text-center transition-colors ${
            dragging ? 'bg-layer' : 'bg-app/40'
          }`}
        >
          <Package size={18} className="mx-auto mb-2 text-text-muted" />
          <p className={UI_TEXT_META_CLASS}>
            把 .md 或 .zip 拖到这里，或点下面的按钮选择文件。只有 .md 与 .txt 会被安装，脚本和二进制文件一律丢弃。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UiButton type="button" size="sm" variant="primary" disabled={busy} onClick={() => void pickAndInstall()}>
            <Upload size={14} className="mr-1.5" />
            选择文件安装
          </UiButton>
          <UiButton type="button" size="sm" variant="muted" disabled={busy} onClick={() => void load()}>
            <RefreshCw size={14} className="mr-1.5" />
            重新读取
          </UiButton>
          <UiButton type="button" size="sm" variant="muted" disabled={busy} onClick={() => void openDirectory()}>
            <FolderOpen size={14} className="mr-1.5" />
            打开技能目录
          </UiButton>
        </div>
        {skipped.length > 0 ? (
          <div>
            <p className={UI_TEXT_META_CLASS}>以下文件因为不是纯文本被丢弃：</p>
            {skipped.map((file) => (
              <p key={file.path} className={`break-all leading-5 ${UI_TEXT_META_CLASS}`}>
                {file.path} —— {file.reason}
              </p>
            ))}
          </div>
        ) : null}
        <p className={`leading-5 ${UI_TEXT_META_CLASS}`}>{status}</p>
      </UiGroup>

      <SettingsDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        onClose={() => setConfirm(null)}
        actions={[
          { label: '取消', onClick: () => setConfirm(null), variant: 'secondary' },
          {
            label: confirm?.confirmLabel ?? '确定',
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

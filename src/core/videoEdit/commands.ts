import { z } from 'zod'

export type VideoEditCommandScope = 'global' | 'timeline' | 'program' | 'source' | 'project' | 'effects' | 'content'
export interface VideoEditShortcut { code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
const key = (code: string, ctrl = false, shift = false, alt = false): VideoEditShortcut => ({ code, ctrl, shift, alt, meta: false })
const editScopes: VideoEditCommandScope[] = ['timeline', 'program']
const monitorScopes: VideoEditCommandScope[] = ['timeline', 'program', 'source']
function command<const T extends string>(id: T, title: string, scopes: VideoEditCommandScope[], shortcut?: VideoEditShortcut, repeat = false) { return { id, title, scopes, shortcut, repeat } }
export const VIDEO_EDIT_COMMANDS = [
  command('new_project', '新建工程', ['global'], key('KeyN', true, false, true)),
  command('new_sequence', '新建序列', ['global'], key('KeyN', true)),
  command('import', '导入素材', ['global'], key('KeyI', true)),
  command('save', '保存工程', ['global'], key('KeyS', true)),
  command('undo', '撤销', ['global'], key('KeyZ', true)),
  command('redo', '重做', ['global'], key('KeyZ', true, true)),
  command('select_tool', '选择工具', ['timeline'], key('KeyV')),
  command('razor_tool', '剃刀工具', ['timeline'], key('KeyC')),
  command('hand_tool', '手形工具', ['timeline'], key('KeyH')),
  command('track_tool', '轨道向前选择', ['timeline'], key('KeyA')),
  command('play_pause', '播放／暂停', monitorScopes, key('Space')),
  command('step_back', '上一帧', monitorScopes, key('ArrowLeft'), true),
  command('step_forward', '下一帧', monitorScopes, key('ArrowRight'), true),
  command('play_reverse', '反向浏览（静音）', monitorScopes, key('KeyJ')),
  command('play_stop', '停止播放', monitorScopes, key('KeyK')),
  command('play_forward', '正向播放', monitorScopes, key('KeyL')),
  command('mark_in', '设置入点', monitorScopes, key('KeyI')),
  command('mark_out', '设置出点', monitorScopes, key('KeyO')),
  command('split', '在播放头拆分', editScopes, key('KeyK', true)),
  command('split_tracks', '拆分全部目标轨道', editScopes, key('KeyK', true, true)),
  command('delete', '删除片段', editScopes, key('Delete')),
  command('ripple_delete', '波纹删除', editScopes, key('Delete', false, true)),
  command('toggle_snapping', '吸附', ['timeline'], key('KeyS')),
  command('copy', '复制片段', editScopes, key('KeyC', true)),
  command('paste', '粘贴片段', editScopes, key('KeyV', true)),
  command('insert', '插入', ['timeline', 'program', 'source', 'project'], key('Comma')),
  command('overwrite', '覆盖', ['timeline', 'program', 'source', 'project'], key('Period')),
  command('select_all', '全选', ['timeline', 'program', 'project'], key('KeyA', true)),
  command('export', '导出视频', ['global'], key('KeyM', true)),
  command('zoom_in', '放大时间线', ['timeline'], key('Equal'), true),
  command('zoom_out', '缩小时间线', ['timeline'], key('Minus'), true),
  command('link', '链接片段', editScopes), command('unlink', '解除链接', editScopes),
  command('group', '编组', editScopes), command('ungroup', '解除编组', editScopes),
  command('separate_audio', '拆开音画', editScopes),
  command('locate_source', '打开源素材', editScopes), command('locate_project', '在项目中定位', editScopes),
  command('locate_effects', '编辑片段属性', editScopes),
] as const
export type VideoEditCommandId = typeof VIDEO_EDIT_COMMANDS[number]['id']
export type VideoEditShortcutOverrides = Partial<Record<VideoEditCommandId, VideoEditShortcut | null>>
const shortcutSchema = z.object({ code: z.string().regex(/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Arrow(?:Left|Right|Up|Down)|Delete|Backspace|Comma|Period|Equal|Minus|Bracket(?:Left|Right)|Home|End|Page(?:Up|Down))$/), ctrl: z.boolean(), alt: z.boolean(), shift: z.boolean(), meta: z.boolean() }).strict()
export function videoEditShortcutLabel(shortcut: VideoEditShortcut | null | undefined): string {
  if (!shortcut) return '未设置'
  const labels: Record<string, string> = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', Comma: ',', Period: '.', Equal: '=', Minus: '-' }
  return [shortcut.ctrl ? 'Ctrl' : '', shortcut.meta ? 'Cmd' : '', shortcut.alt ? 'Alt' : '', shortcut.shift ? 'Shift' : '', labels[shortcut.code] ?? shortcut.code.replace(/^(?:Key|Digit)/, '')].filter(Boolean).join('+')
}
export function videoEditCommandShortcut(id: VideoEditCommandId, overrides: VideoEditShortcutOverrides): VideoEditShortcut | undefined {
  return Object.hasOwn(overrides, id) ? overrides[id] ?? undefined : VIDEO_EDIT_COMMANDS.find(command => command.id === id)!.shortcut
}
function signature(value: VideoEditShortcut): string { return [value.code, value.ctrl, value.meta, value.alt, value.shift].join(':') }
const optionalShortcutSchema = shortcutSchema.nullable().optional()
const shortcutFields = Object.fromEntries(VIDEO_EDIT_COMMANDS.map(command => [command.id, optionalShortcutSchema])) as Record<VideoEditCommandId, typeof optionalShortcutSchema>
export const videoEditShortcutOverridesSchema = z.object(shortcutFields).strict().superRefine((values, context) => {
  const ids = new Set<string>(VIDEO_EDIT_COMMANDS.map(command => command.id))
  for (const id of Object.keys(values)) if (!ids.has(id)) context.addIssue({ code: 'custom', path: [id], message: '此剪辑命令不存在。' })
  const shortcuts = values as VideoEditShortcutOverrides
  for (let index = 0; index < VIDEO_EDIT_COMMANDS.length; index++) {
    const first = VIDEO_EDIT_COMMANDS[index]; const binding = videoEditCommandShortcut(first.id, shortcuts)
    if (!binding) continue
    for (const second of VIDEO_EDIT_COMMANDS.slice(index + 1)) {
      const other = videoEditCommandShortcut(second.id, shortcuts)
      const shared = first.scopes.includes('global') || second.scopes.includes('global') || first.scopes.some(scope => second.scopes.includes(scope))
      if (shared && other && signature(binding) === signature(other)) context.addIssue({ code: 'custom', path: [first.id], message: `“${first.title}”与“${second.title}”的快捷键冲突：${videoEditShortcutLabel(binding)}。` })
    }
  }
})
export function parseVideoEditShortcutOverrides(values: unknown): VideoEditShortcutOverrides {
  const result = videoEditShortcutOverridesSchema.safeParse(values)
  if (!result.success) throw new Error(result.error.issues[0]?.code === 'unrecognized_keys' ? '此剪辑命令不存在。' : result.error.issues[0]?.message ?? '快捷键配置无效。')
  return result.data as VideoEditShortcutOverrides
}
export interface VideoEditKeyEvent { code: string; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; isComposing: boolean; defaultPrevented: boolean }
export function matchVideoEditShortcut(event: VideoEditKeyEvent, scope: VideoEditCommandScope, overrides: VideoEditShortcutOverrides, editable = false): VideoEditCommandId | undefined {
  if (editable || event.defaultPrevented || event.isComposing || event.key === 'Process' || event.key === 'Unidentified') return
  return VIDEO_EDIT_COMMANDS.find(command => {
    if ((!command.scopes.includes('global') && !command.scopes.includes(scope)) || event.repeat && !command.repeat) return false
    const shortcut = videoEditCommandShortcut(command.id, overrides)
    return shortcut && shortcut.code === event.code && shortcut.ctrl === event.ctrlKey && shortcut.meta === event.metaKey && shortcut.alt === event.altKey && shortcut.shift === event.shiftKey
  })?.id
}

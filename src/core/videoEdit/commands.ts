import { z } from 'zod'

export type VideoEditCommandScope = 'global' | 'timeline' | 'program' | 'source' | 'project' | 'effects' | 'content'
export interface VideoEditShortcut { code: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }
const key = (code: string, ctrl = false, shift = false, alt = false): VideoEditShortcut => ({ code, ctrl, shift, alt, meta: false })
const editScopes: VideoEditCommandScope[] = ['timeline', 'program']
const monitorScopes: VideoEditCommandScope[] = ['timeline', 'program', 'source']
/**
 * `alternates`：同一命令的第二组默认键（Premiere 里 Delete 与 Backspace 都能清除片段）。用户改键后只保留用户的那一个。
 * 默认键位以本机 Adobe Premiere Pro 2026（Windows）`Adobe Premiere Pro Defaults.kys` 为准，对照表见任务 2.2。
 */
function command<const T extends string>(id: T, title: string, scopes: VideoEditCommandScope[], shortcut?: VideoEditShortcut, repeat = false, alternates: readonly VideoEditShortcut[] = []) { return { id, title, scopes, shortcut, repeat, alternates } }
export const VIDEO_EDIT_COMMANDS = [
  command('new_project', '新建项目', ['global'], key('KeyN', true, false, true)),
  command('new_sequence', '新建序列', ['global'], key('KeyN', true)),
  command('import', '导入素材', ['global'], key('KeyI', true)),
  command('save', '保存剪辑', ['global'], key('KeyS', true)),
  command('undo', '撤销', ['global'], key('KeyZ', true)),
  command('redo', '重做', ['global'], key('KeyZ', true, true)),
  command('focus_project', '素材面板', ['global'], key('Digit1', false, true)),
  command('focus_source', '源监视器', ['global'], key('Digit2', false, true)),
  command('focus_timeline', '时间线', ['global'], key('Digit3', false, true)),
  command('focus_program', '节目监视器', ['global'], key('Digit4', false, true)),
  command('focus_effects', '效果控件', ['global'], key('Digit5', false, true)),
  command('maximize_panel', '最大化／还原光标下的面板组', ['global'], key('Backquote')),
  command('select_tool', '选择工具', ['timeline'], key('KeyV')),
  command('razor_tool', '剃刀工具', ['timeline'], key('KeyC')),
  command('hand_tool', '手形工具', ['timeline'], key('KeyH')),
  command('track_tool', '轨道向前选择', ['timeline'], key('KeyA')),
  command('play_pause', '播放／暂停', monitorScopes, key('Space')),
  command('step_back', '上一帧', monitorScopes, key('ArrowLeft'), true),
  command('step_forward', '下一帧', monitorScopes, key('ArrowRight'), true),
  command('step_back_five', '后退五帧', monitorScopes, key('ArrowLeft', false, true), true),
  command('step_forward_five', '前进五帧', monitorScopes, key('ArrowRight', false, true), true),
  command('play_reverse', '反向浏览（静音）', monitorScopes, key('KeyJ')),
  command('play_stop', '停止播放', monitorScopes, key('KeyK')),
  command('play_forward', '正向播放', monitorScopes, key('KeyL')),
  command('go_prev_edit', '转到上一个编辑点', editScopes, key('ArrowUp'), true),
  command('go_next_edit', '转到下一个编辑点', editScopes, key('ArrowDown'), true),
  command('go_prev_edit_any', '转到任意轨道上一个编辑点', editScopes, key('ArrowUp', false, true), true),
  command('go_next_edit_any', '转到任意轨道下一个编辑点', editScopes, key('ArrowDown', false, true), true),
  command('go_start', '转到序列开头', editScopes, key('Home')),
  command('go_end', '转到序列结尾', editScopes, key('End')),
  command('mark_in', '设置入点', monitorScopes, key('KeyI')),
  command('mark_out', '设置出点', monitorScopes, key('KeyO')),
  command('mark_clip', '标记片段', editScopes, key('KeyX')),
  command('go_in', '转到入点', editScopes, key('KeyI', false, true)),
  command('go_out', '转到出点', editScopes, key('KeyO', false, true)),
  command('clear_in', '清除入点', monitorScopes, key('KeyI', true, true)),
  command('clear_out', '清除出点', monitorScopes, key('KeyO', true, true)),
  command('clear_in_out', '清除入点和出点', monitorScopes, key('KeyX', true, true)),
  command('add_marker', '添加标记', editScopes, key('KeyM')),
  command('next_marker', '转到下一个标记', editScopes, key('KeyM', false, true), true),
  command('prev_marker', '转到上一个标记', editScopes, key('KeyM', true, true), true),
  command('select_clip_at_playhead', '选择播放头处的片段', editScopes, key('KeyD')),
  command('split', '在播放头拆分', editScopes, key('KeyK', true)),
  command('split_tracks', '拆分全部目标轨道', editScopes, key('KeyK', true, true)),
  command('delete', '删除片段', editScopes, key('Delete'), false, [key('Backspace')]),
  command('ripple_delete', '波纹删除', editScopes, key('Delete', false, true), false, [key('Backspace', false, false, true)]),
  command('lift', '提升', editScopes, key('Semicolon')),
  command('extract', '提取', editScopes, key('Quote')),
  // 过渡（PR 序列菜单）：Ctrl+D 在目标轨道离播放头最近的编辑点应用默认视频过渡，Ctrl+Shift+D 应用默认音频过渡，Shift+D 应用到所选片段两端。
  command('apply_video_transition', '应用视频过渡', editScopes, key('KeyD', true)),
  command('apply_audio_transition', '应用音频过渡', editScopes, key('KeyD', true, true)),
  command('apply_default_transitions', '将默认过渡应用到选择项', editScopes, key('KeyD', false, true)),
  command('ripple_trim_prev', '波纹修剪上一个编辑点到播放头', editScopes, key('KeyQ')),
  command('ripple_trim_next', '波纹修剪下一个编辑点到播放头', editScopes, key('KeyW')),
  command('nudge_left', '片段左移一帧', ['timeline'], key('ArrowLeft', false, false, true), true),
  command('nudge_right', '片段右移一帧', ['timeline'], key('ArrowRight', false, false, true), true),
  command('nudge_left_five', '片段左移五帧', ['timeline'], key('ArrowLeft', false, true, true), true),
  command('nudge_right_five', '片段右移五帧', ['timeline'], key('ArrowRight', false, true, true), true),
  command('nudge_up', '片段上移一轨', ['timeline'], key('ArrowUp', false, false, true), true),
  command('nudge_down', '片段下移一轨', ['timeline'], key('ArrowDown', false, false, true), true),
  command('toggle_snapping', '吸附', ['timeline'], key('KeyS')),
  command('toggle_linked_selection', '链接选择', ['timeline']),
  command('cut', '剪切片段', editScopes, key('KeyX', true)),
  command('copy', '复制片段', editScopes, key('KeyC', true)),
  command('paste', '粘贴片段', editScopes, key('KeyV', true)),
  command('paste_insert', '粘贴插入', editScopes, key('KeyV', true, true)),
  command('insert', '插入', ['timeline', 'program', 'source', 'project'], key('Comma')),
  command('overwrite', '覆盖', ['timeline', 'program', 'source', 'project'], key('Period')),
  command('select_all', '全选', ['timeline', 'program', 'project'], key('KeyA', true)),
  command('deselect_all', '取消全选', ['timeline', 'program', 'project'], key('KeyA', true, true)),
  command('export', '导出视频', ['global'], key('KeyM', true)),
  command('zoom_in', '放大时间线', ['timeline'], key('Equal'), true),
  command('zoom_out', '缩小时间线', ['timeline'], key('Minus'), true),
  command('zoom_to_sequence', '缩放到整个序列', ['timeline', 'program'], key('Backslash')),
  command('previous_screen', '显示上一屏', ['timeline'], key('PageUp'), true),
  command('next_screen', '显示下一屏', ['timeline'], key('PageDown'), true),
  command('increase_video_tracks', '增加视频轨道高度', ['timeline'], key('Equal', true), true),
  command('decrease_video_tracks', '减小视频轨道高度', ['timeline'], key('Minus', true), true),
  command('increase_audio_tracks', '增加音频轨道高度', ['timeline'], key('Equal', false, false, true), true),
  command('decrease_audio_tracks', '减小音频轨道高度', ['timeline'], key('Minus', false, false, true), true),
  command('expand_all_tracks', '展开所有轨道', ['timeline'], key('Equal', false, true)),
  command('minimize_all_tracks', '最小化所有轨道', ['timeline'], key('Minus', false, true)),
  command('toggle_link', '链接／取消链接', editScopes, key('KeyL', true)),
  command('link', '链接片段', editScopes), command('unlink', '解除链接', editScopes),
  command('group', '编组', editScopes, key('KeyG', true)), command('ungroup', '解除编组', editScopes, key('KeyG', true, true)),
  command('separate_audio', '拆开音画', editScopes),
  command('move_into_sync', '移入同步', editScopes), command('slip_into_sync', '滑入同步', editScopes),
  command('locate_source', '打开源素材', editScopes), command('locate_project', '在素材中定位', editScopes),
  command('locate_effects', '编辑片段属性', editScopes),
  command('new_bin', '新建素材箱', ['project'], key('KeyB', true)),
  command('open_in_source', '在源监视器中打开', ['project'], key('KeyO', false, true)),
  command('project_list_view', '素材列表视图', ['project'], key('PageUp', true)),
  command('project_icon_view', '素材图标视图', ['project'], key('PageDown', true)),
  command('project_toggle_view', '切换素材视图', ['project'], key('Backslash', false, true)),
] as const
export type VideoEditCommandId = typeof VIDEO_EDIT_COMMANDS[number]['id']
export type VideoEditShortcutOverrides = Partial<Record<VideoEditCommandId, VideoEditShortcut | null>>
const shortcutSchema = z.object({ code: z.string().regex(/^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2])|Space|Arrow(?:Left|Right|Up|Down)|Delete|Backspace|Comma|Period|Equal|Minus|Bracket(?:Left|Right)|Backslash|Semicolon|Quote|Slash|Backquote|Home|End|Page(?:Up|Down))$/), ctrl: z.boolean(), alt: z.boolean(), shift: z.boolean(), meta: z.boolean() }).strict()
export function videoEditShortcutLabel(shortcut: VideoEditShortcut | null | undefined): string {
  if (!shortcut) return '未设置'
  const labels: Record<string, string> = { Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Comma: ',', Period: '.', Equal: '=', Minus: '-', Backslash: '\\', Semicolon: ';', Quote: "'", Slash: '/', Backquote: '`', BracketLeft: '[', BracketRight: ']', PageUp: 'PgUp', PageDown: 'PgDn' }
  return [shortcut.ctrl ? 'Ctrl' : '', shortcut.meta ? 'Cmd' : '', shortcut.alt ? 'Alt' : '', shortcut.shift ? 'Shift' : '', labels[shortcut.code] ?? shortcut.code.replace(/^(?:Key|Digit)/, '')].filter(Boolean).join('+')
}
function descriptorOf(id: VideoEditCommandId) { return VIDEO_EDIT_COMMANDS.find(command => command.id === id)! }
/** 全部生效键位：用户改过（含清除）只用用户的；否则默认键加第二组默认键。 */
export function videoEditCommandShortcuts(id: VideoEditCommandId, overrides: VideoEditShortcutOverrides): VideoEditShortcut[] {
  if (Object.hasOwn(overrides, id)) { const value = overrides[id]; return value ? [value] : [] }
  const descriptor = descriptorOf(id)
  return descriptor.shortcut ? [descriptor.shortcut, ...descriptor.alternates] : []
}
/** 主键位（提示文字、菜单显示用）。 */
export function videoEditCommandShortcut(id: VideoEditCommandId, overrides: VideoEditShortcutOverrides): VideoEditShortcut | undefined {
  return videoEditCommandShortcuts(id, overrides)[0]
}
function signature(value: VideoEditShortcut): string { return [value.code, value.ctrl, value.meta, value.alt, value.shift].join(':') }
/** 同一作用域（含全局）内键位相同的命令对。 */
function shortcutConflicts(overrides: VideoEditShortcutOverrides): Array<{ first: typeof VIDEO_EDIT_COMMANDS[number]; second: typeof VIDEO_EDIT_COMMANDS[number]; binding: VideoEditShortcut }> {
  const conflicts: Array<{ first: typeof VIDEO_EDIT_COMMANDS[number]; second: typeof VIDEO_EDIT_COMMANDS[number]; binding: VideoEditShortcut }> = []
  const bindings = VIDEO_EDIT_COMMANDS.map(command => new Map(videoEditCommandShortcuts(command.id, overrides).map(binding => [signature(binding), binding])))
  for (let index = 0; index < VIDEO_EDIT_COMMANDS.length; index++) {
    const first = VIDEO_EDIT_COMMANDS[index]
    if (!bindings[index].size) continue
    for (let other = index + 1; other < VIDEO_EDIT_COMMANDS.length; other++) {
      const second = VIDEO_EDIT_COMMANDS[other]
      const shared = first.scopes.includes('global') || second.scopes.includes('global') || first.scopes.some(scope => second.scopes.includes(scope))
      if (!shared) continue
      for (const [value, binding] of bindings[index]) if (bindings[other].has(value)) conflicts.push({ first, second, binding })
    }
  }
  return conflicts
}
const optionalShortcutSchema = shortcutSchema.nullable().optional()
const shortcutFields = Object.fromEntries(VIDEO_EDIT_COMMANDS.map(command => [command.id, optionalShortcutSchema])) as Record<VideoEditCommandId, typeof optionalShortcutSchema>
export const videoEditShortcutOverridesSchema = z.object(shortcutFields).strict().superRefine((values, context) => {
  const ids = new Set<string>(VIDEO_EDIT_COMMANDS.map(command => command.id))
  for (const id of Object.keys(values)) if (!ids.has(id)) context.addIssue({ code: 'custom', path: [id], message: '此剪辑命令不存在。' })
  for (const { first, second, binding } of shortcutConflicts(values as VideoEditShortcutOverrides)) context.addIssue({ code: 'custom', path: [first.id], message: `“${first.title}”与“${second.title}”的快捷键冲突：${videoEditShortcutLabel(binding)}。` })
})
export function parseVideoEditShortcutOverrides(values: unknown): VideoEditShortcutOverrides {
  const result = videoEditShortcutOverridesSchema.safeParse(values)
  if (!result.success) throw new Error(result.error.issues[0]?.code === 'unrecognized_keys' ? '此剪辑命令不存在。' : result.error.issues[0]?.message ?? '快捷键配置无效。')
  return result.data as VideoEditShortcutOverrides
}
/**
 * 读取已保存的改键（启动恢复用）：丢掉不认识的命令和无效键位；默认键位更新后若与用户自己设的键冲突，
 * 保留用户的键、让出冲突的默认键（该命令变为未设置），两条用户键互相冲突时保留先出现的那条。结果总能通过校验。
 */
export function sanitizeVideoEditShortcutOverrides(values: unknown): VideoEditShortcutOverrides {
  const result: VideoEditShortcutOverrides = {}
  if (typeof values !== 'object' || values === null) return result
  for (const command of VIDEO_EDIT_COMMANDS) {
    if (!Object.hasOwn(values, command.id)) continue
    const value = (values as Record<string, unknown>)[command.id]
    if (value === null) result[command.id] = null
    else { const parsed = shortcutSchema.safeParse(value); if (parsed.success) result[command.id] = parsed.data }
  }
  for (let guard = 0; guard <= VIDEO_EDIT_COMMANDS.length; guard++) {
    const conflict = shortcutConflicts(result)[0]
    if (!conflict) return result
    const loser = Object.hasOwn(result, conflict.second.id) && !Object.hasOwn(result, conflict.first.id) ? conflict.first : conflict.second
    result[loser.id] = null
  }
  return result
}
export interface VideoEditKeyEvent { code: string; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; isComposing: boolean; defaultPrevented: boolean }
export function matchVideoEditShortcut(event: VideoEditKeyEvent, scope: VideoEditCommandScope, overrides: VideoEditShortcutOverrides, editable = false): VideoEditCommandId | undefined {
  if (editable || event.defaultPrevented || event.isComposing || event.key === 'Process' || event.key === 'Unidentified') return
  return VIDEO_EDIT_COMMANDS.find(command => {
    if ((!command.scopes.includes('global') && !command.scopes.includes(scope)) || event.repeat && !command.repeat) return false
    return videoEditCommandShortcuts(command.id, overrides).some(shortcut => shortcut.code === event.code && shortcut.ctrl === event.ctrlKey && shortcut.meta === event.metaKey && shortcut.alt === event.altKey && shortcut.shift === event.shiftKey)
  })?.id
}

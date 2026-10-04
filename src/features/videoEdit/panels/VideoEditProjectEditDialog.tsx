import { useState } from 'react'
import { UiButton, UiError, UiFormRow, UiInput, UiModal, UiSelect } from '@/components/ui'
import type { VideoEditBin, VideoEditItem } from '@/core/videoEdit/document'
export type ProjectEditDialog = { kind: 'items'; items: VideoEditItem[] } | { kind: 'bin'; bin: VideoEditBin } | { kind: 'createBin'; parentId: string }
export function VideoEditProjectEditDialog({ value, bins, onClose, onSubmit }: { value: ProjectEditDialog; bins: VideoEditBin[]; onClose: () => void; onSubmit: (values: { name?: string; binId: string; tags?: string[] }) => void }): React.ReactElement {
  const [name, setName] = useState(value.kind === 'items' ? value.items.length === 1 ? value.items[0].name : '' : value.kind === 'bin' ? value.bin.name : '新素材箱')
  const [binId, setBinId] = useState(value.kind === 'items' ? value.items[0]?.binId ?? '' : value.kind === 'bin' ? value.bin.parentId ?? '' : value.parentId)
  const [tags, setTags] = useState(value.kind === 'items' ? (value.items[0]?.tags ?? []).join(', ') : '')
  const [tagsEdited, setTagsEdited] = useState(false)
  const [error, setError] = useState('')
  const single = value.kind !== 'items' || value.items.length === 1
  const submit = (): void => { if (single && !name.trim()) { setError('请输入名称。'); return } try { onSubmit({ ...(single ? { name: name.trim() } : {}), binId, ...(value.kind === 'items' && (single || tagsEdited) ? { tags: [...new Set(tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))] } : {}) }); onClose() } catch (error) { setError(error instanceof Error ? error.message : String(error)) } }
  return <UiModal isOpen title={value.kind === 'items' ? `编辑${value.items.length > 1 ? ` ${value.items.length} 个` : ''}项目项` : value.kind === 'bin' ? '编辑素材箱' : '新建素材箱'} onClose={onClose} footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="primary" onClick={submit}>保存</UiButton></>}>
    <div className="space-y-3">
      {single && <UiFormRow label="名称"><UiInput aria-label="项目项名称" className="w-full" value={name} maxLength={200} onChange={event => setName(event.target.value)} /></UiFormRow>}
      <UiFormRow label={value.kind === 'items' ? '移动到素材箱' : '上级素材箱'}><UiSelect aria-label="移动到素材箱" className="w-full" value={binId} onChange={event => setBinId(event.target.value)}><option value="">工程根目录</option>{bins.filter(bin => value.kind !== 'bin' || bin.id !== value.bin.id).map(bin => <option key={bin.id} value={bin.id}>{bin.name}</option>)}</UiSelect></UiFormRow>
      {value.kind === 'items' && <UiFormRow label={single ? '标签' : '批量设置标签'}><UiInput aria-label="项目项标签" className="w-full" value={single || tagsEdited ? tags : ''} placeholder={single ? '用逗号分隔' : '留空保留原标签；修改后应用到全部选中项'} onChange={event => { setTags(event.target.value); setTagsEdited(true) }} /></UiFormRow>}
      {error && <UiError size="xs" align="start" title={error} message="" />}
    </div>
  </UiModal>
}

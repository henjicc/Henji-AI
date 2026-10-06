import { useState } from 'react'
import { Dropdown, UiButton, UiFormRow, UiModal } from '@/components/ui'
import type { VideoProxyPreset } from '@/core/videoEdit/proxy'
import { createVideoEditProxy } from '../application/videoEditProxy'

/** The dialog only chooses a preset; the project owns the cancellable background job. */
export function VideoEditProxyDialog({ projectId, mediaIds, onClose, onError }: { projectId: string; mediaIds: string[]; onClose: () => void; onError: (error: unknown) => void }): React.ReactElement {
  const [preset, setPreset] = useState<VideoProxyPreset>('720p')
  const create = (): void => {
    onClose()
    void (async () => { for (const id of mediaIds) { try { await createVideoEditProxy(projectId, id, preset) } catch (error) { if (error instanceof Error && /已取消|已关闭/.test(error.message)) return; onError(error) } } })()
  }
  return <UiModal isOpen title="创建代理" onClose={onClose} size="compact" footer={<><UiButton onClick={onClose}>取消</UiButton><UiButton variant="primary" onClick={create}>创建</UiButton></>}>
    <UiFormRow label="代理分辨率" info="代理用于流畅预览，导出使用原片。创建在后台进行，可在素材右键菜单取消。"><Dropdown<VideoProxyPreset> ariaLabel="代理分辨率" value={preset} options={[{ value: '720p', label: '720p' }, { value: '540p', label: '540p' }]} onSelect={setPreset} /></UiFormRow>
  </UiModal>
}

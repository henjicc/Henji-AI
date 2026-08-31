import { useRef, useState } from 'react'

import { UiButton, UiModal } from '@/components/ui'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import type { MaskEditorV3Result } from '../types'
import {
  MaskEditorV3Host,
  type MaskEditorV3HostHandle,
} from './MaskEditorV3Host'

export interface MaskEditorV3ModalProps {
  isOpen: boolean
  sourceImage: string
  sessionReference: ImageEditSessionReferenceV3
  targetLayerId: string
  onCancel: () => void
  onConfirm: (result: MaskEditorV3Result) => void | Promise<void>
}

export function MaskEditorV3Modal({
  isOpen,
  sourceImage,
  sessionReference,
  targetLayerId,
  onCancel,
  onConfirm,
}: MaskEditorV3ModalProps): JSX.Element {
  const hostRef = useRef<MaskEditorV3HostHandle | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState(false)
  if (!isOpen) return <></>

  const confirm = async (): Promise<void> => {
    if (confirming) return
    setConfirming(true)
    setConfirmError(false)
    try {
      const persisted = await hostRef.current?.flush()
      if (!persisted) throw new Error('可编辑蒙版尚未准备完成')
      await onConfirm({
        kind: 'image-edit-v3-mask',
        sessionReference: persisted,
        targetLayerId,
      })
    } catch {
      setConfirmError(true)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <UiModal
      isOpen
      title="绘制局部重绘遮罩"
      ariaLabel="绘制局部重绘遮罩"
      hideHeader
      size="workspace"
      contentClassName="p-0"
      onClose={() => { if (!confirming) onCancel() }}
    >
      <MaskEditorV3Host
        ref={hostRef}
        sourceImageUrl={sourceImage}
        sessionReference={sessionReference}
        targetLayerId={targetLayerId}
        toolbarActions={(
          <div className="flex items-center gap-2">
            {confirmError ? (
              <span role="alert" className="text-xs text-danger">保存蒙版失败，请重试</span>
            ) : null}
            <UiButton
              type="button"
              variant="ghost"
              size="sm"
              disabled={confirming}
              onClick={onCancel}
            >
              取消
            </UiButton>
            <UiButton
              type="button"
              variant="primary"
              size="sm"
              disabled={confirming}
              onClick={() => { void confirm() }}
            >
              {confirming ? '正在保存…' : '完成'}
            </UiButton>
          </div>
        )}
        className="min-h-0 flex-1"
      />
    </UiModal>
  )
}

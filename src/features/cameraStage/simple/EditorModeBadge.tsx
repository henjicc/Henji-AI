import React, { useState } from 'react'
import { UiButton, UiModal } from '@/components/ui'
import { bakeCurrentProjectToPro } from '../projects/cameraStageProjectService'
import { useCameraStageStore } from '../store/cameraStageStore'

/** 顶栏工程模式标识与简易工程单向烘焙入口。 */
const EditorModeBadge: React.FC = () => {
  const editorMode = useCameraStageStore((state) => state.editorMode)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const handleBake = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setErrorMessage(null)
    try {
      await bakeCurrentProjectToPro()
      setConfirmOpen(false)
    } catch {
      setErrorMessage('转换已完成，但保存失败。请使用工程保存功能重试保存。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="rounded-md border border-border-dark bg-layer px-2 py-1 text-xs text-text-muted">
        {editorMode === 'simple' ? '简易' : '专业'}
      </span>
      {editorMode === 'simple' && (
        <UiButton
          size="sm"
          variant="ghost"
          onClick={() => {
            setErrorMessage(null)
            setConfirmOpen(true)
          }}
          title="将镜头卡单向烘焙为专业关键帧工程"
          className="h-6 border-0 px-1.5 text-xs"
        >
          转为专业工程
        </UiButton>
      )}
      <UiModal
        isOpen={confirmOpen}
        title="转为专业工程？"
        onClose={() => {
          if (!saving) setConfirmOpen(false)
        }}
        footer={(
          <>
            <UiButton variant="ghost" disabled={saving} onClick={() => setConfirmOpen(false)}>取消</UiButton>
            <UiButton variant="primary" disabled={saving} onClick={() => void handleBake()}>
              {saving ? '正在转换…' : '确认转换'}
            </UiButton>
          </>
        )}
      >
        <div className="space-y-2 text-sm text-text-muted">
          <p>此操作不可逆。当前镜头卡会固化为专业时间轴上的关键帧，之后无法再以镜头卡方式编辑。</p>
          <p>摄像机效果器与当前播放效果会保留，转换后将立即保存工程，并清空撤销历史。</p>
          {errorMessage && <p className="text-danger">{errorMessage}</p>}
        </div>
      </UiModal>
    </div>
  )
}

export default EditorModeBadge

import React, { useEffect, useState } from 'react'

import { UiButton, UiPanel } from '@/components/ui'
import Toggle from '@/components/ui/Toggle'
import { useI18n } from '@/hooks/useI18n'
import { useLargeUploadPromptStore } from '@/services/largeUploadPolicy'

/**
 * 大文件上传处理询问弹窗（全局挂载一次，见 App.tsx）。
 * 超过 100MB 的本地媒体在"每次询问"策略下经 useLargeUploadPromptStore 排队弹出；
 * 必须二选一（复制 / 引用），不提供取消——上传动作已由用户主动发起。
 */
export const LargeUploadChoiceDialog: React.FC = () => {
  const { t } = useI18n('common')
  const current = useLargeUploadPromptStore((state) => state.queue[0] ?? null)
  const settleCurrent = useLargeUploadPromptStore((state) => state.settleCurrent)
  const [remember, setRemember] = useState(false)

  // 每个新请求弹出时重置"记住选择"，避免上一次的勾选残留
  useEffect(() => {
    if (current) {
      setRemember(false)
    }
  }, [current])

  if (!current) {
    return null
  }

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60">
      <UiPanel className="w-[460px] space-y-4 p-5">
        <h3 className="text-base font-semibold text-text-dark">
          {t('largeUpload.title')}
        </h3>
        <p className="text-sm leading-relaxed text-zinc-300">
          {t('largeUpload.message', { name: current.fileName, size: current.sizeMB })}
        </p>

        <div className="space-y-2">
          <UiButton
            variant="primary"
            className="w-full justify-start !py-2.5"
            onClick={() => settleCurrent('copy', remember)}
          >
            {t('largeUpload.copyButton')}
          </UiButton>
          <p className="px-1 text-xs text-zinc-500">{t('largeUpload.copyHint')}</p>

          <UiButton
            variant="muted"
            className="w-full justify-start !py-2.5"
            onClick={() => settleCurrent('reference', remember)}
          >
            {t('largeUpload.referenceButton')}
          </UiButton>
          <p className="px-1 text-xs text-zinc-500">{t('largeUpload.referenceHint')}</p>
        </div>

        <div className="border-t border-border-dark pt-3">
          <Toggle
            label={t('largeUpload.rememberLabel')}
            checked={remember}
            onChange={setRemember}
            onText={t('largeUpload.rememberOn')}
            offText={t('largeUpload.rememberOff')}
            className="flex w-full items-center justify-between gap-4"
          />
          <p className="mt-2 text-xs text-zinc-500">{t('largeUpload.rememberHint')}</p>
        </div>
      </UiPanel>
    </div>
  )
}

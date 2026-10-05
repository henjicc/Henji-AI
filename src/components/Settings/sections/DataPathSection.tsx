import React from 'react'
import { UiButton, UiFormRow, UiInput } from '@/components/ui'
import DataPathDialogs from '../components/DataPathDialogs'
import { useDataPath } from '../hooks/useDataPath'
import { useI18n } from '@/hooks/useI18n'

/**
 * 作品目录（默认“文档/痕迹AI”）：项目、各类文档、生成结果、上传素材、导出、助手技能。
 * 数据库、日志、缓存等程序数据在程序目录，不在这里展示也不随之移动。
 */
const DataPathSection: React.FC = () => {
  const { t } = useI18n('settings')
  const dataPath = useDataPath()
  const { currentPath, isCustom, isMigrating } = dataPath

  return (
    <>
      {/* 常驻说明：更换会移动全部作品并重新启动，属于「不看就可能误操作」那一档 */}
      <UiFormRow label={t('sections.dataPath.pathLabel')} hint={t('sections.dataPath.pathHint')}>
        {/* 按钮与输入框同为 32 高（同一行控件同一外框高度） */}
        <div className="flex items-center gap-2">
          {/* 这里是明文本地绝对路径（不像密钥框那样自带掩码），
              助手观察截图时必须遮住，否则路径会原样进模型。 */}
          <UiInput
            data-observation-sensitive
            value={currentPath}
            title={currentPath}
            readOnly
            className="min-w-0 flex-1 font-mono"
          />
          <UiButton
            onClick={() => void dataPath.openInFileManager()}
            disabled={isMigrating || !currentPath}
            variant="secondary"
            className="shrink-0"
          >
            {t('actions.openInFileManager')}
          </UiButton>
          <UiButton
            onClick={() => void dataPath.selectDirectory()}
            disabled={isMigrating || !currentPath}
            variant="secondary"
            className="shrink-0"
          >
            {t('actions.changeLocation')}
          </UiButton>
          {/* 已在默认位置时没有可恢复的内容，不显示 */}
          {isCustom ? (
            <UiButton
              onClick={() => void dataPath.openResetConfirm()}
              disabled={isMigrating}
              variant="secondary"
              className="shrink-0"
            >
              {t('actions.resetDefault')}
            </UiButton>
          ) : null}
        </div>
      </UiFormRow>

      <DataPathDialogs dataPath={dataPath} />
    </>
  )
}

export default DataPathSection

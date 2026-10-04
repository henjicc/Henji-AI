import React, { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Search } from 'lucide-react'
import { Virtuoso } from 'react-virtuoso'
import {
  UI_TEXT_BODY_CLASS,
  UI_TEXT_LABEL_CLASS,
  UI_TEXT_META_CLASS,
  UI_TEXT_TITLE_CLASS,
  UiButton,
  UiEmpty,
  UiInput,
  UiModal,
  UiNavButton,
  UiPanel,
} from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { useExternalLink } from '../hooks/useExternalLink'
import {
  filterThirdPartyComponents,
  type ThirdPartyComponent,
  type ThirdPartyNotices,
} from './thirdPartyLicenses'

/** 许可全文：组件自带的多份文件（如 LICENSE-MIT 与 LICENSE-APACHE）依次排列，整块下沉为只读预览。 */
export const LicenseTextBlock: React.FC<{ texts: readonly string[] }> = ({ texts }) => (
  <div className="space-y-3">
    {texts.map((text, index) => (
      <UiPanel key={index} variant="inset" className="p-3">
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-text2">{text}</pre>
      </UiPanel>
    ))}
  </div>
)

const ExternalLinkButton: React.FC<{ url: string; label?: string }> = ({ url, label }) => {
  const { openExternal } = useExternalLink()
  return (
    <UiButton
      type="button"
      className="max-w-full justify-start gap-1.5 !px-2"
      onClick={() => void openExternal(url)}
    >
      <span className="truncate">{label ?? url}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
    </UiButton>
  )
}

const ComponentDetail: React.FC<{ component: ThirdPartyComponent; texts: Record<string, string> }> = ({ component, texts }) => {
  const { t } = useI18n('settings')
  const licenseTexts = component.textIds.map((id) => texts[id]).filter((text): text is string => typeof text === 'string')
  const license = component.license ?? t('sections.about.viewer.unknownLicense')

  return (
    <div className="space-y-5">
      <div>
        <h3 className={UI_TEXT_TITLE_CLASS}>{component.name}</h3>
        <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>
          {[component.version, license].filter(Boolean).join(' · ')}
        </p>
      </div>

      {component.homepage ? (
        <div>
          <div className={UI_TEXT_LABEL_CLASS}>{t('sections.about.viewer.homepage')}</div>
          <div className="-ml-2 mt-1"><ExternalLinkButton url={component.homepage} /></div>
        </div>
      ) : null}

      {component.sources?.length ? (
        <div>
          <div className={UI_TEXT_LABEL_CLASS}>{t('sections.about.viewer.source')}</div>
          <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>{t('sections.about.viewer.sourceHint')}</p>
          <div className="-ml-2 mt-1 flex flex-col items-start">
            {component.sources.map((url) => <ExternalLinkButton key={url} url={url} />)}
          </div>
        </div>
      ) : null}

      {component.includes?.length ? (
        <div>
          <div className={UI_TEXT_LABEL_CLASS}>{t('sections.about.viewer.includes')}</div>
          <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>{component.includes.join(', ')}</p>
        </div>
      ) : null}

      <div>
        <div className={UI_TEXT_LABEL_CLASS}>{t('sections.about.viewer.licenseText')}</div>
        {component.licenseFileHint ? (
          <p className={`mt-1 ${UI_TEXT_BODY_CLASS}`}>{t('sections.about.viewer.fileHint', { file: component.licenseFileHint })}</p>
        ) : null}
        {component.textOrigin === 'standard' && licenseTexts.length > 0 ? (
          <p className={`mt-1 ${UI_TEXT_META_CLASS}`}>{t('sections.about.viewer.standardText', { license })}</p>
        ) : null}
        {licenseTexts.length > 0 ? (
          <div className="mt-2"><LicenseTextBlock texts={licenseTexts} /></div>
        ) : component.licenseFileHint ? null : (
          <p className={`mt-1 ${UI_TEXT_BODY_CLASS}`}>{t('sections.about.viewer.noText')}</p>
        )}
      </div>
    </div>
  )
}

interface LicenseViewerDialogProps {
  open: boolean
  notices: ThirdPartyNotices
  /** 打开时选中的组件；省略则选中第一项 */
  initialComponentId?: string | null
  onClose: () => void
}

/**
 * 第三方组件许可查看器：左侧可搜索列表（组件数百个，用虚拟列表），右侧为所选组件的许可详情。
 */
const LicenseViewerDialog: React.FC<LicenseViewerDialogProps> = ({ open, notices, initialComponentId, onClose }) => {
  const { t } = useI18n('settings')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(initialComponentId ?? null)

  // 每次打开都回到调用方指定的组件，并清空上一次的搜索。
  useEffect(() => {
    if (!open) return
    setKeyword('')
    setSelectedId(initialComponentId ?? null)
  }, [open, initialComponentId])

  const filtered = useMemo(() => filterThirdPartyComponents(notices.components, keyword), [notices.components, keyword])
  const selected = notices.components.find((component) => component.id === selectedId) ?? filtered[0] ?? null
  const initialIndex = Math.max(0, filtered.findIndex((component) => component.id === selected?.id))

  return (
    <UiModal
      isOpen={open}
      title={t('sections.about.viewer.title')}
      onClose={onClose}
      size="editor"
      contentClassName="flex min-h-0 flex-1"
    >
      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col gap-2 border-r border-line p-3">
          <div className="relative">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text2" />
            <UiInput
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('sections.about.viewer.searchPlaceholder')}
              aria-label={t('sections.about.viewer.searchPlaceholder')}
              className="pl-9"
            />
          </div>
          <p className={`px-1 ${UI_TEXT_META_CLASS}`}>{t('sections.about.allComponentsCount', { count: filtered.length })}</p>
          {filtered.length === 0 ? (
            <UiEmpty size="sm" title={t('sections.about.viewer.empty')} description={t('sections.about.viewer.emptyHint')} />
          ) : (
            <Virtuoso
              className="ui-scrollbar min-h-0 flex-1"
              data={filtered}
              initialTopMostItemIndex={initialIndex}
              computeItemKey={(_, component) => component.id}
              itemContent={(_, component) => (
                <UiNavButton
                  type="button"
                  active={component.id === selected?.id}
                  aria-current={component.id === selected?.id ? 'true' : undefined}
                  onClick={() => setSelectedId(component.id)}
                  size="auto"
                  className="flex-col !items-start"
                >
                  <span className="w-full truncate text-sm">{component.name}</span>
                  <span className={`w-full truncate ${UI_TEXT_META_CLASS}`}>
                    {[component.version, component.license].filter(Boolean).join(' · ')}
                  </span>
                </UiNavButton>
              )}
            />
          )}
        </div>
        <div className="ui-scrollbar min-w-0 flex-1 overflow-y-auto p-4">
          {selected ? <ComponentDetail component={selected} texts={notices.texts} /> : null}
        </div>
      </div>
    </UiModal>
  )
}

export default LicenseViewerDialog

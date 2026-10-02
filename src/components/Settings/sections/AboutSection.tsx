import React, { useEffect, useState } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import {
  UI_TEXT_META_CLASS,
  UiButton,
  UiError,
  UiFormRow,
  UiLoading,
  UiModal,
  UiOptionButton,
} from '@/components/ui'
import { useI18n } from '@/hooks/useI18n'
import { getCurrentVersion } from '@/services/updateChecker'
import { useExternalLink } from '../hooks/useExternalLink'
import {
  ABOUT_AUTHOR_NAME,
  ABOUT_AUTHOR_URL,
  ABOUT_PROJECT_URL,
  ABOUT_PROJECT_URL_LABEL,
} from '../about/aboutInfo'
import LicenseViewerDialog, { LicenseTextBlock } from '../about/LicenseViewerDialog'
import { loadThirdPartyNotices, type ThirdPartyNotices } from '../about/thirdPartyLicenses'

type NoticesState =
  | { status: 'loading' }
  | { status: 'ready'; notices: ThirdPartyNotices }
  | { status: 'unavailable' }

/**
 * 设置 → 关于：软件名称与版本、作者、项目主页、本项目开源协议，以及随软件分发的第三方组件许可。
 * 第三方清单与安装包随附的许可文件来自同一份构建产物（见 about/thirdPartyLicenses.ts）。
 */
const AboutSection: React.FC = () => {
  const { t } = useI18n('settings')
  const { openExternal } = useExternalLink()
  const [state, setState] = useState<NoticesState>({ status: 'loading' })
  const [projectLicenseOpen, setProjectLicenseOpen] = useState(false)
  const [viewer, setViewer] = useState<{ open: boolean; componentId: string | null }>({ open: false, componentId: null })

  useEffect(() => {
    let active = true
    loadThirdPartyNotices()
      .then((notices) => { if (active) setState({ status: 'ready', notices }) })
      .catch(() => { if (active) setState({ status: 'unavailable' }) })
    return () => { active = false }
  }, [])

  const notices = state.status === 'ready' ? state.notices : null
  const highlights = notices
    ? notices.highlights
      .map((id) => notices.components.find((component) => component.id === id))
      .filter((component): component is NonNullable<typeof component> => Boolean(component))
    : []
  const projectLicenseText = notices?.texts[notices.project.licenseTextId]

  return (
    <>
      <UiFormRow label={t('sections.about.productName')} inline>
        <span className={`font-mono ${UI_TEXT_META_CLASS}`}>{getCurrentVersion()}</span>
      </UiFormRow>

      <UiFormRow label={t('sections.about.authorLabel')} inline>
        <UiButton type="button" variant="plain" size="sm" className="-mr-3 gap-1.5" onClick={() => void openExternal(ABOUT_AUTHOR_URL)}>
          {ABOUT_AUTHOR_NAME}
          <ExternalLink className="h-3.5 w-3.5" />
        </UiButton>
      </UiFormRow>

      <UiFormRow label={t('sections.about.homepageLabel')} inline>
        <UiButton type="button" variant="plain" size="sm" className="-mr-3 gap-1.5" onClick={() => void openExternal(ABOUT_PROJECT_URL)}>
          {ABOUT_PROJECT_URL_LABEL}
          <ExternalLink className="h-3.5 w-3.5" />
        </UiButton>
      </UiFormRow>

      <UiFormRow label={t('sections.about.licenseLabel')} inline>
        <span className={UI_TEXT_META_CLASS}>{notices?.project.license ?? 'Apache-2.0'}</span>
        <UiButton
          type="button"
          variant="muted"
          size="sm"
          className="px-4"
          disabled={!projectLicenseText}
          onClick={() => setProjectLicenseOpen(true)}
        >
          {t('sections.about.viewLicense')}
        </UiButton>
      </UiFormRow>

      <UiFormRow label={t('sections.about.componentsLabel')} info={t('sections.about.componentsInfo')}>
        {state.status === 'loading' ? <UiLoading size="xs" message={t('sections.about.loading')} /> : null}
        {state.status === 'unavailable' ? <UiError size="sm" message={t('sections.about.unavailable')} /> : null}
        {notices ? (
          <div className="-mx-3 space-y-0.5">
            {highlights.map((component) => (
              <UiOptionButton
                key={component.id}
                type="button"
                variant="menu"
                className="w-full justify-between gap-3 !px-3"
                onClick={() => setViewer({ open: true, componentId: component.id })}
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-sm text-text-dark">{component.name}</span>
                  {component.version ? <span className={`truncate font-mono ${UI_TEXT_META_CLASS}`}>{component.version}</span> : null}
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className={UI_TEXT_META_CLASS}>{component.license}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-text-muted" />
                </span>
              </UiOptionButton>
            ))}
          </div>
        ) : null}
      </UiFormRow>

      {notices ? (
        <UiFormRow
          label={t('sections.about.allComponentsLabel')}
          hint={t('sections.about.allComponentsCount', { count: notices.components.length })}
          inline
        >
          <UiButton
            type="button"
            variant="muted"
            size="sm"
            className="px-4"
            onClick={() => setViewer({ open: true, componentId: null })}
          >
            {t('sections.about.viewAll')}
          </UiButton>
        </UiFormRow>
      ) : null}

      <UiModal
        isOpen={projectLicenseOpen}
        title={t('sections.about.projectLicenseTitle', { license: notices?.project.license ?? 'Apache-2.0' })}
        onClose={() => setProjectLicenseOpen(false)}
        size="editor"
        contentClassName="ui-scrollbar min-h-0 flex-1 overflow-y-auto p-4"
      >
        {projectLicenseText ? <LicenseTextBlock texts={[projectLicenseText]} /> : null}
      </UiModal>

      {notices ? (
        <LicenseViewerDialog
          open={viewer.open}
          notices={notices}
          initialComponentId={viewer.componentId}
          onClose={() => setViewer((current) => ({ ...current, open: false }))}
        />
      ) : null}
    </>
  )
}

export default AboutSection

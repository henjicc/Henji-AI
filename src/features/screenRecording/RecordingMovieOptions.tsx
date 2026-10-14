import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Dropdown, UiButton, UiDisclosurePanel, UiFormRow, UiGroup, UiSegmented, UiSwitch } from '@/components/ui'
import { RECORDING_MOVIE_RECIPES, type RecordingMovieRecipe } from '@/core/screenRecording/movie'

type StyleKey = keyof typeof RECORDING_MOVIE_RECIPES

/**
 * What to do with a finished recording: turn it into a ready-to-share movie in one click.
 * The style is the only real decision; framing details stay folded until someone wants them.
 */
export function RecordingMovieOptions({ value, onChange, disabled, speedups }: { value: RecordingMovieRecipe; onChange: (recipe: RecordingMovieRecipe) => void; disabled: boolean; speedups: number }): React.ReactElement {
  const { t } = useTranslation('ui')
  const [more, setMore] = useState(false)
  const style = (Object.entries(RECORDING_MOVIE_RECIPES) as Array<[StyleKey, RecordingMovieRecipe]>).find(([, recipe]) => recipe.trimPauses === value.trimPauses && recipe.waitSpeed === value.waitSpeed && recipe.attention === value.attention)?.[0] ?? 'tutorial'
  const choose = (key: StyleKey): void => {
    const recipe = RECORDING_MOVIE_RECIPES[key]
    onChange({ ...value, trimPauses: recipe.trimPauses, trimFillers: recipe.trimFillers, waitSpeed: recipe.waitSpeed, attention: recipe.attention })
  }
  return <>
    <div className="flex flex-col gap-1">
      <h3 className="text-sm font-medium text-text1">{t('recording.movieTitle')}</h3>
      <p className="text-xs text-text2">{t('recording.movieIntro')}</p>
    </div>
    <UiGroup titleTone="compact" labelWidth={72}>
      <UiFormRow label={t('recording.movieStyle')} density="compact"><UiSegmented ariaLabel={t('recording.movieStyle')} size="sm" disabled={disabled} value={style} onChange={choose}
        options={(Object.keys(RECORDING_MOVIE_RECIPES) as StyleKey[]).map(key => ({ value: key, label: t(`recording.movieStyle_${key}`) }))} /></UiFormRow>
      <p className="text-xs text-text2">{t(`recording.movieStyleHint_${style}`)}{speedups > 0 && style !== 'original' ? ` ${t('recording.speedupSummary', { count: speedups })}` : ''}</p>
    </UiGroup>
    <div className="flex flex-col gap-2">
      <div><UiButton size="sm" aria-expanded={more} onClick={() => setMore(open => !open)}>{more ? <ChevronDown /> : <ChevronRight />}{t('recording.movieMore')}</UiButton></div>
      <UiDisclosurePanel open={more}>
        <UiGroup titleTone="compact" labelWidth={72}>
          <UiFormRow label={t('recording.formatsShort')} density="compact"><Dropdown size="sm" disabled={disabled} value={value.formats.join(',')} options={['landscape', 'landscape,portrait', 'landscape,square', 'landscape,portrait,square'].map(formats => ({ value: formats, label: t(`recording.formats_${formats.replaceAll(',', '_')}`) }))} onSelect={formats => onChange({ ...value, formats: formats.split(',') as RecordingMovieRecipe['formats'] })} /></UiFormRow>
          <UiFormRow label={t('recording.movieCameraShort')} density="compact"><UiSegmented ariaLabel={t('recording.movieCamera')} size="sm" disabled={disabled} value={value.camera} onChange={camera => onChange({ ...value, camera })} options={(['off', 'circle', 'person'] as const).map(camera => ({ value: camera, label: t(`recording.movieCameraShort_${camera}`) }))} /></UiFormRow>
          <UiFormRow label={t('recording.movieFrameShort')} density="compact"><UiSwitch disabled={disabled} checked={value.frame} onCheckedChange={frame => onChange({ ...value, frame })} /></UiFormRow>
          <UiFormRow label={t('recording.movieAudioShort')} density="compact"><UiSwitch disabled={disabled} checked={value.normalizeAudio} onCheckedChange={normalizeAudio => onChange({ ...value, normalizeAudio })} /></UiFormRow>
        </UiGroup>
      </UiDisclosurePanel>
    </div>
  </>
}

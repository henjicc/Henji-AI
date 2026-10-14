import { useTranslation } from 'react-i18next'
import { Dropdown, UiFormRow, UiGroup, UiOptionButton, UiSegmented, UiSwitch } from '@/components/ui'
import { RECORDING_MOVIE_RECIPES, type RecordingMovieRecipe } from '@/core/screenRecording/movie'

type RecipeKey = keyof typeof RECORDING_MOVIE_RECIPES

/** Inspector page for the one-click movie: pick a style, then adjust only what differs from it. */
export function RecordingMovieOptions({ value, onChange, disabled, speedups }: { value: RecordingMovieRecipe; onChange: (recipe: RecordingMovieRecipe) => void; disabled: boolean; speedups: number }): React.ReactElement {
  const { t } = useTranslation('ui')
  const preset = (Object.entries(RECORDING_MOVIE_RECIPES) as Array<[RecipeKey, RecordingMovieRecipe]>).find(([, recipe]) => JSON.stringify({ ...value, formats: recipe.formats }) === JSON.stringify(recipe))?.[0]
  return <>
    <UiGroup title={t('recording.recipe')} titleTone="compact" labelWidth={72}>
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('recording.recipe')}>
        {(Object.keys(RECORDING_MOVIE_RECIPES) as RecipeKey[]).map(key => <UiOptionButton key={key} variant="grid" size="md" role="radio" aria-checked={preset === key} active={preset === key} disabled={disabled}
          onClick={() => onChange({ ...RECORDING_MOVIE_RECIPES[key], formats: value.formats })}>{t(`recording.recipe_${key}`)}</UiOptionButton>)}
      </div>
      {!preset && <p className="text-xs text-text3">{t('recording.recipeCustomized')}</p>}
      <UiFormRow label={t('recording.formatsShort')} density="compact"><Dropdown size="sm" disabled={disabled} value={value.formats.join(',')} options={['landscape', 'landscape,portrait', 'landscape,square', 'landscape,portrait,square'].map(formats => ({ value: formats, label: t(`recording.formats_${formats.replaceAll(',', '_')}`) }))} onSelect={formats => onChange({ ...value, formats: formats.split(',') as RecordingMovieRecipe['formats'] })} /></UiFormRow>
      <UiFormRow label={t('recording.movieCameraShort')} density="compact"><UiSegmented ariaLabel={t('recording.movieCamera')} size="sm" disabled={disabled} value={value.camera} onChange={camera => onChange({ ...value, camera })} options={(['off', 'circle', 'person'] as const).map(camera => ({ value: camera, label: t(`recording.movieCameraShort_${camera}`) }))} /></UiFormRow>
      <UiFormRow label={t('recording.movieFrameShort')} density="compact"><UiSwitch disabled={disabled} checked={value.frame} onCheckedChange={frame => onChange({ ...value, frame })} /></UiFormRow>
      <UiFormRow label={t('recording.movieAudioShort')} density="compact"><UiSwitch disabled={disabled} checked={value.normalizeAudio} onCheckedChange={normalizeAudio => onChange({ ...value, normalizeAudio })} /></UiFormRow>
    </UiGroup>
    {speedups > 0 && <p className="text-xs text-text2">{t('recording.speedupSummary', { count: speedups })}</p>}
  </>
}

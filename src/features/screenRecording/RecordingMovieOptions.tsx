import { useTranslation } from 'react-i18next'
import { Dropdown, UiFormRow, UiGroup, UiSwitch } from '@/components/ui'
import { RECORDING_MOVIE_RECIPES, type RecordingMovieRecipe } from '@/core/screenRecording/movie'

export function RecordingMovieOptions({ value, onChange, disabled }: { value: RecordingMovieRecipe; onChange: (recipe: RecordingMovieRecipe) => void; disabled: boolean }): React.ReactElement {
  const { t } = useTranslation('ui')
  const preset = Object.entries(RECORDING_MOVIE_RECIPES).find(([, recipe]) => JSON.stringify({ ...value, formats: recipe.formats }) === JSON.stringify(recipe))?.[0] ?? 'custom'
  return <UiGroup title={t('recording.movieOptions')} labelWidth={120}>
    <UiFormRow label={t('recording.recipe')}><Dropdown size="sm" disabled={disabled} value={preset} options={[...Object.keys(RECORDING_MOVIE_RECIPES).map(value => ({ value, label: t(`recording.recipe_${value}`) })), { value: 'custom', label: t('recording.recipe_custom') }]} onSelect={key => { if (key in RECORDING_MOVIE_RECIPES) onChange({ ...RECORDING_MOVIE_RECIPES[key as keyof typeof RECORDING_MOVIE_RECIPES], formats: value.formats }) }} /></UiFormRow>
    <UiFormRow label={t('recording.extraFormats')}><Dropdown size="sm" disabled={disabled} value={value.formats.join(',')} options={['landscape', 'landscape,portrait', 'landscape,square', 'landscape,portrait,square'].map(formats => ({ value: formats, label: t(`recording.formats_${formats.replaceAll(',', '_')}`) }))} onSelect={formats => onChange({ ...value, formats: formats.split(',') as RecordingMovieRecipe['formats'] })} /></UiFormRow>
    <UiFormRow label={t('recording.movieCamera')}><Dropdown size="sm" disabled={disabled} value={value.camera} options={(['off', 'circle', 'person'] as const).map(value => ({ value, label: t(`recording.movieCamera_${value}`) }))} onSelect={camera => onChange({ ...value, camera })} /></UiFormRow>
    <UiFormRow label={t('recording.movieFrame')}><UiSwitch disabled={disabled} checked={value.frame} onCheckedChange={frame => onChange({ ...value, frame })} /></UiFormRow>
    <UiFormRow label={t('recording.movieAudio')}><UiSwitch disabled={disabled} checked={value.normalizeAudio} onCheckedChange={normalizeAudio => onChange({ ...value, normalizeAudio })} /></UiFormRow>
  </UiGroup>
}

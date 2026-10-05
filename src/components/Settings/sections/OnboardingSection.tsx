import { UiButton, UiFormRow } from '@/components/ui'
import { onboardingManager } from '@/features/onboarding/application/onboardingManager'
import { useI18n } from '@/hooks/useI18n'

/**
 * 重新运行首次设置引导。
 *
 * 只留这一个动作：原来的「首次设置状态：已跳过」看了也做不了什么，
 * 「打开平台密钥」只是从设置跳到设置里的另一处。默认模型移到了「工作区 › 生成」。
 */
export default function OnboardingSection(): JSX.Element {
  const { t } = useI18n('onboarding')
  return (
    <UiFormRow label={t('settings.onboardingTitle')} info={t('settings.description')} inline>
      <UiButton variant="secondary" onClick={() => onboardingManager.restart()}>
        {t('actions.rerun')}
      </UiButton>
    </UiFormRow>
  )
}

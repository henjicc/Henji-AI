import i18n from './config'
import type { PaidApprovalDisplay } from '../core/application-control/paidApproval'

export function formatPaidApprovalMessage(value: PaidApprovalDisplay): string {
  const category = i18n.t(`paidApproval.categories.${value.category}`, { ns: 'common' })
  return [
    i18n.t(value.modelName ? 'paidApproval.operationWithModel' : 'paidApproval.operation', { ns: 'common', category, modelName: value.modelName }),
    value.estimatedCny === null ? i18n.t('paidApproval.unknownCost', { ns: 'common' })
      : i18n.t('paidApproval.estimatedCost', { ns: 'common', amount: value.estimatedCny.toFixed(2) }),
    i18n.t('paidApproval.dailySpent', { ns: 'common', amount: value.dailySpentCny.toFixed(2) }),
  ].join('\n')
}

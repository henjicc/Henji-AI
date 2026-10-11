import { AiRuntimeError } from '../runtime/AiRuntimeError'
import type { JsonValue } from '../types/runtime'

const object = (value: JsonValue | undefined): Record<string, JsonValue> => value && typeof value === 'object' && !Array.isArray(value) ? value : {}

/** 仅按供应商官方错误契约识别；未知 403/500 保留原分类，禁止猜测余额或模型开通状态。 */
export function assertProviderAccess(provider: string, payload: JsonValue, status: number): void {
  const body = object(payload); const error = object(body.error)
  const code = String(error.code ?? body.code ?? '')
  let kind: 'product_not_activated' | 'model_access_denied' | 'insufficient_balance' | undefined
  if (provider === 'Bailian') {
    if (code === 'Arrearage') kind = 'insufficient_balance'
    else if (code === 'AccessDenied.Unpurchased') kind = 'product_not_activated'
    else if (code === 'Model.AccessDenied') kind = 'model_access_denied'
  } else if (provider === 'KIE' && (code === '402' || status === 402)) kind = 'insufficient_balance'
  else if (provider === 'PPIO') {
    if (['BILLING_BALANCE_NOT_ENOUGH', 'NOT_ENOUGH_BALANCE'].includes(code)) kind = 'insufficient_balance'
    else if (['API_NOT_ALLOWED', 'ACCESS_DENY'].includes(code)) kind = 'model_access_denied'
  } else if (provider === 'SiliconFlow') {
    if (status === 402) kind = 'insufficient_balance'
    else if (status === 403) kind = 'model_access_denied'
  } else if (provider === 'APIMart') {
    if (code === '402' || status === 402) kind = 'insufficient_balance'
    else if (code === '403' || status === 403) kind = 'model_access_denied'
  } else if (provider === 'Volcengine Ark') {
    if (code === 'AccountOverdueError') kind = 'insufficient_balance'
    else if (['ModelNotOpen', 'OperationDenied.ServiceNotOpen'].includes(code)) kind = 'product_not_activated'
    else if (['AccessDenied', 'OperationDenied.PermissionDenied'].includes(code)) kind = 'model_access_denied'
  }
  if (!kind) return
  const name = provider === 'Bailian' ? '百炼' : provider === 'SiliconFlow' ? '硅基流动' : provider === 'Volcengine Ark' ? '火山方舟' : provider
  const destination: Record<string, string> = { Bailian: 'https://bailian.console.aliyun.com/', KIE: 'https://kie.ai/', PPIO: 'https://ppio.com/console', SiliconFlow: 'https://cloud.siliconflow.cn/', APIMart: 'https://apimart.ai/', 'Volcengine Ark': 'https://console.volcengine.com/ark/' }
  const action = kind === 'insufficient_balance' ? '账户余额不足或已欠费，请充值后重试'
    : kind === 'product_not_activated' ? '账号未开通该模型，请先开通模型服务'
      : '账号没有该模型的调用权限，请检查模型授权和实名认证'
  throw new AiRuntimeError(`provider_${kind}`, `${name}${action}。控制台：${destination[provider]}`, {
    retryable: false, category: 'authentication', providerCode: code, status,
    providerMessage: String(error.message ?? body.message ?? body.msg ?? ''),
    scope: kind === 'insufficient_balance' ? 'account' : 'model',
  })
}

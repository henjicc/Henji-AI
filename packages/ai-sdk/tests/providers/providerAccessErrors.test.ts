import { describe, expect, it } from 'vitest'
import { readJsonResponse } from '../../src/providers/helpers'
import { shouldRetry } from '../../src/runtime/retry'

describe('官方账户与模型准入错误', () => {
  it.each([
    ['Bailian', 400, { code: 'Arrearage', message: 'Access denied, please make sure your account is in good standing.' }, 'provider_insufficient_balance'],
    ['Bailian', 403, { code: 'AccessDenied.Unpurchased', message: 'Access denied' }, 'provider_product_not_activated'],
    ['Bailian', 403, { code: 'Model.AccessDenied', message: 'Access denied' }, 'provider_model_access_denied'],
    ['KIE', 200, { code: 402, msg: 'Insufficient Credits' }, 'provider_insufficient_balance'],
    ['PPIO', 400, { error: { code: 'BILLING_BALANCE_NOT_ENOUGH', message: '余额不足' } }, 'provider_insufficient_balance'],
    ['PPIO', 403, { error: { code: 'API_NOT_ALLOWED', message: '无权限使用该 API' } }, 'provider_model_access_denied'],
    ['SiliconFlow', 402, { code: 20001, message: 'balance' }, 'provider_insufficient_balance'],
    ['SiliconFlow', 403, { message: '实名认证' }, 'provider_model_access_denied'],
    ['APIMart', 402, { error: { code: 402, message: '账户余额不足，请充值后再试', type: 'payment_required' } }, 'provider_insufficient_balance'],
    ['APIMart', 403, { error: { code: 403, message: '访问被禁止，您没有权限访问此资源', type: 'permission_error' } }, 'provider_model_access_denied'],
    ['Volcengine Ark', 404, { error: { code: 'ModelNotOpen' } }, 'provider_product_not_activated'],
    ['Volcengine Ark', 403, { error: { code: 'OperationDenied.ServiceNotOpen' } }, 'provider_product_not_activated'],
    ['Volcengine Ark', 403, { error: { code: 'AccountOverdueError' } }, 'provider_insufficient_balance'],
    ['Volcengine Ark', 403, { error: { code: 'AccessDenied' } }, 'provider_model_access_denied'],
  ])('%s 以正式错误码区分账户余额与模型权限', async (provider, status, body, code) => {
    const error = await readJsonResponse(new Response(JSON.stringify(body), { status: Number(status) }), String(provider)).catch((error: unknown) => error)
    expect(error).toMatchObject({ code, details: { retryable: false } })
    expect(shouldRetry(error)).toBe(false)
  })
  it('不把泛化的 403 或服务器故障猜成余额或模型未开通', async () => {
    for (const body of [{ message: 'Forbidden' }, { code: 'BILLING_FAILED', message: 'billing service unavailable' }]) {
      await expect(readJsonResponse(new Response(JSON.stringify(body), { status: 403 }), 'PPIO')).rejects.toMatchObject({ code: 'provider_http_error' })
    }
  })
})

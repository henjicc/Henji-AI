import { useEffect, useState } from 'react'
import { UiError, UiFormRow, UiSwitch } from '@/components/ui'
import { executeContentTrust, externalContentCodeAllowed, subscribeContentTrust } from '@/services/contentTrust'

export default function ContentTrustSection(): JSX.Element {
  const [allowed, setAllowed] = useState(externalContentCodeAllowed)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void executeContentTrust({ action: 'policy' }).then(value => { if (active) setAllowed(value.allowExternalContentCode) }, cause => { if (active) setError(String(cause)) })
    const unsubscribe = subscribeContentTrust(() => { if (active) setAllowed(externalContentCodeAllowed()) })
    return () => { active = false; unsubscribe() }
  }, [])
  return <>
    <UiFormRow label="允许运行外来内容里的代码" inline>
      <UiSwitch checked={allowed} onCheckedChange={value => { setError(''); void executeContentTrust({ action: 'set-policy', allow: value }).then(result => setAllowed(result.allowExternalContentCode), cause => setError(cause instanceof Error ? cause.message : String(cause))) }} aria-label="允许运行外来内容里的代码" />
    </UiFormRow>
    {error && <UiError message={error} />}
  </>
}

import { createCountedSqlite } from '../documents/sqlite.test-support'
import { ContentTrustSession, installContentTrustSession } from './runtime'

export function createContentTrustTestSession() {
  const database = createCountedSqlite()
  let allowed = false
  const make = () => new ContentTrustSession(() => allowed, value => { allowed = value })
  let session = make()
  const restore = installContentTrustSession(session)
  return { ...database, get session() { return session }, restart() { session = make(); installContentTrustSession(session) }, dispose() { restore(); database.native.close() } }
}

import { cookies } from 'next/headers';
import { getSessionContext, type SessionContext } from './service';
import { SESSION_COOKIE } from './cookies';

/** Read the current session inside a Server Component / Server Action. */
export async function currentSession(): Promise<SessionContext | null> {
  const store = await cookies();
  return getSessionContext(store.get(SESSION_COOKIE)?.value);
}

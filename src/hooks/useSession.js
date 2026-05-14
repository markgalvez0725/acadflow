import { useAuth } from '@/context/AuthContext'

/**
 * Consumer hook for AuthContext session state.
 * All session logic lives in AuthContext — this is a thin convenience wrapper.
 */
export function useSession() {
  return useAuth()
}

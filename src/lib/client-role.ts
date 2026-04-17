import { isTauri } from './tauri'

export type ClientRole = 'local' | 'remote'

export function getClientRole(): ClientRole {
  if (isTauri()) return 'local'
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
    return 'local'
  }
  return 'remote'
}

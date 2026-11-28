import { channelStateKey, channelStatePrefix } from './channelState.ts'

const IPV4_PRIVATE_10 = /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const IPV4_PRIVATE_192 = /^192\.168\.\d{1,3}\.\d{1,3}$/
const IPV4_CGNAT_100 = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/

export function isDevEnvironment(): boolean {
  if (import.meta.env.VITE_CHANNEL === 'dev' || import.meta.env.DEV) return true
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    const path = window.location.pathname
    if (
      host === '127.0.0.1' ||
      host === 'localhost' ||
      IPV4_PRIVATE_10.test(host) ||
      IPV4_PRIVATE_192.test(host) ||
      IPV4_CGNAT_100.test(host) ||
      path === '/dev' ||
      path.startsWith('/dev/') ||
      path.endsWith('/dev') ||
      path.includes('/dev/') ||
      path === '/syntax-dev' ||
      path.startsWith('/syntax-dev/')
    ) {
      return true
    }
  }
  return false
}

export const canResetDevState = Boolean(channelStatePrefix || import.meta.env?.DEV)

function removeDevStorage(storage: Storage) {
  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index)
    if (!key) continue
    const owned = channelStatePrefix
      ? key.startsWith(channelStatePrefix)
      : key.startsWith('syntax.') || key === 'mpm2d-brilliant-theme-v1' || key === 'mpm2d-brilliant-sound-v1'
    if (owned) storage.removeItem(key)
  }
}

export async function resetDevState() {
  if (!canResetDevState || typeof window === 'undefined') return

  try {
    removeDevStorage(window.localStorage)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  try {
    removeDevStorage(window.sessionStorage)
  } catch {
    // Storage can be unavailable in restricted browser contexts.
  }
  for (const name of ['syntax_prefs', 'syntax_mpm2d_prefs']) {
    document.cookie = `${channelStateKey(name)}=; Max-Age=0; Path=/; SameSite=Lax`
  }
  if (typeof indexedDB !== 'undefined') {
    try {
      const databases = await indexedDB.databases()
      const ownedNames = databases.map(({ name }) => name).filter((name): name is string =>
        Boolean(name && (channelStatePrefix ? name.startsWith(channelStatePrefix) : name === 'syntax-extensions-v1')),
      )
      await Promise.all(ownedNames.map(name => new Promise<void>(resolve => {
        const request = indexedDB.deleteDatabase(name)
        request.onsuccess = request.onerror = request.onblocked = () => resolve()
      })))
    } catch {
      // A browser can deny access to IndexedDB.
    }
  }

  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  window.location.reload()
}

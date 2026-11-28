const channel = import.meta.env?.VITE_CHANNEL
const hostedDev = typeof window !== 'undefined' &&
  /^\/syntax-dev(?:\/|$)/.test(window.location.pathname)

const isolatedChannel = channel === 'beta' || channel === 'preview'
  ? channel
  : channel === 'dev' || (channel !== 'stable' && hostedDev) ? 'dev' : null

export const channelStatePrefix = isolatedChannel ? `syntax-${isolatedChannel}-` : ''

export function channelStateKey(key: string): string {
  return channelStatePrefix + key
}

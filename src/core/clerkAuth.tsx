import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { ClerkProvider, useAuth, useClerk, useSessionList, useUser } from '@clerk/react'
import { dark } from '@clerk/themes'
import { isClerkConfigured, sanitizeHandle, useAccountStore } from './account'
import { channelStatePrefix } from './channelState'
import {
  CLOUD_SYNC_DIRTY_EVENT,
  collectLocalCloudSnapshot,
  extractRemoteCloudPayload,
  fingerprintCloudPayload,
  mergeCloudIntoLocal,
  pushCloudSnapshotToClerk,
  useCloudSyncStore,
} from './clerkSync'
import { syntaxLog } from './logger'

export interface SwitchableSession {
  id: string
  isCurrent: boolean
  displayName: string
  handle: string
  email?: string
  avatarUrl?: string
}

export interface ClerkSecuritySnapshot {
  passkeyCount: number
  twoFactorEnabled: boolean
  connectedProviders: string[]
}

export interface AuthActions {
  isClerkActive: boolean
  isLoaded: boolean
  isSignedIn: boolean
  openSignIn: () => void
  addAccount: () => void
  openAccount: () => void
  openSecurity: () => void
  signOut: () => Promise<void>
  sessions: SwitchableSession[]
  switchSession: (sessionId: string) => Promise<void>
  security: ClerkSecuritySnapshot
  syncNow: () => Promise<void>
}

const EMPTY_SECURITY: ClerkSecuritySnapshot = {
  passkeyCount: 0,
  twoFactorEnabled: false,
  connectedProviders: [],
}

const AuthActionsContext = createContext<AuthActions>({
  isClerkActive: false,
  isLoaded: true,
  isSignedIn: false,
  openSignIn: () => {},
  addAccount: () => {},
  openAccount: () => {},
  openSecurity: () => {},
  signOut: async () => {},
  sessions: [],
  switchSession: async () => {},
  security: EMPTY_SECURITY,
  syncNow: async () => {},
})

const BASE_ALLOWED_REDIRECT_ORIGINS = [
  'https://syntax-platform.github.io',
  'https://i-am-drunk.github.io',
  'http://localhost:5189',
  'http://127.0.0.1:5189',
  'http://localhost:5179',
  'http://127.0.0.1:5179',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

function resolveAllowedRedirectOrigins(): string[] {
  const origins = new Set(BASE_ALLOWED_REDIRECT_ORIGINS)
  if (typeof window !== 'undefined' && window.location.origin && window.location.origin !== 'null') {
    origins.add(window.location.origin)
  }
  return [...origins]
}

export function useAuthActions(): AuthActions {
  return useContext(AuthActionsContext)
}

function useDocumentDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark',
  )
  useEffect(() => {
    const read = () => setIsDark(document.documentElement.dataset.theme === 'dark')
    const obs = new MutationObserver(read)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return isDark
}

function hasPendingClerkHandshake(): boolean {
  if (typeof window === 'undefined') return false
  const q = window.location.search
  return q.includes('__clerk_') || window.location.hash.includes('__clerk_')
}

function resolveBaseRedirectUrl(): string {
  const basePath = import.meta.env.BASE_URL || '/'
  if (typeof window === 'undefined') return basePath
  try {
    return new URL(basePath, window.location.origin).toString()
  } catch {
    return basePath
  }
}

function formatProviderName(raw: string): string {
  const clean = raw.replace(/^oauth_/i, '').toLowerCase()
  if (clean === 'github') return 'GitHub'
  if (clean === 'google') return 'Google'
  if (clean === 'apple') return 'Apple'
  return clean.charAt(0).toUpperCase() + clean.slice(1)
}

function ClerkAccountBridge({ children }: { children: ReactNode }) {
  const { user, isLoaded: userLoaded } = useUser()
  const { isLoaded: authLoaded, isSignedIn, sessionId: activeSessionId } = useAuth()
  const { sessions: clerkSessions, setActive } = useSessionList()
  const clerk = useClerk()
  const syncClerkUser = useAccountStore(s => s.syncClerkUser)
  const setSessionStatus = useAccountStore(s => s.setSessionStatus)
  const setSyncState = useCloudSyncStore(s => s.setSyncState)

  const signOutTimerRef = useRef<number>(0)
  const syncTimerRef = useRef<number>(0)
  const explicitSignOutRef = useRef(false)
  const hydratedUserIdRef = useRef<string | null>(null)
  const lastPushedFingerprintRef = useRef<string>('')
  const isLoaded = Boolean(userLoaded && authLoaded)

  // 1. Sync Clerk identity into Syntax account store
  useEffect(() => {
    window.clearTimeout(signOutTimerRef.current)

    if (!isLoaded) {
      setSessionStatus('hydrating')
      return
    }

    if (user) {
      explicitSignOutRef.current = false
      const email = user.primaryEmailAddress?.emailAddress
      const rawHandle =
        user.username ||
        (email ? email.split('@')[0] : '') ||
        user.firstName ||
        'learner'
      const handle = sanitizeHandle(rawHandle) || 'learner'
      const displayName = user.fullName || user.firstName || user.username || handle
      syncClerkUser({
        uid: user.id,
        handle,
        displayName,
        email,
        avatarUrl: user.imageUrl || undefined,
        provider: 'clerk',
        createdAt: user.createdAt ? user.createdAt.toISOString() : new Date().toISOString(),
      })
      return
    }

    hydratedUserIdRef.current = null
    lastPushedFingerprintRef.current = ''
    setSyncState({ status: 'local-only', lastSyncedAt: null, lastError: null })

    if (explicitSignOutRef.current) {
      syncClerkUser(null)
      return
    }

    const cachedAccount = useAccountStore.getState().account
    if (cachedAccount?.provider === 'clerk') {
      const waitMs = hasPendingClerkHandshake() ? 1800 : 500
      signOutTimerRef.current = window.setTimeout(() => {
        if (!clerk.user) {
          syntaxLog.info('account', 'Clerk session confirmed signed out')
          syncClerkUser(null)
        }
      }, waitMs)
      return () => window.clearTimeout(signOutTimerRef.current)
    }

    syncClerkUser(null)
    return () => window.clearTimeout(signOutTimerRef.current)
  }, [user, isLoaded, isSignedIn, clerk, syncClerkUser, setSessionStatus, setSyncState])

  // 2. Push helper (deduplicated via content fingerprint)
  const runCloudPush = useCallback(
    async (force = false) => {
      if (!user || channelStatePrefix) return
      const snapshot = collectLocalCloudSnapshot()
      const fp = fingerprintCloudPayload(snapshot)
      if (!force && fp === lastPushedFingerprintRef.current) return

      setSyncState({ status: 'syncing', lastError: null })
      try {
        await pushCloudSnapshotToClerk(user, snapshot)
        lastPushedFingerprintRef.current = fp
        setSyncState({
          status: 'synced',
          lastSyncedAt: snapshot.updatedAt,
          lastError: null,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        syntaxLog.warn('clerk-sync', 'Cloud sync push failed', { error: msg })
        setSyncState({ status: 'error', lastError: msg })
      }
    },
    [user, setSyncState],
  )

  // 3. Initial hydration & merge when Clerk user signs in
  useEffect(() => {
    if (!isLoaded || !user) return
    if (channelStatePrefix) {
      setSyncState({ status: 'local-only', lastSyncedAt: null, lastError: null })
      return
    }
    if (hydratedUserIdRef.current === user.id) return
    hydratedUserIdRef.current = user.id

    const remote = extractRemoteCloudPayload(user.unsafeMetadata)
    if (remote) {
      const merged = mergeCloudIntoLocal(remote)
      const remoteFp = fingerprintCloudPayload(remote)
      const mergedFp = fingerprintCloudPayload(merged)
      setSyncState({
        status: 'synced',
        lastSyncedAt: remote.updatedAt,
        lastError: null,
      })
      if (mergedFp !== remoteFp) {
        void runCloudPush(true)
      } else {
        lastPushedFingerprintRef.current = remoteFp
      }
    } else {
      void runCloudPush(true)
    }
  }, [isLoaded, user, runCloudPush, setSyncState])

  // 4. Debounced live auto-sync whenever preferences or theme change
  useEffect(() => {
    if (!user || channelStatePrefix) return
    const scheduleSync = () => {
      window.clearTimeout(syncTimerRef.current)
      syncTimerRef.current = window.setTimeout(() => {
        void runCloudPush(false)
      }, 2200)
    }

    const events = ['syntax:prefs-changed', CLOUD_SYNC_DIRTY_EVENT]
    for (const ev of events) window.addEventListener(ev, scheduleSync)

    return () => {
      window.clearTimeout(syncTimerRef.current)
      for (const ev of events) window.removeEventListener(ev, scheduleSync)
    }
  }, [user, runCloudPush])

  const sessions = useMemo<SwitchableSession[]>(() => {
    if (!clerkSessions || clerkSessions.length === 0) return []
    return clerkSessions
      .filter(s => s.status === 'active' && s.user)
      .map(s => {
        const u = s.user!
        const email = u.primaryEmailAddress?.emailAddress
        const handle = sanitizeHandle(
          u.username || (email ? email.split('@')[0] : '') || u.firstName || 'learner',
        )
        return {
          id: s.id,
          isCurrent: s.id === activeSessionId,
          displayName: u.fullName || u.firstName || u.username || handle || 'Learner',
          handle: handle || 'learner',
          email,
          avatarUrl: u.imageUrl || undefined,
        }
      })
  }, [clerkSessions, activeSessionId])

  const security = useMemo<ClerkSecuritySnapshot>(() => {
    if (!user) return EMPTY_SECURITY
    const providers = (user.externalAccounts ?? [])
      .filter(acc => acc.verification?.status === 'verified' || Boolean(acc.provider))
      .map(acc => formatProviderName(String(acc.provider)))
    return {
      passkeyCount: user.passkeys?.length ?? 0,
      twoFactorEnabled: Boolean(user.twoFactorEnabled),
      connectedProviders: [...new Set(providers)],
    }
  }, [user])

  const actions = useMemo<AuthActions>(
    () => ({
      isClerkActive: true,
      isLoaded,
      isSignedIn: Boolean(isSignedIn || user),
      openSignIn: () => {
        if (!clerk.loaded) return
        const redirectUrl = resolveBaseRedirectUrl()
        clerk.openSignIn({
          fallbackRedirectUrl: redirectUrl,
          signUpFallbackRedirectUrl: redirectUrl,
        })
      },
      addAccount: () => {
        if (!clerk.loaded) return
        const redirectUrl = resolveBaseRedirectUrl()
        clerk.openSignIn({
          fallbackRedirectUrl: redirectUrl,
          signUpFallbackRedirectUrl: redirectUrl,
        })
      },
      openAccount: () => {
        if (!clerk.loaded) return
        if (user || clerk.user) {
          clerk.openUserProfile()
        } else {
          const redirectUrl = resolveBaseRedirectUrl()
          clerk.openSignIn({
            fallbackRedirectUrl: redirectUrl,
            signUpFallbackRedirectUrl: redirectUrl,
          })
        }
      },
      openSecurity: () => {
        if (!clerk.loaded) return
        if (user || clerk.user) {
          clerk.openUserProfile()
        } else {
          const redirectUrl = resolveBaseRedirectUrl()
          clerk.openSignIn({
            fallbackRedirectUrl: redirectUrl,
            signUpFallbackRedirectUrl: redirectUrl,
          })
        }
      },
      signOut: async () => {
        explicitSignOutRef.current = true
        window.clearTimeout(signOutTimerRef.current)
        window.clearTimeout(syncTimerRef.current)
        syncClerkUser(null)
        try {
          if (clerk.loaded) {
            await clerk.signOut({ redirectUrl: resolveBaseRedirectUrl() })
          }
        } catch (err) {
          syntaxLog.warn('account', 'Clerk signOut completed with warning', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
      sessions,
      switchSession: async (sessionId: string) => {
        if (!setActive || !sessionId || sessionId === activeSessionId) return
        try {
          hydratedUserIdRef.current = null
          lastPushedFingerprintRef.current = ''
          await setActive({ session: sessionId })
        } catch (err) {
          syntaxLog.warn('account', 'Failed to switch Clerk session', {
            error: err instanceof Error ? err.message : String(err),
          })
        }
      },
      security,
      syncNow: async () => {
        await runCloudPush(true)
      },
    }),
    [
      clerk,
      isLoaded,
      isSignedIn,
      user,
      syncClerkUser,
      sessions,
      setActive,
      activeSessionId,
      security,
      runCloudPush,
    ],
  )

  return <AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>
}

export function SyntaxAuthProvider({
  children,
  onOpenLocalSignIn,
}: {
  children: ReactNode
  onOpenLocalSignIn: () => void
}) {
  const isDark = useDocumentDarkMode()
  const publishableKey = (import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? '').trim()
  const clerkEnabled = isClerkConfigured()
  const signOutLocal = useAccountStore(s => s.signOutLocal)
  const localAccount = useAccountStore(s => s.account)
  const redirectUrl = useMemo(() => resolveBaseRedirectUrl(), [])
  const allowedRedirectOrigins = useMemo(() => resolveAllowedRedirectOrigins(), [])

  const localActions = useMemo<AuthActions>(
    () => ({
      isClerkActive: false,
      isLoaded: true,
      isSignedIn: Boolean(localAccount),
      openSignIn: onOpenLocalSignIn,
      addAccount: onOpenLocalSignIn,
      openAccount: onOpenLocalSignIn,
      openSecurity: onOpenLocalSignIn,
      signOut: async () => {
        signOutLocal()
      },
      sessions: [],
      switchSession: async () => {},
      security: EMPTY_SECURITY,
      syncNow: async () => {},
    }),
    [localAccount, onOpenLocalSignIn, signOutLocal],
  )

  const clerkAppearance = useMemo(
    () => ({
      theme: isDark ? dark : undefined,
      variables: {
        colorPrimary: '#456dff',
        colorPrimaryForeground: '#ffffff',
        colorBackground: isDark ? '#181818' : '#ffffff',
        colorInput: isDark ? '#222222' : '#f7f7f7',
        colorForeground: isDark ? '#ffffff' : '#141414',
        colorNeutral: isDark ? '#e5e5e5' : '#141414',
        borderRadius: '12px',
        fontFamily: "'CoFo Brilliant', -apple-system, BlinkMacSystemFont, sans-serif",
      },
      elements: {
        modalBackdrop: {
          backgroundColor: 'rgba(0, 0, 0, 0.56)',
          backdropFilter: 'blur(8px)',
        },
        cardBox: {
          boxShadow: isDark
            ? '0 24px 64px rgba(0, 0, 0, 0.72)'
            : '0 20px 54px rgba(0, 0, 0, 0.16)',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.12)' : '1px solid rgba(0, 0, 0, 0.1)',
          borderRadius: '20px',
        },
        formButtonPrimary: {
          backgroundColor: '#456dff',
          color: '#ffffff',
          borderRadius: '11px',
          fontWeight: 700,
          boxShadow: '0 3px 0 #2e50d4',
        },
        socialButtonsBlockButton: {
          borderRadius: '11px',
          border: isDark ? '1px solid rgba(255, 255, 255, 0.14)' : '1px solid rgba(0, 0, 0, 0.12)',
        },
        footer: {
          background: isDark ? '#151515' : '#fafafa',
        },
        footerActionLink: {
          color: isDark ? '#7491ff' : '#456dff',
        },
        badge: {
          borderRadius: '999px',
        },
      },
    }),
    [isDark],
  )

  if (!clerkEnabled) {
    return (
      <AuthActionsContext.Provider value={localActions}>
        {children}
      </AuthActionsContext.Provider>
    )
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInFallbackRedirectUrl={redirectUrl}
      signUpFallbackRedirectUrl={redirectUrl}
      afterSignOutUrl={redirectUrl}
      allowedRedirectOrigins={allowedRedirectOrigins}
      appearance={clerkAppearance}
    >
      <ClerkAccountBridge>{children}</ClerkAccountBridge>
    </ClerkProvider>
  )
}

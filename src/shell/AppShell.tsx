import { channelStateKey } from '../core/channelState.ts'
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { Route, Router, Switch, useLocation } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import { Toaster } from 'sonner'
import { recordActivity } from '../core/activity'
import {
  CLOUD_SYNC_APPLIED_EVENT,
  CLOUD_SYNC_DIRTY_EVENT,
  type SyntaxCloudPayload,
} from '../core/clerkSync'
import { isDevEnvironment } from '../core/devEnv'
import { SyntaxErrorBoundary } from '../core/ErrorBoundary'
import { loadPrefs, savePrefs, type SyntaxPrefs } from '../core/prefs'
import { ExtensionPage } from '../extensions/ExtensionPage.tsx'
import { extensionManager } from '../extensions/manager.ts'
import { isSafeMode, useExtensionStore } from '../extensions/store.ts'
import { playUiSound, type UiSound } from '../services/uiSounds'
import { HomePage } from '../ui/HomePage'
import { LibraryPage } from '../ui/LibraryPage'
import { AppHeader, type ActiveNavRoute } from './AppHeader'

const SettingsPage = lazy(() =>
  import('../ui/SettingsPage').then(m => ({ default: m.SettingsPage })),
)
const ExtensionsPage = lazy(() =>
  import('../ui/ExtensionsPage').then(m => ({ default: m.ExtensionsPage })),
)
const CommunityHubPage = lazy(() =>
  import('../ui/CommunityHubPage').then(m => ({ default: m.CommunityHubPage })),
)
const ProfilePage = lazy(() =>
  import('../ui/ProfilePage').then(m => ({ default: m.ProfilePage })),
)
const CommandPalette = lazy(() =>
  import('../ui/CommandPalette').then(m => ({ default: m.CommandPalette })),
)
const OnboardingModal = lazy(() =>
  import('../ui/OnboardingModal').then(m => ({ default: m.OnboardingModal })),
)
const DevToolsSuite = lazy(() =>
  import('../core/devTools').then(m => ({ default: m.DevToolsSuite })),
)

const THEME_KEY = channelStateKey('syntax.theme.v1')
const LEGACY_THEME_KEY = channelStateKey('mpm2d-brilliant-theme-v1')
const SOUND_KEY = channelStateKey('syntax.sound.v1')
const LEGACY_SOUND_KEY = channelStateKey('mpm2d-brilliant-sound-v1')

function loadTheme(): 'light' | 'dark' {
  try {
    const saved = localStorage.getItem(THEME_KEY) ?? localStorage.getItem(LEGACY_THEME_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // ignore
  }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function loadSound(): boolean {
  try {
    const saved = localStorage.getItem(SOUND_KEY) ?? localStorage.getItem(LEGACY_SOUND_KEY)
    if (saved === 'false') return false
  } catch {
    // ignore
  }
  return true
}

export interface AppShellProps {
  hideToaster?: boolean
}

function parseRouteInfo(location: string): {
  clean: string
  activeRoute: ActiveNavRoute
} {
  const clean = location.split('?')[0] || '/'
  if (clean === '/settings') return { clean, activeRoute: 'settings' }
  if (clean === '/extensions' || clean === '/plugins') return { clean, activeRoute: 'extensions' }
  if (clean === '/community' || clean.startsWith('/community/')) {
    return { clean, activeRoute: 'community' }
  }
  if (clean.startsWith('/ext/')) return { clean, activeRoute: null }
  if (clean === '/' || clean === '' || clean === '/home') return { clean: '/', activeRoute: 'home' }
  if (clean === '/profile') return { clean, activeRoute: 'profile' }
  return { clean, activeRoute: 'library' }
}

function RouteLoadingFallback({ label }: { label: string }) {
  return (
    <main className="sx-course-loading">
      <div className="sx-course-loading-card">
        <h2>{label}&hellip;</h2>
      </div>
    </main>
  )
}

function LegacyPluginsRedirect({
  onRedirect,
  onOpenCommunityHub,
  onNavigate,
}: {
  onRedirect: () => void
  onOpenCommunityHub: () => void
  onNavigate: (path: string) => void
}) {
  useEffect(() => {
    onRedirect()
  }, [onRedirect])
  return <ExtensionsPage onOpenCommunityHub={onOpenCommunityHub} onNavigate={onNavigate} />
}

function AppShellInner({ hideToaster = false }: AppShellProps) {
  const isDev = isDevEnvironment()
  const [location, setLocation] = useLocation()

  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme)
  const [soundOn, setSoundOn] = useState<boolean>(loadSound)
  const [prefs, setPrefs] = useState<SyntaxPrefs>(loadPrefs)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const themeMountedRef = useRef(false)
  const soundMountedRef = useRef(false)
  const prefsMountedRef = useRef(false)
  const routeInfo = parseRouteInfo(location)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const emitSound = useCallback(
    (cue: UiSound) => {
      if (soundOn) playUiSound(cue)
    },
    [soundOn],
  )

  const patchPrefs = useCallback((patch: Partial<SyntaxPrefs>) => {
    setPrefs(prev => ({ ...prev, ...patch }))
  }, [])

  const navigate = useCallback(
    (path: string) => {
      if (path !== location) {
        setLocation(path)
      }
      window.scrollTo({ top: 0 })
    },
    [location, setLocation],
  )

  useEffect(() => {
    extensionManager.setNavigator(navigate)
    return () => extensionManager.setNavigator(null)
  }, [navigate])

  useEffect(() => {
    recordActivity('visit', 1)
    const safeMode = isSafeMode()
    void extensionManager.boot({ safeMode })
    const cleanLoc = location.split('?')[0] || '/'
    if (safeMode && cleanLoc === '/') {
      setLocation('/extensions', { replace: true })
    }
    // Boot once on mount (StrictMode-safe inside extensionManager.boot)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onCloudApplied = (ev: Event) => {
      setTheme(loadTheme())
      setSoundOn(loadSound())
      setPrefs(loadPrefs())
      useExtensionStore.getState().reloadSettingsFromStorage()
      const remote = (ev as CustomEvent<SyntaxCloudPayload | undefined>).detail
      if (remote?.extensions && remote.extensions.length > 0) {
        void extensionManager.syncFromCloud(remote.extensions)
      }
    }
    window.addEventListener(CLOUD_SYNC_APPLIED_EVENT, onCloudApplied)
    return () => window.removeEventListener(CLOUD_SYNC_APPLIED_EVENT, onCloudApplied)
  }, [])

  useEffect(() => {
    if (prefsMountedRef.current) {
      savePrefs(prefs)
    } else {
      prefsMountedRef.current = true
    }
  }, [prefs])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      meta.setAttribute('content', theme === 'dark' ? '#141414' : '#ffffff')
    }
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // ignore
    }
    if (themeMountedRef.current) {
      window.dispatchEvent(new CustomEvent(CLOUD_SYNC_DIRTY_EVENT))
    } else {
      themeMountedRef.current = true
    }
  }, [theme])

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_KEY, String(soundOn))
    } catch {
      // ignore
    }
    if (soundMountedRef.current) {
      window.dispatchEvent(new CustomEvent(CLOUD_SYNC_DIRTY_EVENT))
    } else {
      soundMountedRef.current = true
    }
  }, [soundOn])

  useEffect(() => {
    const baseTitle =
      routeInfo.activeRoute === 'settings'
        ? 'Settings · Syntax'
        : routeInfo.activeRoute === 'extensions'
          ? 'Extensions · Syntax'
          : routeInfo.activeRoute === 'community'
            ? 'Community Hub · Syntax'
            : routeInfo.clean.startsWith('/ext/')
              ? 'Extension · Syntax'
              : routeInfo.activeRoute === 'library'
                ? 'Library · Syntax'
                : routeInfo.activeRoute === 'profile'
                  ? 'Profile · Syntax'
                  : routeInfo.activeRoute === 'home'
                    ? 'Syntax'
                    : 'Library · Syntax'
    document.title = isDev ? `${baseTitle} (Dev)` : baseTitle
  }, [routeInfo, isDev])

  const redirectLegacyPlugins = useCallback(() => {
    setLocation('/extensions', { replace: true })
  }, [setLocation])

  const toggleTheme = useCallback(() => {
    emitSound('lightweight-choice')
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [emitSound])

  const toggleSound = useCallback(() => {
    setSoundOn(prev => {
      const next = !prev
      if (next) playUiSound('toggle-on')
      return next
    })
  }, [])

  return (
    <>
      {!hideToaster && <Toaster position="bottom-center" theme={theme} />}

      <AppHeader
        activeRoute={routeInfo.activeRoute}
        theme={theme}
        soundOn={soundOn}
        prefs={prefs}
        onNavigate={navigate}
        onOpenCommandPalette={() => setPaletteOpen(true)}
        onToggleTheme={toggleTheme}
        onToggleSound={toggleSound}
        onOpenWelcome={() => patchPrefs({ onboarded: false })}
        onPokeSema={() => emitSound('lightweight-choice')}
      />

      <Switch>
        <Route path="/">
          <SyntaxErrorBoundary scope="page:home" onExitScope={() => navigate('/library')}>
            <HomePage
              prefs={prefs}
              onNavigate={navigate}
              onOpenCommandPalette={() => setPaletteOpen(true)}
              onOpenLibrary={() => navigate('/library')}
              onOpenExtensions={() => navigate('/extensions')}
              onOpenCommunityHub={() => navigate('/community')}
              onOpenSettings={() => navigate('/settings')}
            />
          </SyntaxErrorBoundary>
        </Route>

        <Route path="/library">
          <SyntaxErrorBoundary scope="page:library" onExitScope={() => navigate('/')}>
            <LibraryPage
              onOpenExtensions={() => navigate('/extensions')}
              onOpenCommunityHub={() => navigate('/community')}
              onNavigate={navigate}
            />
          </SyntaxErrorBoundary>
        </Route>

        <Route path="/profile">
          <SyntaxErrorBoundary scope="page:profile" onExitScope={() => navigate('/library')}>
            <Suspense fallback={<RouteLoadingFallback label="Loading profile" />}>
              <ProfilePage
                prefs={prefs}
                onNavigate={navigate}
                onOpenExtensions={() => navigate('/extensions')}
              />
            </Suspense>
          </SyntaxErrorBoundary>
        </Route>

        <Route path="/settings">
          <SyntaxErrorBoundary scope="workspace:settings" onExitScope={() => navigate('/library')}>
            <Suspense fallback={<RouteLoadingFallback label="Loading settings" />}>
              <SettingsPage
                onClose={() => navigate('/library')}
                theme={theme}
                onChangeTheme={setTheme}
                soundOn={soundOn}
                onChangeSound={setSoundOn}
                prefs={prefs}
                onPatchPrefs={patchPrefs}
                onReplayWelcome={() => patchPrefs({ onboarded: false })}
              />
            </Suspense>
          </SyntaxErrorBoundary>
        </Route>

        <Route path="/extensions">
          <SyntaxErrorBoundary scope="workspace:extensions" onExitScope={() => navigate('/library')}>
            <Suspense fallback={<RouteLoadingFallback label="Loading extensions" />}>
              <ExtensionsPage
                onOpenCommunityHub={() => navigate('/community')}
                onNavigate={navigate}
              />
            </Suspense>
          </SyntaxErrorBoundary>
        </Route>

        <Route path="/plugins">
          <SyntaxErrorBoundary scope="workspace:extensions" onExitScope={() => navigate('/library')}>
            <Suspense fallback={<RouteLoadingFallback label="Loading extensions" />}>
              <LegacyPluginsRedirect
                onRedirect={redirectLegacyPlugins}
                onOpenCommunityHub={() => navigate('/community')}
                onNavigate={navigate}
              />
            </Suspense>
          </SyntaxErrorBoundary>
        </Route>

        <Route path="/ext/:extensionId/:viewId/:docId">
          {params => (
            <ExtensionPage
              extensionId={params.extensionId}
              viewId={params.viewId}
              docId={params.docId}
              onBackToLibrary={() => navigate('/library')}
              onOpenExtensions={() => navigate('/extensions')}
              onNavigate={navigate}
            />
          )}
        </Route>

        <Route path="/ext/:extensionId/:viewId">
          {params => (
            <ExtensionPage
              extensionId={params.extensionId}
              viewId={params.viewId}
              onBackToLibrary={() => navigate('/library')}
              onOpenExtensions={() => navigate('/extensions')}
              onNavigate={navigate}
            />
          )}
        </Route>

        <Route path="/community">
          <SyntaxErrorBoundary scope="workspace:community" onExitScope={() => navigate('/library')}>
            <Suspense fallback={<RouteLoadingFallback label="Loading Community Hub" />}>
              <CommunityHubPage
                onOpenExtensions={() => navigate('/extensions')}
                onNavigate={navigate}
              />
            </Suspense>
          </SyntaxErrorBoundary>
        </Route>

        <Route path="/community/:id">
          {params => (
            <SyntaxErrorBoundary scope="workspace:community" onExitScope={() => navigate('/library')}>
              <Suspense fallback={<RouteLoadingFallback label="Loading Community Hub" />}>
                <CommunityHubPage
                  highlightedId={params.id}
                  onOpenExtensions={() => navigate('/extensions')}
                  onNavigate={navigate}
                />
              </Suspense>
            </SyntaxErrorBoundary>
          )}
        </Route>

        <Route>
          <SyntaxErrorBoundary scope="page:library-fallback" onExitScope={() => navigate('/')}>
            <LibraryPage
              onOpenExtensions={() => navigate('/extensions')}
              onOpenCommunityHub={() => navigate('/community')}
              onNavigate={navigate}
            />
          </SyntaxErrorBoundary>
        </Route>
      </Switch>

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open={paletteOpen}
            theme={theme}
            soundOn={soundOn}
            onOpenChange={setPaletteOpen}
            onNavigate={navigate}
            onToggleTheme={toggleTheme}
            onToggleSound={toggleSound}
          />
        </Suspense>
      )}

      {!prefs.onboarded && !isSafeMode() && (
        <Suspense fallback={null}>
          <OnboardingModal
            open={!prefs.onboarded}
            theme={theme}
            semaShape={prefs.semaShape}
            semaTail={prefs.semaTail}
            onSelectTheme={setTheme}
            onFinish={() => patchPrefs({ onboarded: true })}
          />
        </Suspense>
      )}

      {isDev && (
        <Suspense fallback={null}>
          <DevToolsSuite />
        </Suspense>
      )}
    </>
  )
}

function useCleanHashLocation(): [string, ReturnType<typeof useHashLocation>[1]] {
  const [rawLocation, navigate] = useHashLocation()
  const cleanLocation = rawLocation.split('?')[0] || '/'
  return [cleanLocation, navigate]
}

export function AppShell(props: AppShellProps) {
  return (
    <Router hook={useCleanHashLocation}>
      <AppShellInner {...props} />
    </Router>
  )
}

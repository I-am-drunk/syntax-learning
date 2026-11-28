import { useEffect, useState } from 'react'
import { Agentation } from 'agentation'
import { canResetDevState, resetDevState } from './devEnv'
import { clearLogs, getLogs } from './logger'

type ErudaEl = {
  html: (markup: string) => void
  on: (ev: string, sel: string, fn: () => void) => void
  show?: () => void
  hide?: () => void
}

type ErudaApi = {
  init: (opts?: Record<string, unknown>) => void
  destroy: () => void
  add: (plugin: unknown) => void
  position: (pos: { x: number; y: number }) => void
  get: (name?: string) => unknown
  show: (name?: string) => void
}

declare global {
  interface Window {
    __SYNTAX_ERUDA_INIT__?: boolean
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Dev-only inspector suite (lazy-loaded strictly behind isDevEnvironment(), 0 KB in prod):
 * 1. Agentation (bottom-right): visual element inspector, click/hover tracking, React tree,
 *    computed styles, animation pause, and copyable UI feedback annotations.
 * 2. Eruda + eruda-monitor + eruda-touches (bottom-left): full in-page DevTools with
 *    Elements highlighter, Console, Network, Resources (cookies/storage), FPS/Memory Monitor,
 *    on-screen Touches/Clicks overlay, and a dedicated Syntax tab for state reset & logs.
 */
export function DevToolsSuite() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth > 768 : true,
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(min-width: 769px)')
    const sync = () => setIsDesktop(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || window.__SYNTAX_ERUDA_INIT__) return
    let cancelled = false
    let erudaRef: ErudaApi | null = null

    async function mountEruda() {
      const [erudaMod, monitorMod, touchesMod] = await Promise.all([
        import('eruda'),
        import('eruda-monitor'),
        import('eruda-touches'),
      ])
      if (cancelled) return

      const eruda = (erudaMod.default ?? erudaMod) as ErudaApi
      const erudaMonitor = monitorMod.default ?? monitorMod
      const erudaTouches = touchesMod.default ?? touchesMod
      erudaRef = eruda

      const isDark = document.documentElement.dataset.theme === 'dark'
      eruda.init({
        // Keep Console first so Elements does NOT auto-activate its full-screen DOM
        // box highlighter overlay on initial load.
        tool: ['console', 'elements', 'network', 'resources', 'info'],
        useShadowDom: true,
        autoScale: true,
        defaults: {
          displaySize: 48,
          transparency: 0.96,
          theme: isDark ? 'Dark' : 'Light',
        },
      })
      try {
        ;(eruda as unknown as { hide?: () => void }).hide?.()
      } catch {
        // ignore
      }

      try {
        eruda.add(erudaMonitor)
      } catch {
        // ignore if already added
      }
      try {
        eruda.add(erudaTouches)
      } catch {
        // ignore if already added
      }

      // Register a dedicated Syntax tool tab inside Eruda for quick state inspection & reset
      let syntaxPanelEl: ErudaEl | null = null
      const renderSyntaxPanel = () => {
        if (!syntaxPanelEl) return
        const logs = getLogs().slice(0, 25)
        const route = window.location.hash || '#/'
        const theme = document.documentElement.dataset.theme || 'light'
        const viewport = `${window.innerWidth}x${window.innerHeight} @ ${window.devicePixelRatio || 1}x`
        const logHtml =
          logs.length === 0
            ? '<div style="opacity:.65;font-size:12px;padding:8px 0;">No runtime logs captured yet.</div>'
            : logs
                .map(
                  entry =>
                    `<div style="padding:6px 8px;margin-bottom:6px;border-radius:6px;border:1px solid rgba(127,127,127,.25);font-size:11.5px;font-family:monospace;">
                      <strong>[${escapeHtml(entry.level)}]</strong> ${escapeHtml(entry.scope)}: ${escapeHtml(entry.message)}
                    </div>`,
                )
                .join('')

        syntaxPanelEl.html(`
          <div style="padding:14px;font-family:system-ui,-apple-system,sans-serif;line-height:1.45;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:14px;">
              <div>
                <div style="font-size:15px;font-weight:700;">Syntax Dev Inspector</div>
                <div style="font-size:12px;opacity:.7;">Route: <code>${escapeHtml(route)}</code> &middot; Theme: ${escapeHtml(theme)} &middot; ${escapeHtml(viewport)}</div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" data-sx-dev="refresh" style="padding:6px 11px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:12px;font-weight:600;cursor:pointer;">Refresh</button>
                <button type="button" data-sx-dev="clear-logs" style="padding:6px 11px;border-radius:8px;border:1px solid rgba(127,127,127,.35);background:transparent;color:inherit;font-size:12px;font-weight:600;cursor:pointer;">Clear logs</button>
                ${canResetDevState ? '<button type="button" data-sx-dev="reset" style="padding:6px 11px;border-radius:8px;border:1px solid #ef4444;background:rgba(239,68,68,.12);color:#ef4444;font-size:12px;font-weight:700;cursor:pointer;">Reset Dev state</button>' : ''}
              </div>
            </div>
            <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;opacity:.7;margin-bottom:8px;">Recent Runtime Logs (${logs.length})</div>
            ${logHtml}
          </div>
        `)
      }

      try {
        eruda.add({
          name: 'Syntax',
          init($el: ErudaEl) {
            syntaxPanelEl = $el
            renderSyntaxPanel()
            $el.on('click', '[data-sx-dev="reset"]', () => {
              void resetDevState()
            })
            $el.on('click', '[data-sx-dev="refresh"]', () => {
              renderSyntaxPanel()
            })
            $el.on('click', '[data-sx-dev="clear-logs"]', () => {
              clearLogs()
              renderSyntaxPanel()
            })
          },
          show() {
            renderSyntaxPanel()
            syntaxPanelEl?.show?.()
          },
          hide() {
            syntaxPanelEl?.hide?.()
          },
          destroy() {
            syntaxPanelEl = null
          },
        })
      } catch {
        // ignore
      }

      // Park Eruda button cleanly at bottom-left so it never overlaps Agentation or the floating mobile bottom dock
      const parkEruda = () => {
        try {
          const bottomClearance = window.innerWidth <= 768 ? 132 : 54
          eruda.position({ x: 12, y: Math.max(84, window.innerHeight - bottomClearance) })
        } catch {
          // ignore
        }
      }
      parkEruda()
      window.addEventListener('resize', parkEruda, { passive: true })

      window.__SYNTAX_ERUDA_INIT__ = true
      return () => {
        window.removeEventListener('resize', parkEruda)
      }
    }

    let detachListeners: (() => void) | undefined
    void mountEruda().then(fn => {
      detachListeners = fn
    })

    return () => {
      cancelled = true
      detachListeners?.()
      if (erudaRef && window.__SYNTAX_ERUDA_INIT__) {
        try {
          erudaRef.destroy()
        } catch {
          // ignore
        }
        window.__SYNTAX_ERUDA_INIT__ = false
      }
    }
  }, [])

  return isDesktop ? <Agentation useHashLocation appName="Syntax Dev" /> : null
}

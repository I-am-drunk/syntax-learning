import { channelStateKey } from './channelState.ts'
import { useSyncExternalStore } from 'react'

export type LogLevel = 'info' | 'warn' | 'error'

export type LogEntry = {
  id: string
  ts: number
  level: LogLevel
  scope: string
  message: string
  detail?: string
}

export type ErrorSink = (entry: LogEntry, rawError?: unknown) => void
export type AnalyticsSink = (eventName: string, props?: Record<string, unknown>) => void

const MAX_ENTRIES = 300
const SESSION_ERR_KEY = channelStateKey('syntax.recentErrors.v1')

let entries: LogEntry[] = []
const listeners = new Set<() => void>()
const errorSinks = new Set<ErrorSink>()
const analyticsSinks = new Set<AnalyticsSink>()
let globalCaptureInitialized = false

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

function serializeDetail(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined
  if (detail instanceof Error) {
    return detail.stack ? `${detail.message}\n${detail.stack}` : detail.message
  }
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail, null, 2)
  } catch {
    return String(detail)
  }
}

function persistRecentError(entry: LogEntry) {
  if (typeof sessionStorage === 'undefined') return
  try {
    const raw = sessionStorage.getItem(SESSION_ERR_KEY)
    const prev: LogEntry[] = raw ? JSON.parse(raw) : []
    const next = [entry, ...prev].slice(0, 50)
    sessionStorage.setItem(SESSION_ERR_KEY, JSON.stringify(next))
  } catch {
    // ignore storage errors
  }
}

function push(level: LogLevel, scope: string, message: string, detail?: unknown) {
  const entry: LogEntry = {
    id: makeId(),
    ts: Date.now(),
    level,
    scope,
    message,
    detail: serializeDetail(detail),
  }
  entries = [entry, ...entries].slice(0, MAX_ENTRIES)

  if (level === 'error') {
    persistRecentError(entry)
    for (const sink of errorSinks) {
      try {
        sink(entry, detail)
      } catch {
        // never let a sink crash the app
      }
    }
  }
  notify()
}

export const syntaxLog = {
  info(scope: string, message: string, detail?: unknown) {
    push('info', scope, message, detail)
  },
  warn(scope: string, message: string, detail?: unknown) {
    push('warn', scope, message, detail)
  },
  error(scope: string, message: string, detail?: unknown) {
    push('error', scope, message, detail)
  },
  event(name: string, props?: Record<string, unknown>) {
    push('info', 'event', name, props)
    for (const sink of analyticsSinks) {
      try {
        sink(name, props)
      } catch {
        // ignore sink failure
      }
    }
  },
}

/**
 * Drop-in hook for Sentry or any external error tracker.
 */
export function registerErrorSink(sink: ErrorSink): () => void {
  errorSinks.add(sink)
  return () => errorSinks.delete(sink)
}

/**
 * Drop-in hook for PostHog or any external product analytics.
 */
export function registerAnalyticsSink(sink: AnalyticsSink): () => void {
  analyticsSinks.add(sink)
  return () => analyticsSinks.delete(sink)
}

export function getRegisteredSinkCounts() {
  return {
    errorSinks: errorSinks.size,
    analyticsSinks: analyticsSinks.size,
  }
}

export function initGlobalErrorCapture() {
  if (globalCaptureInitialized || typeof window === 'undefined') return
  globalCaptureInitialized = true

  window.addEventListener('error', event => {
    syntaxLog.error(
      'window',
      event.message || 'Uncaught runtime error',
      event.error ?? `${event.filename}:${event.lineno}`,
    )
  })

  window.addEventListener('unhandledrejection', event => {
    syntaxLog.error('promise', 'Unhandled promise rejection', event.reason)
  })

  syntaxLog.info('core', 'Syntax runtime initialized')
}

export function getLogs(): LogEntry[] {
  return entries
}

export function clearLogs() {
  entries = []
  try {
    sessionStorage.removeItem(SESSION_ERR_KEY)
  } catch {
    // ignore
  }
  notify()
}

export function exportLogsText(): string {
  const header = `Syntax Diagnostics Log (${new Date().toISOString()})\nURL: ${typeof location !== 'undefined' ? location.href : 'n/a'}\nUserAgent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'n/a'}\n---\n`
  const lines = [...entries].reverse().map(e => {
    const time = new Date(e.ts).toISOString().slice(11, 23)
    const base = `[${time}] [${e.level.toUpperCase()}] [${e.scope}] ${e.message}`
    return e.detail ? `${base}\n  ${e.detail.replace(/\n/g, '\n  ')}` : base
  })
  return header + lines.join('\n')
}

export function useSyntaxLogs(): readonly LogEntry[] {
  return useSyncExternalStore(
    cb => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => entries,
    () => entries,
  )
}

import { channelStateKey } from '../core/channelState.ts'
import { create } from 'zustand'
import { z } from 'zod'
import { extensionManifestSchema, type ExtensionManifest } from './manifest.ts'

const RECORDS_STORAGE_KEY = channelStateKey('syntax.extensions.v1')
const SETTINGS_STORAGE_KEY = channelStateKey('syntax.extensions.settings.v1')
const BOOT_SENTINEL_KEY = channelStateKey('syntax.extensions.boot-attempts.v1')
const BOOT_CRASH_THRESHOLD = 3

/**
 * Tracks consecutive incomplete extension startups in sessionStorage so repeated crashes
 * during boot automatically fall back to Safe Mode instead of trapping the user.
 */
export function beginBootGuard(hasEnabledExtensions: boolean): boolean {
  if (!hasEnabledExtensions || typeof sessionStorage === 'undefined') return false
  try {
    const raw = Number.parseInt(sessionStorage.getItem(BOOT_SENTINEL_KEY) || '0', 10)
    const attempts = Number.isFinite(raw) && raw > 0 ? raw : 0
    if (attempts >= BOOT_CRASH_THRESHOLD) {
      sessionStorage.removeItem(BOOT_SENTINEL_KEY)
      return true
    }
    sessionStorage.setItem(BOOT_SENTINEL_KEY, String(attempts + 1))
  } catch {
    // ignore storage errors
  }
  return false
}

export function completeBootGuard(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(BOOT_SENTINEL_KEY)
  } catch {
    // ignore
  }
}

export interface ExtensionRecord {
  id: string
  manifestUrl: string
  origin: string
  enabled: boolean
  installedAt: number
  updatedAt: number
  manifest: ExtensionManifest
}

export type ExtensionStatus = 'disabled' | 'safe-mode' | 'loading' | 'active' | 'failed'

export interface ExtensionRuntimeInfo {
  id: string
  status: ExtensionStatus
  activationId: string | null
  lastError: {
    code: string
    message: string
    detail?: string
    at: number
  } | null
  unavailableOptionalServices: Record<string, string>
  hasLiveWorker: boolean
}

export type ExtensionSettingValue = boolean | string | number

const persistedRecordSchema = z.object({
  id: z.string().min(3),
  manifestUrl: z.string().url(),
  origin: z.string().min(1),
  enabled: z.boolean(),
  installedAt: z.number(),
  updatedAt: z.number(),
  manifest: extensionManifestSchema,
})

export function isSafeMode(
  search = typeof window !== 'undefined' ? window.location.search : '',
  hash = typeof window !== 'undefined' ? window.location.hash : '',
): boolean {
  try {
    if (search) {
      const params = new URLSearchParams(search)
      const val = params.get('safeMode')
      if (val === '1' || val === 'true') return true
    }
    const qIdx = hash.indexOf('?')
    if (qIdx >= 0) {
      const params = new URLSearchParams(hash.slice(qIdx + 1))
      const val = params.get('safeMode')
      if (val === '1' || val === 'true') return true
    }
  } catch {
    // ignore malformed query strings
  }
  return false
}

export function exitSafeModeAndReload(): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('safeMode')
  if (url.hash.includes('safeMode=')) {
    const [hashPath, hashQuery] = url.hash.split('?')
    const params = new URLSearchParams(hashQuery ?? '')
    params.delete('safeMode')
    const qs = params.toString()
    url.hash = qs ? `${hashPath}?${qs}` : hashPath || '#/extensions'
  }
  window.history.replaceState(null, '', url.toString())
  window.location.reload()
}

function readPersistedRecords(): ExtensionRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECORDS_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const valid: ExtensionRecord[] = []
    const seen = new Set<string>()
    for (const item of parsed) {
      const check = persistedRecordSchema.safeParse(item)
      if (!check.success) continue
      if (seen.has(check.data.id) || check.data.id !== check.data.manifest.id) continue
      seen.add(check.data.id)
      valid.push(check.data)
    }
    return valid
  } catch {
    return []
  }
}

function writePersistedRecords(records: ExtensionRecord[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records))
  } catch {
    // ignore quota errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('syntax:cloud-dirty'))
  }
}

function readPersistedSettings(): Record<string, Record<string, ExtensionSettingValue>> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, Record<string, ExtensionSettingValue>>
  } catch {
    return {}
  }
}

function writePersistedSettings(settings: Record<string, Record<string, ExtensionSettingValue>>) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // ignore quota errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('syntax:cloud-dirty'))
  }
}

function emitSettingsChanged(extensionId: string | null) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('syntax:extension-settings-changed', { detail: { extensionId } }),
    )
  }
}

export function createInitialRuntime(
  record: ExtensionRecord,
  safeMode: boolean,
): ExtensionRuntimeInfo {
  return {
    id: record.id,
    status: !record.enabled ? 'disabled' : safeMode ? 'safe-mode' : 'loading',
    activationId: null,
    lastError: null,
    unavailableOptionalServices: {},
    hasLiveWorker: false,
  }
}

interface ExtensionStoreState {
  records: ExtensionRecord[]
  runtime: Record<string, ExtensionRuntimeInfo>
  settings: Record<string, Record<string, ExtensionSettingValue>>
  safeMode: boolean
  autoSafeMode: boolean
  booted: boolean

  setSafeMode: (safeMode: boolean, autoTriggered?: boolean) => void
  setBooted: (booted: boolean) => void
  upsertRecord: (record: ExtensionRecord) => void
  removeRecord: (id: string) => void
  setRuntime: (id: string, patch: Partial<ExtensionRuntimeInfo>) => void
  removeRuntime: (id: string) => void
  getSetting: (
    extId: string,
    key: string,
    manifestOverride?: ExtensionManifest,
  ) => ExtensionSettingValue | undefined
  setSetting: (extId: string, key: string, value: ExtensionSettingValue) => void
  getAllSettings: (
    extId: string,
    manifestOverride?: ExtensionManifest,
  ) => Record<string, ExtensionSettingValue>
  clearSettings: (extId: string) => void
  reloadSettingsFromStorage: () => void
  reloadFromStorage: () => void
}

const initialSafeMode = isSafeMode()
const initialRecords = readPersistedRecords()
const initialRuntime: Record<string, ExtensionRuntimeInfo> = {}
for (const rec of initialRecords) {
  initialRuntime[rec.id] = createInitialRuntime(rec, initialSafeMode)
}

export const useExtensionStore = create<ExtensionStoreState>((set, get) => ({
  records: initialRecords,
  runtime: initialRuntime,
  settings: readPersistedSettings(),
  safeMode: initialSafeMode,
  autoSafeMode: false,
  booted: false,

  setSafeMode(safeMode, autoTriggered = false) {
    set({ safeMode, autoSafeMode: safeMode ? autoTriggered : false })
  },

  setBooted(booted) {
    set({ booted })
  },

  upsertRecord(record) {
    set(state => {
      // Merge against latest persisted records so concurrent tabs do not clobber each other
      const latestDisk = typeof localStorage !== 'undefined' ? readPersistedRecords() : state.records
      const base = latestDisk.length > 0 || state.records.length === 0 ? latestDisk : state.records
      const idx = base.findIndex(r => r.id === record.id)
      const next =
        idx >= 0
          ? base.map(r => (r.id === record.id ? record : r))
          : [...base, record]
      writePersistedRecords(next)
      const runtime = state.runtime[record.id]
        ? state.runtime
        : { ...state.runtime, [record.id]: createInitialRuntime(record, state.safeMode) }
      return { records: next, runtime }
    })
  },

  removeRecord(id) {
    set(state => {
      const latestDisk = typeof localStorage !== 'undefined' ? readPersistedRecords() : state.records
      const base = latestDisk.length > 0 || state.records.length === 0 ? latestDisk : state.records
      const next = base.filter(r => r.id !== id)
      writePersistedRecords(next)
      const nextRuntime = { ...state.runtime }
      delete nextRuntime[id]
      return { records: next, runtime: nextRuntime }
    })
  },

  setRuntime(id, patch) {
    set(state => {
      const prev = state.runtime[id] ?? {
        id,
        status: 'disabled' as const,
        activationId: null,
        lastError: null,
        unavailableOptionalServices: {},
        hasLiveWorker: false,
      }
      return {
        runtime: {
          ...state.runtime,
          [id]: { ...prev, ...patch },
        },
      }
    })
  },

  removeRuntime(id) {
    set(state => {
      const next = { ...state.runtime }
      delete next[id]
      return { runtime: next }
    })
  },

  getSetting(extId, key, manifestOverride) {
    const manifest = manifestOverride ?? get().records.find(r => r.id === extId)?.manifest
    const def = manifest?.settings.find(s => s.id === key)
    if (!def) return undefined
    const saved = get().settings[extId]?.[key]
    if (saved !== undefined && typeof saved === def.type) {
      if (def.type !== 'number' || Number.isFinite(saved)) {
        return saved
      }
    }
    return def.default
  },

  setSetting(extId, key, value) {
    if (typeof value === 'number' && !Number.isFinite(value)) return
    set(state => {
      const nextSettings = {
        ...state.settings,
        [extId]: {
          ...(state.settings[extId] ?? {}),
          [key]: value,
        },
      }
      writePersistedSettings(nextSettings)
      return { settings: nextSettings }
    })
    emitSettingsChanged(extId)
  },

  getAllSettings(extId, manifestOverride) {
    const manifest = manifestOverride ?? get().records.find(r => r.id === extId)?.manifest
    const out: Record<string, ExtensionSettingValue> = {}
    const saved = get().settings[extId]
    for (const def of manifest?.settings ?? []) {
      const candidate = saved?.[def.id]
      const validSaved =
        candidate !== undefined &&
        typeof candidate === def.type &&
        (def.type !== 'number' || Number.isFinite(candidate))
      out[def.id] = validSaved ? candidate : def.default
    }
    return out
  },

  clearSettings(extId) {
    set(state => {
      const next = { ...state.settings }
      delete next[extId]
      writePersistedSettings(next)
      return { settings: next }
    })
    emitSettingsChanged(extId)
  },

  reloadSettingsFromStorage() {
    set({ settings: readPersistedSettings() })
    emitSettingsChanged(null)
  },

  reloadFromStorage() {
    const safeMode = isSafeMode()
    const records = readPersistedRecords()
    const runtime: Record<string, ExtensionRuntimeInfo> = {}
    for (const rec of records) {
      runtime[rec.id] = createInitialRuntime(rec, safeMode)
    }
    set({
      safeMode,
      records,
      runtime,
      settings: readPersistedSettings(),
    })
  },
}))

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key === SETTINGS_STORAGE_KEY) {
      useExtensionStore.setState({ settings: readPersistedSettings() })
      emitSettingsChanged(null)
    } else if (event.key === RECORDS_STORAGE_KEY) {
      const records = readPersistedRecords()
      const state = useExtensionStore.getState()
      const nextRuntime: Record<string, ExtensionRuntimeInfo> = {}
      for (const rec of records) {
        nextRuntime[rec.id] = state.runtime[rec.id] ?? createInitialRuntime(rec, state.safeMode)
      }
      useExtensionStore.setState({ records, runtime: nextRuntime })
    }
  })
}

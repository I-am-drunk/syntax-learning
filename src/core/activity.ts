import { channelStateKey } from './channelState.ts'
export type ActivityCategory = 'course' | 'extension' | 'document' | 'visit'

export interface DailyActivityRecord {
  total: number
  course: number
  extension: number
  document: number
  visit: number
}

export type ActivityHistoryMap = Record<string, DailyActivityRecord>

const ACTIVITY_STORAGE_KEY = channelStateKey('syntax.activity.v1')
const ACTIVITY_EVENT = 'syntax:activity-changed'

export function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function loadActivityHistory(): ActivityHistoryMap {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(ACTIVITY_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: ActivityHistoryMap = {}
    for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !val || typeof val !== 'object') continue
      const row = val as Record<string, unknown>
      const course = typeof row.course === 'number' && row.course > 0 ? Math.floor(row.course) : 0
      const extension =
        typeof row.extension === 'number' && row.extension > 0 ? Math.floor(row.extension) : 0
      const document =
        typeof row.document === 'number' && row.document > 0 ? Math.floor(row.document) : 0
      const visit = typeof row.visit === 'number' && row.visit > 0 ? Math.floor(row.visit) : 0
      const total = Math.max(
        typeof row.total === 'number' && row.total > 0 ? Math.floor(row.total) : 0,
        course + extension + document + visit,
      )
      if (total > 0) {
        out[key] = { total, course, extension, document, visit }
      }
    }
    return out
  } catch {
    return {}
  }
}

export function recordActivity(category: ActivityCategory, amount = 1, date = new Date()): void {
  if (typeof localStorage === 'undefined' || amount <= 0) return
  const key = formatLocalDateKey(date)
  const map = loadActivityHistory()
  const prev: DailyActivityRecord = map[key] ?? {
    total: 0,
    course: 0,
    extension: 0,
    document: 0,
    visit: 0,
  }
  // Only count a daily visit once per calendar day
  if (category === 'visit' && prev.visit > 0) return
  const inc = Math.max(1, Math.floor(amount))
  map[key] = {
    ...prev,
    [category]: prev[category] + inc,
    total: prev.total + inc,
  }
  try {
    localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // ignore storage quota errors
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT))
  }
}

export function subscribeActivityChanged(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(ACTIVITY_EVENT, callback)
  return () => window.removeEventListener(ACTIVITY_EVENT, callback)
}

export function computeActivityStats(
  map: ActivityHistoryMap,
  today = new Date(),
): {
  activeDays: number
  currentStreak: number
  bestStreak: number
  totalEvents: number
} {
  const keys = Object.keys(map)
    .filter(k => (map[k]?.total ?? 0) > 0)
    .sort()
  const activeDays = keys.length
  let totalEvents = 0
  for (const k of keys) totalEvents += map[k]!.total

  const keySet = new Set(keys)

  // Current streak (counting backwards from today or yesterday)
  let currentStreak = 0
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  if (!keySet.has(formatLocalDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1)
  }
  while (keySet.has(formatLocalDateKey(cursor))) {
    currentStreak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  // Best streak across recorded history
  let bestStreak = 0
  let run = 0
  let prevTime: number | null = null
  for (const k of keys) {
    const [y, m, d] = k.split('-').map(Number)
    const time = Date.UTC(y!, m! - 1, d!)
    if (prevTime !== null && time - prevTime === 86_400_000) {
      run += 1
    } else {
      run = 1
    }
    if (run > bestStreak) bestStreak = run
    prevTime = time
  }

  return { activeDays, currentStreak, bestStreak, totalEvents }
}

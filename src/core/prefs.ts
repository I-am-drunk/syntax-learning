import { channelStateKey } from './channelState.ts'
import {
  isValidExpressionName,
  isValidShapeName,
  isValidTailName,
  type SemaExpressionName,
  type SemaShapeName,
  type SemaTailName,
} from '../mascot/bloub'

const PREFS_KEY = channelStateKey('syntax.prefs.v1')
const LEGACY_PREFS_KEY = channelStateKey('syntax.mpm2d.prefs.v1')
const COOKIE_NAME = channelStateKey('syntax_prefs')
const LEGACY_COOKIE_NAME = channelStateKey('syntax_mpm2d_prefs')

export type LogoClickTarget = 'library' | 'home'
export type NavBarStyle = 'underline' | 'pill'

export type SyntaxPrefs = {
  onboarded: boolean
  logoClickTarget: LogoClickTarget
  navStyle: NavBarStyle
  semaShape: SemaShapeName
  semaTail: SemaTailName
  semaExpression: SemaExpressionName
}

const DEFAULT_PREFS: SyntaxPrefs = {
  onboarded: false,
  logoClickTarget: 'library',
  navStyle: 'underline',
  semaShape: 'jenson',
  semaTail: 'jenson',
  semaExpression: 'neutral',
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  const parts = document.cookie.split(';')
  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length))
      } catch {
        return null
      }
    }
  }
  return null
}

function writeCookie(name: string, value: string) {
  if (typeof document === 'undefined') return
  try {
    const maxAge = 60 * 60 * 24 * 365
    document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAge}; path=/; SameSite=Lax`
  } catch {
    // ignore cookie errors in restricted contexts
  }
}

function parseRawPrefs(raw: string | null): Partial<SyntaxPrefs> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Partial<SyntaxPrefs>
  } catch {
    return null
  }
}

export function loadPrefs(): SyntaxPrefs {
  let lsRaw: string | null = null
  try {
    lsRaw = localStorage.getItem(PREFS_KEY) ?? localStorage.getItem(LEGACY_PREFS_KEY)
  } catch {
    // localStorage unavailable in restricted/private mode
  }
  const parsed =
    parseRawPrefs(lsRaw) ??
    parseRawPrefs(readCookie(COOKIE_NAME)) ??
    parseRawPrefs(readCookie(LEGACY_COOKIE_NAME))

  if (!parsed) return { ...DEFAULT_PREFS }

  const rawShape = parsed.semaShape
  const validShape =
    isValidShapeName(rawShape) && rawShape !== 'circle' ? rawShape : DEFAULT_PREFS.semaShape

  const rawLogoTarget = parsed.logoClickTarget
  const logoClickTarget: LogoClickTarget =
    rawLogoTarget === 'home' || rawLogoTarget === 'library'
      ? rawLogoTarget
      : DEFAULT_PREFS.logoClickTarget

  const rawNavStyle = parsed.navStyle
  const navStyle: NavBarStyle =
    rawNavStyle === 'pill' || rawNavStyle === 'underline'
      ? rawNavStyle
      : DEFAULT_PREFS.navStyle

  return {
    onboarded: Boolean(parsed.onboarded ?? DEFAULT_PREFS.onboarded),
    logoClickTarget,
    navStyle,
    semaShape: validShape,
    semaTail: isValidTailName(parsed.semaTail) ? parsed.semaTail : DEFAULT_PREFS.semaTail,
    semaExpression: isValidExpressionName(parsed.semaExpression)
      ? parsed.semaExpression
      : DEFAULT_PREFS.semaExpression,
  }
}

export function savePrefs(next: SyntaxPrefs) {
  const serialized = JSON.stringify(next)
  try {
    localStorage.setItem(PREFS_KEY, serialized)
  } catch {
    // ignore storage quota errors
  }
  writeCookie(COOKIE_NAME, serialized)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('syntax:prefs-changed', { detail: next }))
  }
}

export function updatePrefs(patch: Partial<SyntaxPrefs>): SyntaxPrefs {
  const merged = { ...loadPrefs(), ...patch }
  savePrefs(merged)
  return merged
}

const LEGACY_PREFIXES: Array<{ from: string; to: string }> = [
  { from: '/chat/', to: '/dialogue/' }
]

const LEGACY_EXACT: Record<string, string> = {
  '/': '/overview',
  '/chat': '/dialogue',
  '/logs': '/observability/logs',
  '/config': '/settings/config'
}

export function resolveLegacyConsolePath(path: string): string | null {
  const normalizedPath = path === '' ? '/' : path

  if (normalizedPath in LEGACY_EXACT) {
    return LEGACY_EXACT[normalizedPath]
  }

  for (const { from, to } of LEGACY_PREFIXES) {
    if (normalizedPath.startsWith(from)) {
      return `${to}${normalizedPath.slice(from.length)}`
    }
  }

  return null
}

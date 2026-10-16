// No imports: the dev-server editor plugin loads this file directly under Node.
const escapeToken = (t: string) => t.replace(/~/g, '~0').replace(/\//g, '~1')

/**
 * Compares two versions of an example's decoded inputs (http, json, jwts) and returns the JSON pointers of the view
 * document (see viewOf) whose value changed, appeared or disappeared. Changing a JWT's signing or encryption settings
 * points at its header; changing an SD-JWT disclosure points at the payload's _sd digests.
 */
export function diffInputs(before: Record<string, unknown>, after: Record<string, unknown>): { changed: string[]; removed: string[] } {
  const changed = new Set<string>()
  const removed = new Set<string>()
  const walk = (a: unknown, b: unknown, path: string[]) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return
    const ptr = toView(path)
    if (b === undefined) {
      if (ptr) removed.add(ptr)
      return
    }
    const objA = a !== null && typeof a === 'object'
    const objB = b !== null && typeof b === 'object'
    // A list that grew or shrank counts as one changed field.
    const resized = Array.isArray(a) && Array.isArray(b) && a.length !== b.length
    if (a === undefined || !objA || !objB || Array.isArray(a) !== Array.isArray(b) || resized) {
      if (ptr) changed.add(ptr)
      return
    }
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
    for (const k of keys) walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], [...path, k])
  }
  walk(before, after, [])
  for (const r of removed) if (changed.has(r)) removed.delete(r)
  return { changed: [...changed].sort(), removed: [...removed].sort() }
}

/** Input path → view pointer, or null where the input has no field of its own in the view. */
function toView(path: string[]): string | null {
  const [top, ...rest] = path
  const p = (parts: string[]) => parts.map((t) => `/${escapeToken(t)}`).join('')
  if (top === 'json') return `/json${p(rest)}`
  if (top === 'http') {
    const [section, ...tail] = rest
    if (section === 'body') return tail[0] === 'value' ? `/http/body${p(tail.slice(1))}` : '/http/body'
    if (section === 'headers') return `/http/headers${p(tail)}`
    if (section === 'url') return '/http/url'
    return null
  }
  if (top === 'jwts') {
    const [name, part, ...tail] = rest
    if (!name) return null
    if (part === 'header' || part === 'payload') return `/jwt/${escapeToken(name)}/${part}${p(tail)}`
    if (part === 'disclosures') return `/jwt/${escapeToken(name)}/payload/_sd`
    if (part === 'kb') {
      const [kbPart, ...kbTail] = tail
      return kbPart === 'header' || kbPart === 'payload' ? `/jwt/${escapeToken(`${name}-kb`)}/${kbPart}${p(kbTail)}` : `/jwt/${escapeToken(`${name}-kb`)}/header`
    }
    return `/jwt/${escapeToken(name)}/header`
  }
  return null
}

/** True when the field at `ptr` lies at or below one of the pointers. */
export function coveredBy(ptr: string, pointers: readonly string[]): boolean {
  return pointers.some((c) => ptr === c || ptr.startsWith(`${c}/`))
}

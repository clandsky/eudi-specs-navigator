import { describe, expect, it } from 'vitest'
import { parseDocument } from 'yaml'
import { removeEntry, replaceEntry } from './yaml-edit.ts'

const FILE = `# File header.
# Second line.
- id: a
  note: first
# About b.
- id: b
  note: second
- id: c
  note: third
`

describe('yaml-edit', () => {
  it('keeps the file header when the first entry is removed', () => {
    const doc = parseDocument(FILE)
    expect(removeEntry(doc, 'a')).toEqual({ id: 'a', note: 'first' })
    const out = doc.toString()
    expect(out.startsWith('# File header.\n# Second line.\n')).toBe(true)
    expect(out).toContain('# About b.')
    expect(out).not.toContain('first')
  })

  it('drops the comment of a later removed entry', () => {
    const doc = parseDocument(FILE)
    removeEntry(doc, 'b')
    const out = doc.toString()
    expect(out.startsWith('# File header.')).toBe(true)
    expect(out).not.toContain('About b')
  })

  it('keeps the header when the only entry is removed', () => {
    const doc = parseDocument('# Header.\n- id: a\n')
    removeEntry(doc, 'a')
    expect(doc.toString()).toContain('# Header.')
  })

  it('replaces an entry in place with its comment', () => {
    const doc = parseDocument(FILE)
    expect(replaceEntry(doc, 'a', { id: 'a', note: 'changed' })).toBe(true)
    expect(doc.toString().startsWith('# File header.\n# Second line.\n- id: a\n  note: changed\n')).toBe(true)
    expect(replaceEntry(doc, 'x', {})).toBe(false)
  })
})

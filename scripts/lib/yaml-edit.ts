// Edits of one entry in a YAML list file (data/assertions/**) that keep the file's comments. The yaml library attaches
// a comment at the top of the file to the first list item, so removing or replacing that item would drop the header.
import { isMap, isSeq, type Document } from 'yaml'

type Item = { commentBefore?: string | null; toJSON(): Record<string, unknown> }

function itemsOf(doc: Document) {
  return isSeq(doc.contents) ? (doc.contents.items as unknown as Item[]) : []
}

function indexOf(doc: Document, id: string): number {
  return itemsOf(doc).findIndex((it) => isMap(it) && String(it.get('id' as never)) === id)
}

/** Removes the entry with this id and returns it as plain data, or null when the file has none. */
export function removeEntry(doc: Document, id: string): Record<string, unknown> | null {
  const items = itemsOf(doc)
  const index = indexOf(doc, id)
  if (index < 0) return null
  const [gone] = items.splice(index, 1)
  // Only the first item can carry the file header; comments above later items belong to the removed entry.
  if (index === 0 && gone!.commentBefore) {
    const next = items[0]
    if (next) next.commentBefore = [gone!.commentBefore, next.commentBefore].filter(Boolean).join('\n')
    else doc.commentBefore = [doc.commentBefore, gone!.commentBefore].filter(Boolean).join('\n')
  }
  return gone!.toJSON()
}

/** Replaces the entry with this id by `value`, keeping the comment above it. Returns false when there is no entry. */
export function replaceEntry(doc: Document, id: string, value: unknown): boolean {
  const items = itemsOf(doc)
  const index = indexOf(doc, id)
  if (index < 0) return false
  const node = doc.createNode(value) as unknown as Item
  node.commentBefore = items[index]!.commentBefore
  items[index] = node
  return true
}

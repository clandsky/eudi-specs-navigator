// Quote matching against the plain-text copies. PDF extraction leaves page furniture, ligatures, soft hyphens and
// line-wrapped hyphenation in the text; both sides are normalised the same way before searching.

/** Lines that are page headers/footers in the corpus PDFs and may sit in the middle of a quoted sentence. */
const FURNITURE: RegExp[] = [
  /^\s*ETSI\s*$/,
  /^\s*\d+\s+ETSI (TS|EN) [\d ‑-]+V\d+\.\d+\.\d+ \(\d{4}-\d{2}\)\s*$/,
  /^\s*ETSI (TS|EN) [\d ‑-]+V\d+\.\d+\.\d+ \(\d{4}-\d{2}\)\s+\d+\s*$/,
  /^\s*(\d+\/\d+\s+)?ELI: http:\/\/data\.europa\.eu\/eli\/\S+(\s+\d+\/\d+)?\s*$/,
  /^\s*(EN\s+)?OJ L, \d+\.\d+\.\d{4}(\s+EN)?\s*$/,
  /^\s*EN\s*$/,
  // IETF page footers/headers in RFC text files
  /^.*\[Page \d+\]\s*$/,
  /^(RFC \d+|Internet-Draft)\s{2,}.*\s{2,}\w+ \d{4}\s*$/,
]

export function stripFurniture(text: string): string {
  return text
    .replace(/\f/g, '\n') // pdftotext marks page starts with a form feed glued to the first line
    .split('\n')
    .filter((line) => !FURNITURE.some((re) => re.test(line)))
    .join('\n')
}

export function normalise(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/­\s*/g, '') // soft hyphen at a line break joins the word
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/([A-Za-z0-9_])-\s*\n\s*/g, '$1-') // hyphenated line wrap keeps the hyphen, drops the break
    .replace(/\s+/g, ' ')
    .replace(/- (?=[a-z])/g, '-') // same, after whitespace collapse
    .trim()
}

export function segments(quote: string): string[] {
  return quote
    .split(/\s*(?:…|\.\.\.)\s*/)
    .map((s) => normalise(s))
    .filter((s) => s.length > 0)
}

export interface QuoteHit {
  ok: boolean
  /** Offset of the first segment in the normalised text. */
  at: number
  missing?: string
}

/** Every segment must occur, in order. */
export function findQuote(normText: string, quote: string): QuoteHit {
  let from = 0
  let first = -1
  for (const seg of segments(quote)) {
    const i = normText.indexOf(seg, from)
    if (i < 0) return { ok: false, at: first, missing: seg }
    if (first < 0) first = i
    from = i + seg.length
  }
  return { ok: true, at: first }
}

/** A requirement id must appear close before (or inside) the quote. */
export function reqNear(normText: string, req: string, at: number, window = 1500): boolean {
  const ids = req.split(/\s*(?:,|\/|\bto\b)\s*/).filter(Boolean)
  const lo = Math.max(0, at - window)
  const slice = normText.slice(lo, at + window)
  return ids.some((id) => slice.includes(normalise(id)))
}

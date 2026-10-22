import * as Popover from '@radix-ui/react-popover'
import { useRef, useSyncExternalStore, type ReactNode } from 'react'
import { href, navigate, setParams, useRoute } from '../lib/router'
import { LENS_STAGES, today, useViewCtx } from '../lib/store'
import { cssLayer, formatDate } from './bits'
import { Search } from './Search'

const THEME_KEY = 'specs-navigator.theme'

// Dark is the default; light is opt-in and remembered. One store, so the top bar and the phone's More sheet agree.
let theme = (() => {
  try {
    return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
})()
const themeListeners = new Set<() => void>()
document.documentElement.setAttribute('data-theme', theme)

function nextTheme() {
  theme = theme === 'dark' ? 'light' : 'dark'
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* private mode: theme just isn't remembered */
  }
  themeListeners.forEach((f) => f())
}

function useTheme(): string {
  return useSyncExternalStore(
    (f) => {
      themeListeners.add(f)
      return () => themeListeners.delete(f)
    },
    () => theme,
  )
}

const icon = (paths: ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths}
  </svg>
)

const RSS_ICON = (
  <>
    <path d="M3 7.5a5.5 5.5 0 0 1 5.5 5.5M3 3a10 10 0 0 1 10 10" />
    <circle cx="3.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
  </>
)

interface Section {
  to: string
  label: string
  /** First path segments that belong to the section. */
  match: string[]
  icon: ReactNode
}

/** The sections in the top nav on wide screens and in the bottom tab bar on phones. */
const SECTIONS: Section[] = [
  {
    to: '',
    label: 'Flows',
    match: ['', 'flow', 'object', 'endpoints'],
    icon: <path d="M4 2v12M12 2v12M4 5.5h8M10 4l2 1.5L10 7M12 10.5H4M6 9l-2 1.5L6 12" />,
  },
  {
    to: 'spec',
    label: 'Specs',
    match: ['spec'],
    icon: <path d="M4 1.5h5.5l3 3v10H4zM9.5 1.5v3h3M6.5 8h3.5M6.5 11h3.5" />,
  },
  {
    to: 'wallets',
    label: 'Wallets',
    match: ['wallets', 'state', 'compare'],
    icon: <path d="M2.5 4.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1zM10 7.25h3.5v3H10a1.5 1.5 0 0 1 0-3z" />,
  },
  {
    to: 'learn',
    label: 'Learn',
    match: ['learn', 'educate'],
    icon: <path d="M1.5 6 8 3l6.5 3L8 9zM4.5 7.6V11c1 .9 2.2 1.4 3.5 1.4s2.5-.5 3.5-1.4V7.6M14.5 6v4" />,
  },
  {
    to: 'try',
    label: 'Try',
    match: ['try'],
    icon: <path d="M5 3v10l8-5z" />,
  },
]

// The review list is a working tool for the local dev server; the production build leaves it out.
const REVIEW: Section | null = import.meta.env.DEV
  ? { to: 'review', label: 'Review', match: ['review'], icon: <path d="M2.5 4 4 5.5 6.5 3M2.5 10 4 11.5 6.5 9M9 4.5h4.5M9 10.5h4.5" /> }
  : null

/** Picks the date the rules are shown for. Sits inside a popover; "Back to today" closes it. */
function AsOfField() {
  const vc = useViewCtx()
  const setDate = (d: string) => setParams({ asOf: d && d !== today() ? d : null })
  return (
    <>
      <label className="lens-label" style={{ display: 'grid', gap: 6 }}>
        Show the rules as of
        <input className="field-input" type="date" value={vc.asOf} onChange={(e) => setDate(e.target.value)} />
      </label>
      {vc.asOf !== today() && (
        <Popover.Close className="btn" style={{ marginTop: 10, width: '100%' }} onClick={() => setDate('')}>
          Back to today
        </Popover.Close>
      )}
    </>
  )
}

function asOfLabel(asOf: string) {
  return asOf === today() ? `Showing the rules in force today (${formatDate(asOf)})` : `Showing the rules in force on ${formatDate(asOf)}`
}

/** The date the rules are shown for. Today unless a link or the picker says otherwise; a set date marks the button. */
function AsOfButton() {
  const vc = useViewCtx()
  const label = asOfLabel(vc.asOf)
  return (
    <Popover.Root>
      <Popover.Trigger className="icon-btn" data-set={vc.asOf !== today()} title={label} aria-label={`${label}. Change the date`}>
        {icon(
          <>
            <rect x="2" y="3" width="12" height="11" rx="1.5" />
            <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
          </>,
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="end" sideOffset={6}>
          <AsOfField />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function TopBar() {
  const { path } = useRoute()
  const theme = useTheme()
  const section = path[0] ?? ''
  const nav = REVIEW ? [...SECTIONS.slice(0, 2), REVIEW, ...SECTIONS.slice(2)] : SECTIONS
  return (
    <header className="topbar">
      <a className="brand" href={href([])}>
        <span className="brand-mark" aria-hidden="true">
          <span style={{ background: 'var(--l-golive)' }} />
          <span style={{ background: 'var(--l-cir)' }} />
          <span style={{ background: 'var(--l-etsi)' }} />
          <span style={{ background: 'var(--l-base)' }} />
        </span>
        <span className="brand-name">specs-navigator</span>
      </a>
      <nav className="nav" aria-label="Sections">
        {nav.map((s) => (
          <a key={s.to} href={href([s.to])} aria-current={s.match.includes(section) ? 'page' : undefined}>
            {s.label}
          </a>
        ))}
      </nav>
      <span className="spacer" />
      {/* On phones only the search stays up here; the rest moves to the tab bar's More sheet. */}
      <div className="icon-group" role="group" aria-label="Search, date, change feed and theme">
        <Search />
        <AsOfButton />
        <a className="icon-btn" href={href(['rss'])} aria-current={section === 'rss' ? 'page' : undefined} title="Change feed" aria-label="Change feed (RSS)">
          {icon(RSS_ICON)}
        </a>
        <button className="icon-btn" onClick={nextTheme} title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
    </header>
  )
}

/** Phones only: the sections as a bottom tab bar, with the date, change feed, theme and review under More. */
export function TabBar() {
  const { path } = useRoute()
  const vc = useViewCtx()
  const theme = useTheme()
  const section = path[0] ?? ''
  const dateSet = vc.asOf !== today()
  const inMore = section === 'rss' || (REVIEW?.match.includes(section) ?? false)
  const sheetRef = useRef<HTMLDivElement>(null)
  return (
    <nav className="tabbar" aria-label="Sections">
      {SECTIONS.map((s) => (
        <a key={s.to} href={href([s.to])} aria-current={s.match.includes(section) ? 'page' : undefined}>
          <span className="tab-icon">{icon(s.icon, 20)}</span>
          {s.label}
        </a>
      ))}
      <Popover.Root>
        <Popover.Trigger data-set={dateSet} aria-current={inMore ? 'page' : undefined} aria-label={dateSet ? `More. ${asOfLabel(vc.asOf)}` : 'More'}>
          <span className="tab-icon">
            {icon(
              <>
                <circle cx="3.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
                <circle cx="8" cy="8" r="1.2" fill="currentColor" stroke="none" />
                <circle cx="12.5" cy="8" r="1.2" fill="currentColor" stroke="none" />
              </>,
              20,
            )}
          </span>
          More
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            ref={sheetRef}
            className="popover more-sheet"
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={12}
            // Focus the sheet, not its first field: a focused date field opens the phone's date picker.
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              sheetRef.current?.focus()
            }}
          >
            <AsOfField />
            <div className="more-list">
              <Popover.Close asChild>
                <a href={href(['rss'])} aria-current={section === 'rss' ? 'page' : undefined}>
                  {icon(RSS_ICON, 16)}
                  Change feed
                </a>
              </Popover.Close>
              <button onClick={nextTheme}>
                <span className="more-glyph" aria-hidden="true">
                  {theme === 'dark' ? '☀' : '☾'}
                </span>
                {theme === 'dark' ? 'Light theme' : 'Dark theme'}
              </button>
              {REVIEW && (
                <Popover.Close asChild>
                  <a href={href([REVIEW.to])} aria-current={REVIEW.match.includes(section) ? 'page' : undefined}>
                    {icon(REVIEW.icon, 16)}
                    {REVIEW.label}
                  </a>
                </Popover.Close>
              )}
            </div>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </nav>
  )
}

/** The view context: which side and which layers the rules are shown for. */
export function LensBar() {
  const { path } = useRoute()
  const vc = useViewCtx()
  // A flow belongs to one side; switching sides from a flow goes back to the flow selection of the other side.
  const pickSide = (v: 'issuer' | 'verifier') => {
    const role = v === 'verifier' ? null : v
    if (path[0] === 'flow' && v !== vc.view) navigate(href([], { role }))
    else setParams({ role })
  }
  const hint =
    vc.stage < LENS_STAGES.length - 1
      ? `Showing the rules up to ${LENS_STAGES[vc.stage]!.label.replace('+ ', '')}. Δ marks what this step changed.`
      : 'All layers on. Step back to see who overruled what.'
  return (
    <div className="lensbar">
      <div className="segmented" role="group" aria-label="Side of the ecosystem">
        {(['verifier', 'issuer'] as const).map((v) => (
          <button key={v} aria-pressed={vc.view === v} onClick={() => pickSide(v)}>
            {v === 'issuer' ? 'Issuer' : 'Verifier'}
          </button>
        ))}
      </div>
      <div className="ctx-group">
        <div className="lens" role="group" aria-label="Layer lens">
          {LENS_STAGES.map((s, i) => (
            <button
              key={s.id}
              style={cssLayer(s.id)}
              data-on={i <= vc.stage}
              data-current={i === vc.stage}
              aria-pressed={i <= vc.stage}
              onClick={() => setParams({ lens: i === LENS_STAGES.length - 1 ? null : s.id })}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <span className="lens-hint" title={hint}>
        {hint}
      </span>
    </div>
  )
}

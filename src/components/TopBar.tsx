import * as Popover from '@radix-ui/react-popover'
import { useEffect, useState } from 'react'
import { href, navigate, setParams, useRoute } from '../lib/router'
import { LENS_STAGES, today, useViewCtx } from '../lib/store'
import { cssLayer, formatDate } from './bits'
import { Search } from './Search'

const THEME_KEY = 'specs-navigator.theme'

function useTheme(): [string, () => void] {
  // Dark is the default; light is opt-in and remembered.
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
    } catch {
      return 'dark'
    }
  })
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      /* private mode: theme just isn't remembered */
    }
  }, [theme])
  const next = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  return [theme, next]
}

/** The date the rules are shown for. Today unless a link or the picker says otherwise; a set date marks the button. */
function AsOfButton() {
  const vc = useViewCtx()
  const isToday = vc.asOf === today()
  const label = isToday ? `Showing the rules in force today (${formatDate(vc.asOf)})` : `Showing the rules in force on ${formatDate(vc.asOf)}`
  const setDate = (d: string) => setParams({ asOf: d && d !== today() ? d : null })
  return (
    <Popover.Root>
      <Popover.Trigger className="icon-btn" data-set={!isToday} title={label} aria-label={`${label}. Change the date`}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <rect x="2" y="3" width="12" height="11" rx="1.5" />
          <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover" align="end" sideOffset={6}>
          <label className="lens-label" style={{ display: 'grid', gap: 6 }}>
            Show the rules as of
            <input className="field-input" type="date" value={vc.asOf} onChange={(e) => setDate(e.target.value)} />
          </label>
          {!isToday && (
            <Popover.Close className="btn" style={{ marginTop: 10, width: '100%' }} onClick={() => setDate('')}>
              Back to today
            </Popover.Close>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function TopBar() {
  const { path } = useRoute()
  const [theme, nextTheme] = useTheme()
  const section = path[0] ?? ''
  const navItem = (to: string, label: string, match: string[]) => (
    <a href={href([to])} aria-current={match.includes(section) ? 'page' : undefined}>
      {label}
    </a>
  )
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
        {navItem('', 'Flows', ['', 'flow', 'object', 'endpoints'])}
        {navItem('spec', 'Specs', ['spec'])}
        {/* The review list is a working tool for the local dev server; the production build leaves it out. */}
        {import.meta.env.DEV && navItem('review', 'Review', ['review'])}
        {navItem('wallets', 'Wallets', ['wallets', 'state', 'compare'])}
        {navItem('educate', 'Educate', ['educate'])}
      </nav>
      <span className="spacer" />
      <Search />
      <AsOfButton />
      <a className="icon-btn" href={href(['rss'])} aria-current={section === 'rss' ? 'page' : undefined} title="Change feed" aria-label="Change feed (RSS)">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="M3 7.5a5.5 5.5 0 0 1 5.5 5.5M3 3a10 10 0 0 1 10 10" />
          <circle cx="3.5" cy="12.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      </a>
      <button className="icon-btn" onClick={nextTheme} title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </header>
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
        <span className="lens-label" id="lens-label">
          Layer lens
        </span>
        <div className="lens" role="group" aria-labelledby="lens-label">
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

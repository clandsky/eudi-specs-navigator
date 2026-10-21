import { useEffect, useState } from 'react'
import { href, navigate, setParams, useRoute } from '../lib/router'
import { LENS_STAGES, today, useViewCtx } from '../lib/store'
import { cssLayer } from './bits'
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

export function TopBar() {
  const { path } = useRoute()
  const vc = useViewCtx()
  const [theme, nextTheme] = useTheme()
  const section = path[0] ?? ''
  // A flow belongs to one side; switching sides from a flow goes back to the flow selection of the other side.
  const pickSide = (v: 'issuer' | 'verifier') => {
    const role = v === 'verifier' ? null : v
    if (section === 'flow' && v !== vc.view) navigate(href([], { role }))
    else setParams({ role })
  }
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
        specs-navigator
      </a>
      <div className="segmented" role="group" aria-label="Side of the ecosystem">
        {(['verifier', 'issuer'] as const).map((v) => (
          <button key={v} aria-pressed={vc.view === v} onClick={() => pickSide(v)}>
            {v === 'issuer' ? 'Issuer' : 'Verifier'}
          </button>
        ))}
      </div>
      <nav className="nav" aria-label="Sections">
        {navItem('', 'Flows', ['', 'flow', 'object'])}
        {navItem('endpoints', 'Endpoints', ['endpoints'])}
        {navItem('spec', 'Specs', ['spec'])}
        {navItem('review', 'Review', ['review'])}
        {navItem('state', 'd-you state', ['state'])}
        {navItem('compare', 'Compare wallets', ['compare'])}
        {navItem('educate', 'Educate', ['educate'])}
        {navItem('rss', 'RSS', ['rss'])}
      </nav>
      <span className="spacer" />
      <Search />
      <label className="meta" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        As of
        <input
          className="field-input"
          type="date"
          value={vc.asOf}
          onChange={(e) => setParams({ asOf: e.target.value && e.target.value !== today() ? e.target.value : null })}
        />
      </label>
      <button className="icon-btn" onClick={nextTheme} title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'} aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}>
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </header>
  )
}

export function LensBar() {
  const vc = useViewCtx()
  return (
    <div className="lensbar">
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
      <span className="lens-hint">
        {vc.stage < LENS_STAGES.length - 1
          ? `Showing the rules up to ${LENS_STAGES[vc.stage]!.label.replace('+ ', '')}. Δ marks what this step changed.`
          : 'All layers on. Step back to see who overruled what.'}
      </span>
    </div>
  )
}

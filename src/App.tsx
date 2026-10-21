import { LensBar, TabBar, TopBar } from './components/TopBar'
import { useKeepScrollOnReload, useRoute, useScrollTopOnPath } from './lib/router'
import { EducateView } from './views/EducateView'
import { FlowView } from './views/FlowView'
import { HomeView } from './views/HomeView'
import { AdaptationsPage, AssertionPage, ObjectPage, ReviewPage, SpecPage, SpecsIndex, SubjectPage, WalletsView } from './views/Pages'

function Content() {
  const { path } = useRoute()
  useScrollTopOnPath(path)
  const [section, id, sub] = path
  switch (section) {
    case undefined:
      return <HomeView />
    case 'flow':
      return id ? <FlowView flowId={id} /> : <HomeView />
    case 'object':
      return <ObjectPage exampleId={id ?? ''} />
    case 'subject':
      return <SubjectPage subjectId={id ?? ''} />
    case 'assertion':
      return <AssertionPage assertionId={path.slice(1).join('/')} />
    case 'spec':
      if (!id) return <SpecsIndex />
      return sub === 'adaptations' ? <AdaptationsPage /> : <SpecPage specId={id} />
    case 'review':
      // A working tool for the local dev server; the production build leaves it out.
      return import.meta.env.DEV ? <ReviewPage /> : <NotFound />
    case 'endpoints':
      return <HomeView focus="endpoints" />
    case 'educate':
      return <EducateView />
    case 'wallets':
      return <WalletsView tab={id} />
    // Former addresses of the two wallet tabs, kept so old links still work.
    case 'state':
      return <WalletsView tab="d-you" />
    case 'compare':
      return <WalletsView tab="compare" />
    // Placeholder: an RSS feed of changes. No content or logic yet.
    case 'rss':
      return (
        <div className="page">
          <h1>RSS</h1>
        </div>
      )
    default:
      return <NotFound />
  }
}

function NotFound() {
  return (
    <div className="page">
      <h1>Nothing at this address</h1>
      <p className="lede">
        <a href="#/">Go to the flows</a>.
      </p>
    </div>
  )
}

export function App() {
  useKeepScrollOnReload()
  return (
    <div className="shell">
      <div className="proto-banner" role="note">
        <strong>Technical prototype.</strong>{' '}
        <span className="banner-long">
          The project is in its technical prototyping phase: the content is not yet fully quality assured and is under
          review. It is not a source of truth; check every rule against the cited specification.
        </span>
        <span className="banner-short">Not a source of truth.</span>
      </div>
      <TopBar />
      <LensBar />
      <main className="main">
        <Content />
      </main>
      <TabBar />
    </div>
  )
}

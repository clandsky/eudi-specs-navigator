import { LensBar, TopBar } from './components/TopBar'
import { useRoute, useScrollTopOnPath } from './lib/router'
import { EducateView } from './views/EducateView'
import { FlowView } from './views/FlowView'
import { HomeView } from './views/HomeView'
import { AdaptationsPage, AssertionPage, EndpointsPage, ObjectPage, ReviewPage, SpecPage, SpecsIndex, SubjectPage } from './views/Pages'

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
      return <ReviewPage />
    case 'endpoints':
      return <EndpointsPage />
    case 'educate':
      return <EducateView />
    // Placeholders: comparing national wallet solutions, and an RSS feed of changes. No content or logic yet.
    case 'compare':
      return (
        <div className="page">
          <h1>Compare wallets</h1>
        </div>
      )
    case 'rss':
      return (
        <div className="page">
          <h1>RSS</h1>
        </div>
      )
    default:
      return (
        <div className="page">
          <h1>Nothing at this address</h1>
          <p className="lede">
            <a href="#/">Go to the flows</a>.
          </p>
        </div>
      )
  }
}

export function App() {
  return (
    <div className="shell">
      <div className="proto-banner" role="note">
        <strong>Technical prototype.</strong> The project is in its technical prototyping phase: the content is not yet
        fully quality assured and is under review. It is not a source of truth; check every rule against the cited
        specification.
      </div>
      <TopBar />
      <LensBar />
      <main className="main">
        <Content />
      </main>
    </div>
  )
}

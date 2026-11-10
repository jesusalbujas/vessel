export function PageLoadingSkeleton({ label = "Loading" }: { label?: string }) {
  return <div className="page-loading-skeleton" role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div className="skeleton-block page-loading-title" />
    <div className="skeleton-block page-loading-subtitle" />
    <div className="skeleton-block page-loading-panel" />
    <div className="page-loading-grid"><div className="skeleton-block" /><div className="skeleton-block" /></div>
  </div>;
}

export function ContentLoadingSkeleton({ rows = 5, label = "Loading" }: { rows?: number; label?: string }) {
  return <div className="content-loading-skeleton" role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <span className="skeleton-block" key={index} />)}
  </div>;
}

type ResourceSkeletonVariant = "images" | "volumes" | "networks";

export function ResourceListLoadingSkeleton({ variant, label = "Loading Docker resources" }: { variant: ResourceSkeletonVariant; label?: string }) {
  const columns = variant === "networks" ? 8 : 7;
  return <div className={`resource-loading-skeleton resource-loading-${variant}`} role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    <div className="resource-loading-toolbar"><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /></div>
    {variant === "images" ? <>
      <div className="resource-loading-image-actions"><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /></div>
      <div className="resource-loading-image-list">{Array.from({ length: 7 }, (_, index) => <div className="resource-loading-image-row" key={index}>
        <i className="skeleton-block" /><i className="skeleton-block" /><span><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /></span><i className="skeleton-block" /><i className="skeleton-block" />
      </div>)}</div>
    </> : <div className="resource-loading-table-wrap"><div className="resource-loading-table">
      <div className="resource-loading-table-head">{Array.from({ length: columns }, (_, index) => <i className="skeleton-block" key={index} />)}</div>
      {Array.from({ length: 8 }, (_, row) => <div className="resource-loading-table-row" key={row}>{Array.from({ length: columns }, (_, column) => <i className="skeleton-block" key={column} />)}</div>)}
    </div></div>}
  </div>;
}

export function ContainerListLoadingSkeleton({ layout, label = "Loading containers" }: { layout: "cards" | "table"; label?: string }) {
  return <div className={`container-loading-skeleton container-loading-${layout}`} role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    {layout === "cards" ? Array.from({ length: 4 }, (_, index) => <article className="container-loading-card" key={index}>
      <header><i className="skeleton-block" /><span><i className="skeleton-block" /><i className="skeleton-block" /></span><i className="skeleton-block" /></header>
      <div><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /></div>
      <footer><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /></footer>
    </article>) : <div className="container-loading-table">
      <header>{Array.from({ length: 7 }, (_, index) => <i className="skeleton-block" key={index} />)}</header>
      {Array.from({ length: 7 }, (_, row) => <div key={row}>{Array.from({ length: 7 }, (_, column) => <i className="skeleton-block" key={column} />)}</div>)}
    </div>}
  </div>;
}

export function ComposeProjectsLoadingSkeleton({ label = "Loading Compose projects" }: { label?: string }) {
  return <div className="compose-projects-loading" role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    {Array.from({ length: 4 }, (_, index) => <div className="compose-project-loading-card" key={index}>
      <i className="skeleton-block" /><span><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /></span><i className="skeleton-block" />
    </div>)}
  </div>;
}

export function CodeLoadingSkeleton() {
  return <div className="code-loading-skeleton" role="status" aria-label="Loading code">
    <span className="sr-only">Loading code</span>
    {[88, 66, 94, 52, 76, 42].map((width, index) => <span className="skeleton-block" style={{ width: `${width}%` }} key={index} />)}
  </div>;
}

type OverviewSkeletonVariant = "status" | "usage" | "resources" | "projects" | "compose";

export function OverviewLoadingSkeleton({ variant, label = "Loading dashboard data" }: { variant: OverviewSkeletonVariant; label?: string }) {
  const count = variant === "resources" ? 6 : 4;
  return <div className={`overview-loading overview-loading-${variant}`} role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    {variant === "status" ? <>
      <div className="overview-loading-status-head"><i className="skeleton-block" /><span><i className="skeleton-block" /><i className="skeleton-block" /></span><i className="skeleton-block" /></div>
      <div className="overview-loading-status-body"><i className="skeleton-block" /><span>{Array.from({ length: 3 }, (_, index) => <i className="skeleton-block" key={index} />)}</span></div>
      <div className="overview-loading-engine-grid">{Array.from({ length: 6 }, (_, index) => <span key={index}><i className="skeleton-block" /><i className="skeleton-block" /></span>)}</div>
    </> : null}
    {variant === "usage" ? Array.from({ length: 3 }, (_, index) => <div className="overview-loading-usage-card" key={index}>
      <i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" />
    </div>) : null}
    {variant === "resources" ? Array.from({ length: count }, (_, index) => <span className="overview-loading-resource" key={index}><i className="skeleton-block" /><i className="skeleton-block" /><i className="skeleton-block" /></span>) : null}
    {variant === "projects" || variant === "compose" ? Array.from({ length: count }, (_, index) => <span className="overview-loading-project" key={index}><i className="skeleton-block" /><span><i className="skeleton-block" /><i className="skeleton-block" /></span></span>) : null}
  </div>;
}

export function DeploymentFormLoadingSkeleton({ label = "Loading deployment configuration" }: { label?: string }) {
  return <div className="deployment-form-loading" role="status" aria-label={label} aria-busy="true">
    <span className="sr-only">{label}</span>
    {[0, 1, 2].map((section) => <section className="deployment-form-loading-section" key={section}>
      <span className="deployment-form-loading-heading"><i className="skeleton-block" /><span><i className="skeleton-block" /><i className="skeleton-block" /></span></span>
      <span className="deployment-form-loading-fields"><i className="skeleton-block" /><i className="skeleton-block" /></span>
      {section === 0 ? <i className="skeleton-block deployment-form-loading-wide" /> : null}
      {section === 2 ? <><i className="skeleton-block deployment-form-loading-wide" /><i className="skeleton-block deployment-form-loading-toggle" /></> : null}
    </section>)}
    <footer><i className="skeleton-block" /><i className="skeleton-block" /></footer>
  </div>;
}

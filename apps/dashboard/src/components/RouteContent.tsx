import { Component, createRef, Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

interface RouteLoadBoundaryProps { children: ReactNode; reloadHref: string; }
class RouteLoadBoundary extends Component<RouteLoadBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  private heading = createRef<HTMLHeadingElement>();
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.heading.current?.focus(); }
  render() {
    if (this.state.failed) return <section role="alert" className="tocyn-route-error">
      <h1 ref={this.heading} tabIndex={-1} className="tocyn-route-error-title">This page could not be loaded</h1>
      <p>Your sign-in has not been changed. Reload the page to try again.</p>
      <a href={this.props.reloadHref} className="tocyn-route-error-link">Reload this page</a>
    </section>;
    return this.props.children;
  }
}

/** A failed lazy module is retried by a document reload, not by reusing React's cached rejection. */
export function RouteContent({ children, persistent = false }: { children: ReactNode; persistent?: boolean }) {
  const location = useLocation();
  return <RouteLoadBoundary key={persistent ? 'workspace' : location.pathname} reloadHref={location.pathname + location.search}>
    <Suspense fallback={<RouteSkeleton />}>{children}</Suspense>
  </RouteLoadBoundary>;
}

function RouteSkeleton() {
  return <section className="tocyn-route-skeleton" role="status" aria-label="Loading page">
    <span className="tocyn-route-skeleton-bar tocyn-route-skeleton-title" />
    <span className="tocyn-route-skeleton-bar" />
    <span className="tocyn-route-skeleton-bar tocyn-route-skeleton-wide" />
    <span className="tocyn-route-skeleton-bar" />
    <span className="sr-only">Loading page</span>
  </section>;
}

import { p } from '../portalStyles';
import { Component, createRef, Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ParkEmptyState } from '@luminatick/ui/park';

interface RouteLoadBoundaryProps { children: ReactNode; reloadHref: string; }
class RouteLoadBoundary extends Component<RouteLoadBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  private heading = createRef<HTMLHeadingElement>();
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.heading.current?.focus(); }
  render() {
    if (this.state.failed) return <section role="alert" className={p.routeError}>
      <h1 ref={this.heading} tabIndex={-1} className={p.routeErrorTitle}>This page could not be loaded</h1>
      <p>Your sign-in has not been changed. Reload the page to try again.</p>
      <a href={this.props.reloadHref} className={p.routeReload}>Reload this page</a>
    </section>;
    return this.props.children;
  }
}

/** A failed lazy module is retried by a document reload, not by reusing React's cached rejection. */
export function RouteContent({ children }: { children: ReactNode }) {
  const location = useLocation();
  return <RouteLoadBoundary key={location.pathname} reloadHref={location.pathname + location.search}>
    <Suspense fallback={<ParkEmptyState role="status" title="Loading page…" headingLevel={false} aria-busy="true" className={p.routeLoading} />}>{children}</Suspense>
  </RouteLoadBoundary>;
}

import { p } from '../portalStyles';
import { Component, createRef, Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ParkSkeleton } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';

const loadingShape = css({ display: 'grid', gap: '3', maxW: '3xl' });
const loadingLabel = css({ color: 'text.muted', fontSize: 'sm', mb: '4' });

export function PortalLoadingSkeleton({ label, className }: { label: string; className?: string }) {
  return <section role="status" aria-label={label} aria-live="polite" aria-busy="true" className={className ?? p.routeLoading}>
    <p className={loadingLabel}>{label}</p>
    <div aria-hidden="true" className={loadingShape}>
      <ParkSkeleton height="8" width="45%" />
      <ParkSkeleton height="12" width="full" />
      <ParkSkeleton height="12" width="full" />
    </div>
  </section>;
}

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
    <Suspense fallback={<PortalLoadingSkeleton label="Loading page…" />}>{children}</Suspense>
  </RouteLoadBoundary>;
}

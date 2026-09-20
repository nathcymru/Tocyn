import { Component, createRef, Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ParkAlert, ParkButton, ParkSkeleton, ParkVisuallyHidden } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';

const styles = {
  skeleton: css({ display: 'grid', gap: '0.75rem', width: 'full', maxWidth: '48rem', padding: '1.5rem', background: 'bg.surface', borderRadius: 'l2' }),
};

interface RouteLoadBoundaryProps { children: ReactNode; reloadHref: string; }
class RouteLoadBoundary extends Component<RouteLoadBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  private heading = createRef<HTMLHeadingElement>();
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.heading.current?.focus(); }
  render() {
    if (this.state.failed) return <ParkAlert.Root role="alert" status="error" variant="surface" className={css({ maxW: '42rem' })}>
      <ParkAlert.Content>
        <ParkAlert.Title asChild><h1 ref={this.heading} tabIndex={-1}>This page could not be loaded</h1></ParkAlert.Title>
        <ParkAlert.Description>Your sign-in has not been changed. Reload the page to try again.</ParkAlert.Description>
        <ParkButton asChild variant="solid"><a href={this.props.reloadHref}>Reload this page</a></ParkButton>
      </ParkAlert.Content>
    </ParkAlert.Root>;
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
  return <section className={styles.skeleton} role="status" aria-label="Loading page" aria-busy="true">
    <ParkSkeleton height="8" width="50%" />
    <ParkSkeleton height="4" width="80%" />
    <ParkSkeleton height="4" width="100%" />
    <ParkSkeleton height="4" width="70%" />
    <ParkVisuallyHidden>Loading page</ParkVisuallyHidden>
  </section>;
}

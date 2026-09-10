import { Component, createRef, Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

interface RouteLoadBoundaryProps { children: ReactNode; reloadHref: string; }
class RouteLoadBoundary extends Component<RouteLoadBoundaryProps, { failed: boolean }> {
  state = { failed: false };
  private heading = createRef<HTMLHeadingElement>();
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.heading.current?.focus(); }
  render() {
    if (this.state.failed) return <section role="alert" className="p-6 space-y-3">
      <h1 ref={this.heading} tabIndex={-1} className="text-lg font-semibold">This page could not be loaded</h1>
      <p>Your sign-in has not been changed. Reload the page to try again.</p>
      <a href={this.props.reloadHref} className="inline-flex min-h-11 items-center px-3 py-2 underline focus-visible:outline focus-visible:outline-2">Reload this page</a>
    </section>;
    return this.props.children;
  }
}

/** A failed lazy module is retried by a document reload, not by reusing React's cached rejection. */
export function RouteContent({ children, persistent = false }: { children: ReactNode; persistent?: boolean }) {
  const location = useLocation();
  return <RouteLoadBoundary key={persistent ? 'workspace' : location.pathname} reloadHref={location.pathname + location.search}>
    <Suspense fallback={<p role="status" className="p-6">Loading page…</p>}>{children}</Suspense>
  </RouteLoadBoundary>;
}

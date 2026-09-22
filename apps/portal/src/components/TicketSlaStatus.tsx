import { p } from '../portalStyles';
import { useCallback, useEffect, useState } from 'react';
import { portalApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { SlaTargetProjection, TicketSlaProjection } from '../types';
import { ParkButton, ParkCard, ParkEmptyState, ParkSkeleton, ParkVisuallyHidden } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';

type ReadState = Readonly<{
  status: 'loading' | 'ready' | 'failed';
  projection: TicketSlaProjection | null;
}>;

const REFRESH_INTERVAL_MS = 30_000;

function isTargetProjection(value: unknown): value is SlaTargetProjection {
  if (!value || typeof value !== 'object') return false;
  const target = value as Record<string, unknown>;
  return ['unavailable', 'on-track', 'breached'].includes(String(target.state))
    && ['unavailable', 'running', 'paused', 'completed'].includes(String(target.phase))
    && (target.completedAt === null || typeof target.completedAt === 'string')
    && (target.dueAt === null || typeof target.dueAt === 'string')
    && (target.remainingWorkingMilliseconds === null || typeof target.remainingWorkingMilliseconds === 'number')
    && (target.targetWorkingMilliseconds === null || typeof target.targetWorkingMilliseconds === 'number');
}

function isTicketSlaProjection(value: unknown): value is TicketSlaProjection {
  if (!value || typeof value !== 'object') return false;
  const projection = value as Record<string, unknown>;
  return (projection.handlerName === null || typeof projection.handlerName === 'string')
    && isTargetProjection(projection.response)
    && isTargetProjection(projection.resolution);
}

function targetLabel(target: SlaTargetProjection) {
  if (target.phase === 'unavailable' || target.state === 'unavailable') return 'Unavailable';
  if (target.phase === 'paused') return target.state === 'breached' ? 'Paused — target exceeded' : 'Paused';
  if (target.phase === 'completed') return target.state === 'breached' ? 'Completed — target exceeded' : 'Completed — on target';
  return target.state === 'breached' ? 'Running — target exceeded' : 'Running — on target';
}

function dueLabel(target: SlaTargetProjection) {
  if (!target.dueAt || target.phase === 'paused' || target.phase === 'unavailable') return null;
  const dueAt = new Date(target.dueAt);
  if (!Number.isFinite(dueAt.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(dueAt);
}

function Target({ name, target }: { name: string; target: SlaTargetProjection }) {
  const due = dueLabel(target);
  return <li className={p.slaTarget}>
    <p className={p.slaTargetName}>{name}</p>
    <p className={p.slaTargetStatus}>{targetLabel(target)}</p>
    {due && <p className={p.slaTargetDue}>Due {due}</p>}
  </li>;
}

/** Customer-only SLA presentation; all identity and lifecycle facts remain server-filtered. */
export function TicketSlaStatus({ ticketId }: { ticketId: string }) {
  const authGeneration = useAuthStore(state => state.authGeneration);
  const [read, setRead] = useState<ReadState>({ status: 'loading', projection: null });
  const [retryGeneration, setRetryGeneration] = useState(0);

  useEffect(() => {
    let active = true;
    let latestRequest = 0;

    const load = async (showLoading: boolean) => {
      const request = ++latestRequest;
      if (showLoading) setRead({ status: 'loading', projection: null });
      try {
        const projection = await portalApi.getTicketSla<unknown>(ticketId);
        if (!isTicketSlaProjection(projection)) throw new Error('Invalid customer SLA projection');
        if (!active || request !== latestRequest || useAuthStore.getState().authGeneration !== authGeneration) return;
        setRead({ status: 'ready', projection });
      } catch {
        if (!active || request !== latestRequest || useAuthStore.getState().authGeneration !== authGeneration) return;
        setRead(current => ({ status: 'failed', projection: current.projection }));
      }
    };

    void load(true);
    const refresh = window.setInterval(() => { void load(false); }, REFRESH_INTERVAL_MS);
    return () => { active = false; window.clearInterval(refresh); };
  }, [ticketId, authGeneration, retryGeneration]);

  const retry = useCallback(() => { setRetryGeneration(current => current + 1); }, []);

  if (read.status === 'loading' && !read.projection) {
    return <ParkCard.Root asChild variant="outline" className={p.slaCardInset}><section aria-labelledby="ticket-sla-heading">
      <h2 id="ticket-sla-heading" className={p.slaHeading}>Service status</h2>
      <div role="status" aria-label="Loading service status" aria-busy="true" className={[p.slaState, css({ display: 'grid', gap: '2' })].join(' ')}>
        <ParkVisuallyHidden>Loading service status…</ParkVisuallyHidden>
        <ParkSkeleton aria-hidden="true" height="4" width="70%" />
        <ParkSkeleton aria-hidden="true" height="4" width="90%" />
      </div>
    </section></ParkCard.Root>;
  }

  if (read.status === 'failed' || !read.projection) {
    return <ParkCard.Root asChild variant="outline" className={p.slaCardInset}><section aria-labelledby="ticket-sla-heading">
      <h2 id="ticket-sla-heading" className={p.slaHeading}>Service status</h2>
      <ParkEmptyState role="status" aria-live="polite" headingLevel={false} title="Service status is unavailable. Try again." className={p.slaState} action={<ParkButton type="button" onClick={retry}>Retry service status</ParkButton>} />
    </section></ParkCard.Root>;
  }

  return <ParkCard.Root asChild variant="outline" className={p.slaCardInset}><section aria-labelledby="ticket-sla-heading">
    <h2 id="ticket-sla-heading" className={p.slaHeading}>Service status</h2>
    <p className={p.slaStatus}>Responsible handler: {read.projection.handlerName ?? 'Unavailable'}</p>
    <ul className={p.slaTargets} aria-label="Service targets">
      <Target name="Response target" target={read.projection.response} />
      <Target name="Resolution target" target={read.projection.resolution} />
    </ul>
  </section></ParkCard.Root>;
}

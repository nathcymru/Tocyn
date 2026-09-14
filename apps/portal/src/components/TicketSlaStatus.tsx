import { useCallback, useEffect, useState } from 'react';
import { portalApi } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { SlaTargetProjection, TicketSlaProjection } from '../types';
import { ParkButton } from '@luminatick/ui/park';

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
  return <li className="tocyn-portal-sla-target">
    <p className="tocyn-portal-sla-target-name">{name}</p>
    <p className="tocyn-portal-sla-target-status">{targetLabel(target)}</p>
    {due && <p className="tocyn-portal-sla-target-due">Due {due}</p>}
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
    return <section aria-labelledby="ticket-sla-heading" className="tocyn-portal-sla-card">
      <h2 id="ticket-sla-heading" className="tocyn-portal-sla-heading">Service status</h2>
      <p role="status" className="tocyn-portal-sla-status">Loading service status…</p>
    </section>;
  }

  if (read.status === 'failed' || !read.projection) {
    return <section aria-labelledby="ticket-sla-heading" className="tocyn-portal-sla-card">
      <h2 id="ticket-sla-heading" className="tocyn-portal-sla-heading">Service status</h2>
      <p role="status" aria-live="polite" className="tocyn-portal-sla-status">Service status is unavailable. Try again.</p>
      <ParkButton type="button" onClick={retry} className="tocyn-portal-sla-retry">Retry service status</ParkButton>
    </section>;
  }

  return <section aria-labelledby="ticket-sla-heading" className="tocyn-portal-sla-card">
    <h2 id="ticket-sla-heading" className="tocyn-portal-sla-heading">Service status</h2>
    <p className="tocyn-portal-sla-status">Responsible handler: {read.projection.handlerName ?? 'Unavailable'}</p>
    <ul className="tocyn-portal-sla-targets" aria-label="Service targets">
      <Target name="Response target" target={read.projection.response} />
      <Target name="Resolution target" target={read.projection.resolution} />
    </ul>
  </section>;
}

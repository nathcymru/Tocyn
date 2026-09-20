import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ParkAlert, ParkButton, ParkCard, ParkEmptyState, ParkPage, ParkProgress, ParkSkeleton } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { useStats } from '../hooks/useStats';
import { IconChartBar, IconUsers, IconTicket, IconCircleCheck, IconClock, IconCircleExclamation } from '@luminatick/ui/icons';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: stats, isLoading, isError, isFetching, refetch } = useStats();
  const page = ParkPage('dashboard');
  const header = <header className={page.header}>
    <div className={page.dashboardHeading}>
      <h1>Dashboard</h1>
      <p>A quick overview of the support workload.</p>
    </div>
    <ParkButton type="button" variant="solid" className={page.dashboardAction} onClick={() => navigate('/inbox')}>Open Inbox</ParkButton>
  </header>;

  if (isLoading && !stats) return <div className={[page.root, page.content].join(' ')}>
    {header}
    <div role="status" aria-label="Loading dashboard metrics" aria-busy="true">
      <div className={page.metricStrip}>{Array.from({ length: 4 }, (_, index) => <ParkCard.Root key={index} variant="outline" className={page.metricCard}>
        <ParkCard.Body><ParkSkeleton height="4" width="60%" /><ParkSkeleton height="8" width="35%" /></ParkCard.Body>
      </ParkCard.Root>)}</div>
      <div className={page.panels}>{Array.from({ length: 2 }, (_, index) => <ParkCard.Root key={index} variant="outline">
        <ParkCard.Body><ParkSkeleton height="4" width="45%" /><ParkSkeleton height="8" width="full" /><ParkSkeleton height="8" width="full" /></ParkCard.Body>
      </ParkCard.Root>)}</div>
    </div>
  </div>;

  if (!stats) return <div className={[page.root, page.content].join(' ')}>
    {header}
    <ParkEmptyState role="alert" title="Dashboard metrics unavailable" description="The support workload could not be loaded."
      action={<ParkButton type="button" disabled={isFetching} onClick={() => void refetch()}>Retry dashboard metrics</ParkButton>} />
  </div>;

  const getStatusCount = (status: string) =>
    stats.ticketsByStatus.find(s => s.status === status)?.count || 0;

  const totalTickets = stats.ticketsByStatus.reduce((acc, curr) => acc + curr.count, 0);

  const cards = [
    {
      label: 'Total Tickets',
      value: totalTickets,
      icon: IconTicket,
      tone: 'blue',
    },
    {
      label: 'Open Tickets',
      value: getStatusCount('open'),
      icon: IconCircleExclamation,
      tone: 'green',
    },
    {
      label: 'Pending Tickets',
      value: getStatusCount('pending'),
      icon: IconClock,
      tone: 'amber',
    },
    {
      label: 'Resolved Tickets',
      value: getStatusCount('resolved') + getStatusCount('closed'),
      icon: IconCircleCheck,
      tone: 'neutral',
    },
  ];

  return (
    <div className={[page.root, page.content].join(' ')}>
      {header}
      {isError && <ParkAlert.Root role="alert" status="warning"><ParkAlert.Content>
        <ParkAlert.Description>Dashboard metrics could not be refreshed. Showing the last loaded values.</ParkAlert.Description>
        <ParkButton type="button" variant="plain" disabled={isFetching} onClick={() => void refetch()}>Retry dashboard metrics</ParkButton>
      </ParkAlert.Content></ParkAlert.Root>}

      <div className={page.metricStrip}>
        {cards.map(card => (
          <ParkCard.Root key={card.label} variant="outline" className={page.metricCard}>
            <ParkCard.Header className={page.metricCardHeader}>
              <div className={page.metricIcon} data-tone={card.tone} aria-hidden="true">
                <card.icon aria-hidden="true" />
              </div>
              <ParkCard.Title className={page.metricLabel}>{card.label}</ParkCard.Title>
            </ParkCard.Header>
            <ParkCard.Body className={page.metricCardBody}>
              <p className={page.metricValue} data-tabular>{card.value}</p>
            </ParkCard.Body>
          </ParkCard.Root>
        ))}
      </div>

      <div className={page.panels}>
        <ParkCard.Root variant="outline">
          <ParkCard.Header className={page.panelHeader}>
            <IconChartBar className={page.panelIcon} aria-hidden="true" />
            <ParkCard.Title className={page.panelTitle}>Tickets by Priority</ParkCard.Title>
          </ParkCard.Header>
          <ParkCard.Body className={page.priorityList}>
            {totalTickets === 0 ? <ParkEmptyState title="No ticket activity yet" description="Tickets will appear here when the first conversation arrives." headingLevel={false}
              action={<ParkButton type="button" onClick={() => navigate('/inbox')}>Open Inbox</ParkButton>} /> : ['urgent', 'high', 'normal', 'low'].map((priority) => {
              const count = stats.ticketsByPriority.find(p => p.priority === priority)?.count || 0;
              const percentage = totalTickets > 0 ? (count / totalTickets) * 100 : 0;
              return (
                <div key={priority} className={page.priorityRow}>
                  <div>
                    <span>{priority}</span>
                    <span>{count}</span>
                  </div>
                  <ParkProgress
                    value={percentage}
                    className={css({ w: 'full' })}
                    label={
                      <span className={css({ position: 'absolute', w: '1px', h: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' })}>
                        {priority} tickets: {count} of {totalTickets} ({percentage.toFixed(1)}%)
                      </span>
                    }
                  />
                </div>
              );
            })}
          </ParkCard.Body>
        </ParkCard.Root>

        <ParkCard.Root variant="outline">
          <ParkCard.Header className={page.panelHeader}>
            <IconUsers className={page.panelIcon} aria-hidden="true" />
            <ParkCard.Title className={page.panelTitle}>System Overview</ParkCard.Title>
          </ParkCard.Header>
          <ParkCard.Body>
            <div className={page.overviewGrid}>
              <ParkCard.Root variant="subtle" className={page.overviewCard}>
                <ParkCard.Body className={page.overviewCardBody}>
                  <div className={page.overviewCardLabel}>
                    <IconUsers aria-hidden="true" />
                    <span>Total Users</span>
                  </div>
                  <p className={page.overviewCardValue} data-tabular>{stats.totalUsers}</p>
                </ParkCard.Body>
              </ParkCard.Root>
              <ParkCard.Root variant="subtle" className={page.overviewCard}>
                <ParkCard.Body className={page.overviewCardBody}>
                  <div className={page.overviewCardLabel}>
                    <IconUsers aria-hidden="true" />
                    <span>Active Groups</span>
                  </div>
                  <p className={page.overviewCardValue} data-tabular>{stats.totalGroups}</p>
                </ParkCard.Body>
              </ParkCard.Root>
            </div>
            <p className={page.overviewFooter}>Use Inbox to keep the conversation list in place while reviewing and replying.</p>
          </ParkCard.Body>
        </ParkCard.Root>
      </div>
    </div>
  );
};

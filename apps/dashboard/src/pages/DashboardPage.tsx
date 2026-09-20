import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ParkButton, ParkCard, ParkEmptyState, ParkPage, ParkProgress } from '@luminatick/ui/park';
import { css } from '@luminatick/ui/styled-system/css';
import { useStats } from '../hooks/useStats';
import { IconChartBar, IconUsers, IconTicket, IconCircleCheck, IconClock, IconCircleExclamation } from '@luminatick/ui/icons';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { data: stats, isLoading } = useStats();

  if (isLoading) {
    return (
      <ParkEmptyState title="Loading dashboard metrics…" headingLevel={false} aria-busy="true" />
    );
  }

  const getStatusCount = (status: string) =>
    stats?.ticketsByStatus.find(s => s.status === status)?.count || 0;

  const totalTickets = stats?.ticketsByStatus.reduce((acc, curr) => acc + curr.count, 0) || 0;

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

  const page = ParkPage('dashboard');
  return (
    <div className={[page.root, page.content].join(' ')}>
      <header className={page.header}>
        <div className={page.dashboardHeading}>
          <h1>Dashboard</h1>
          <p>A quick overview of the support workload.</p>
        </div>
        <ParkButton type="button" variant="solid" className={page.dashboardAction} onClick={() => navigate('/inbox')}>Open Inbox</ParkButton>
      </header>

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
            {['urgent', 'high', 'normal', 'low'].map((priority) => {
              const count = stats?.ticketsByPriority.find(p => p.priority === priority)?.count || 0;
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
                  <p className={page.overviewCardValue} data-tabular>{stats?.totalUsers || 0}</p>
                </ParkCard.Body>
              </ParkCard.Root>
              <ParkCard.Root variant="subtle" className={page.overviewCard}>
                <ParkCard.Body className={page.overviewCardBody}>
                  <div className={page.overviewCardLabel}>
                    <IconUsers aria-hidden="true" />
                    <span>Active Groups</span>
                  </div>
                  <p className={page.overviewCardValue} data-tabular>{stats?.totalGroups || 0}</p>
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

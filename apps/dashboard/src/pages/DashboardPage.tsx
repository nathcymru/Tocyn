import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ParkButton, ParkCard, ParkEmptyState, ParkPage } from '@luminatick/ui/park';
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
        <h1>Dashboard</h1>
        <p>A quick overview of the support workload.</p>
        <ParkButton type="button" variant="solid" onClick={() => navigate('/inbox')}>Open Inbox</ParkButton>
      </header>

      <div className={page.metricStrip}>
        {cards.map((card, idx) => (
          <ParkCard.Root key={idx} variant="outline" className={page.metricCard}>
            <ParkCard.Header>
              <div className={page.metricIcon} data-tone={card.tone}>
                <card.icon />
              </div>
              <span>Metrics</span>
            </ParkCard.Header>
            <ParkCard.Body>
              <div>
                <ParkCard.Description>{card.label}</ParkCard.Description>
                <ParkCard.Title data-tabular>{card.value}</ParkCard.Title>
              </div>
            </ParkCard.Body>
          </ParkCard.Root>
        ))}
      </div>

      <div className={page.panels}>
        <ParkCard.Root variant="outline">
          <ParkCard.Header>
            <IconChartBar />
            <h3>Tickets by Priority</h3>
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
                  <div className={page.progressTrack}>
                    <div
                      className={page.progressFill}
                      data-tone={priority}
                      style={{ ['--tocyn-progress' as string]: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </ParkCard.Body>
        </ParkCard.Root>

        <ParkCard.Root variant="outline">
          <ParkCard.Header>
            <IconUsers />
            <h3>System Overview</h3>
          </ParkCard.Header>
          <ParkCard.Body>
          <div className={page.overviewGrid}>
            <ParkCard.Root variant="subtle" className={page.overviewCard}>
              <div>
                <IconUsers />
                <span>Total Users</span>
              </div>
              <p>{stats?.totalUsers || 0}</p>
            </ParkCard.Root>
            <ParkCard.Root variant="subtle" className={page.overviewCard}>
              <div>
                <IconUsers />
                <span>Active Groups</span>
              </div>
              <p>{stats?.totalGroups || 0}</p>
            </ParkCard.Root>
          </div>
          <p className={page.overviewFooter}>Use Inbox to keep the conversation list in place while reviewing and replying.</p>
          </ParkCard.Body>
        </ParkCard.Root>
      </div>
    </div>
  );
};

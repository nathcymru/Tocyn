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
      <ParkEmptyState title="Loading dashboard metrics…" headingLevel={false} aria-busy="true" className="tocyn-dashboard-loading" />
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
      color: 'tocyn-palette-blue-soft tocyn-palette-blue-text',
    },
    {
      label: 'Open Tickets',
      value: getStatusCount('open'),
      icon: IconCircleExclamation,
      color: 'tocyn-palette-green-soft tocyn-palette-green-text',
    },
    {
      label: 'Pending Tickets',
      value: getStatusCount('pending'),
      icon: IconClock,
      color: 'tocyn-palette-amber-soft tocyn-palette-amber-text',
    },
    {
      label: 'Resolved Tickets',
      value: getStatusCount('resolved') + getStatusCount('closed'),
      icon: IconCircleCheck,
      color: 'tocyn-palette-neutral-soft tocyn-palette-neutral-text',
    },
  ];

  return (
    <div className={[ParkPage('dashboard').root, ParkPage('dashboard').content, 'tocyn-dashboard-page'].join(' ')}>
      <div>
        <h1 className="tocyn-dashboard-page-title">Dashboard</h1>
        <p className="tocyn-dashboard-page-description">A quick overview of the support workload.</p>
        <ParkButton type="button" variant="solid" onClick={() => navigate('/inbox')} className="tocyn-dashboard-open-inbox">Open Inbox</ParkButton>
      </div>

      <div className="tocyn-metric-strip">
        {cards.map((card, idx) => (
          <ParkCard.Root key={idx} variant="outline" className="tocyn-metric-card">
            <ParkCard.Header className="tocyn-metric-card-header">
              <div className={`tocyn-metric-card-icon ${card.color}`}>
                <card.icon className="tocyn-metric-card-icon-glyph" />
              </div>
              <span className="tocyn-metric-card-kicker">Metrics</span>
            </ParkCard.Header>
            <ParkCard.Body className="tocyn-metric-card-content">
              <div>
                <ParkCard.Description className="tocyn-metric-card-label">{card.label}</ParkCard.Description>
                <ParkCard.Title data-tabular className="tocyn-metric-card-value">{card.value}</ParkCard.Title>
              </div>
            </ParkCard.Body>
          </ParkCard.Root>
        ))}
      </div>

      <div className="tocyn-dashboard-panels">
        <ParkCard.Root variant="outline" className="tocyn-surface-card">
          <ParkCard.Header className="tocyn-dashboard-card-heading">
            <IconChartBar className="tocyn-dashboard-panel-icon" />
            <h3 className="tocyn-dashboard-panel-title">Tickets by Priority</h3>
          </ParkCard.Header>
          <ParkCard.Body className="tocyn-priority-list">
            {['urgent', 'high', 'normal', 'low'].map((priority) => {
              const count = stats?.ticketsByPriority.find(p => p.priority === priority)?.count || 0;
              const percentage = totalTickets > 0 ? (count / totalTickets) * 100 : 0;
              return (
                <div key={priority} className="tocyn-priority-row">
                  <div className="tocyn-priority-label-row">
                    <span className="tocyn-priority-name">{priority}</span>
                    <span className="tocyn-priority-count">{count}</span>
                  </div>
                  <div className="tocyn-progress-track">
                    <div
                      className={`tocyn-progress-fill ${
                        priority === 'urgent' ? 'tocyn-palette-red-fill' :
                        priority === 'high' ? 'tocyn-palette-orange-fill' :
                        priority === 'normal' ? 'tocyn-palette-blue-fill' : 'tocyn-palette-neutral-fill'
                      }`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </ParkCard.Body>
        </ParkCard.Root>

        <ParkCard.Root variant="outline" className="tocyn-surface-card">
          <ParkCard.Header className="tocyn-dashboard-card-heading">
            <IconUsers className="tocyn-dashboard-panel-icon" />
            <h3 className="tocyn-dashboard-panel-title">System Overview</h3>
          </ParkCard.Header>
          <ParkCard.Body>
          <div className="tocyn-overview-grid">
            <ParkCard.Root variant="subtle" className="tocyn-overview-card">
              <div className="tocyn-overview-card-heading">
                <IconUsers className="tocyn-overview-icon" />
                <span className="tocyn-overview-label">Total Users</span>
              </div>
              <p className="tocyn-overview-value">{stats?.totalUsers || 0}</p>
            </ParkCard.Root>
            <ParkCard.Root variant="subtle" className="tocyn-overview-card">
              <div className="tocyn-overview-card-heading">
                <IconUsers className="tocyn-overview-icon" />
                <span className="tocyn-overview-label">Active Groups</span>
              </div>
              <p className="tocyn-overview-value">{stats?.totalGroups || 0}</p>
            </ParkCard.Root>
          </div>
          <p className="tocyn-overview-footer">Use Inbox to keep the conversation list in place while reviewing and replying.</p>
          </ParkCard.Body>
        </ParkCard.Root>
      </div>
    </div>
  );
};

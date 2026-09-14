import React from 'react';
import { Link } from 'react-router-dom';
import { ParkEmptyState } from '@luminatick/ui/park';
import { useStats } from '../hooks/useStats';
import { FaChartBar, FaUsers, FaTicket, FaCircleCheck, FaClock, FaCircleExclamation } from 'react-icons/fa6';

export const DashboardPage: React.FC = () => {
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
      icon: FaTicket,
      color: 'tocyn-palette-blue-soft tocyn-palette-blue-text',
    },
    {
      label: 'Open Tickets',
      value: getStatusCount('open'),
      icon: FaCircleExclamation,
      color: 'tocyn-palette-green-soft tocyn-palette-green-text',
    },
    {
      label: 'Pending Tickets',
      value: getStatusCount('pending'),
      icon: FaClock,
      color: 'tocyn-palette-amber-soft tocyn-palette-amber-text',
    },
    {
      label: 'Resolved Tickets',
      value: getStatusCount('resolved') + getStatusCount('closed'),
      icon: FaCircleCheck,
      color: 'tocyn-palette-neutral-soft tocyn-palette-neutral-text',
    },
  ];

  return (
    <div className="tocyn-dashboard-page">
      <div>
        <h1 className="tocyn-dashboard-page-title">Dashboard</h1>
        <p className="tocyn-dashboard-page-description">A quick overview of the support workload.</p>
        <Link to="/inbox" className="tocyn-dashboard-open-inbox">Open Inbox</Link>
      </div>

      <div className="tocyn-metric-strip">
        {cards.map((card, idx) => (
          <div key={idx} className="tocyn-metric-card">
            <div className="tocyn-metric-card-header">
              <div className={`tocyn-metric-card-icon ${card.color}`}>
                <card.icon className="tocyn-metric-card-icon-glyph" />
              </div>
              <span className="tocyn-metric-card-kicker">Metrics</span>
            </div>
            <div className="tocyn-metric-card-content">
              <div>
                <p className="tocyn-metric-card-label">{card.label}</p>
                <h3 className="tocyn-metric-card-value">{card.value}</h3>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="tocyn-dashboard-panels">
        <div className="tocyn-surface-card">
          <div className="tocyn-dashboard-card-heading">
            <FaChartBar className="tocyn-dashboard-panel-icon" />
            <h3 className="tocyn-dashboard-panel-title">Tickets by Priority</h3>
          </div>
          <div className="tocyn-priority-list">
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
          </div>
        </div>

        <div className="tocyn-surface-card">
          <div className="tocyn-dashboard-card-heading">
            <FaUsers className="tocyn-dashboard-panel-icon" />
            <h3 className="tocyn-dashboard-panel-title">System Overview</h3>
          </div>
          <div className="tocyn-overview-grid">
            <div className="tocyn-overview-card">
              <div className="tocyn-overview-card-heading">
                <FaUsers className="tocyn-overview-icon" />
                <span className="tocyn-overview-label">Total Users</span>
              </div>
              <p className="tocyn-overview-value">{stats?.totalUsers || 0}</p>
            </div>
            <div className="tocyn-overview-card">
              <div className="tocyn-overview-card-heading">
                <FaUsers className="tocyn-overview-icon" />
                <span className="tocyn-overview-label">Active Groups</span>
              </div>
              <p className="tocyn-overview-value">{stats?.totalGroups || 0}</p>
            </div>
          </div>
          <p className="tocyn-overview-footer">Use Inbox to keep the conversation list in place while reviewing and replying.</p>
        </div>
      </div>
    </div>
  );
};

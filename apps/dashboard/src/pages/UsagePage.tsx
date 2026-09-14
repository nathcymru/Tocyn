import { ParkButton, ParkEmptyState, ParkInput } from '@luminatick/ui/park';
import React, { useState, useEffect } from 'react';
import { dashboardApi, ApiError } from '../api/client';
import {
  FaCreditCard,
  FaDatabase,
  FaHardDrive,
  FaMicrochip,
  FaChartLine,
  FaCircleExclamation,
  FaArrowUpRightFromSquare,
  FaBolt
} from 'react-icons/fa6';
import { UsageStats } from '@luminatick/shared';
import { clsx } from 'clsx';

function cn(...inputs: any[]) {
  return clsx(inputs);
}



const LIMITS = {
  d1_reads_writes: 5_000_000, // 5M per day
  r2_class_a: 1_000_000, // 1M per month
  r2_class_b: 10_000_000, // 10M per month
  worker_requests: 100_000, // 100k per day
  ai_neurons: 10_000, // 10k per day
  do_requests: 100_000, // 100k per day
  vectorize_queries: 30_000_000, // 30M per month
  vectorize_writes: 5_000_000, // 5M per month
};

function formatNumber(num: number) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toString();
}

export function UsagePage() {
  const [data, setData] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAuthError, setIsAuthError] = useState(false);
  const [isMasterKeyMissing, setIsMasterKeyMissing] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [savingCredentials, setSavingCredentials] = useState(false);

  const [showCredentialsForm, setShowCredentialsForm] = useState(false);

  const fetchUsage = async () => {
    try {
      setLoading(true);
      setError(null);
      setIsAuthError(false);
      setIsMasterKeyMissing(false);

      const response = await dashboardApi.get<UsageStats>('/settings/usage');
      setData(response);
      setShowCredentialsForm(false);
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to fetch usage data';
      if (errorMessage.includes('APP_MASTER_KEY is missing')) {
        setIsMasterKeyMissing(true);
      } else if (err instanceof ApiError && err.status === 400) {
        setIsAuthError(true);
        setShowCredentialsForm(true);
      } else {
        setError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const saveCredentials = async () => {
    if (!accountId.trim() || (!apiToken.trim() && !isAuthError)) {
      setError('Account ID is required');
      return;
    }

    // Only require API Token if it's not currently set (auth error) or they are explicitly changing it
    const payload: Record<string, string> = {
      CLOUDFLARE_ACCOUNT_ID: accountId.trim()
    };

    if (apiToken.trim()) {
      payload.CLOUDFLARE_API_TOKEN = apiToken.trim();
    }

    try {
      setSavingCredentials(true);
      setError(null);
      setIsMasterKeyMissing(false);
      await dashboardApi.put('/settings', payload);
      await fetchUsage();
      setApiToken(''); // Clear sensitive token from state
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to save credentials';
      if (errorMessage.includes('APP_MASTER_KEY is missing')) {
        setIsMasterKeyMissing(true);
      } else {
        setError(errorMessage);
      }
    } finally {
      setSavingCredentials(false);
    }
  };

  useEffect(() => {
    fetchUsage();
  }, []);

  const renderCredentialsForm = () => (
    <div className="tocyn-usage-credentials">
      <div className={cn("tocyn-usage-credentials-header", isAuthError ? "tocyn-usage-credentials-header--auth" : "tocyn-usage-credentials-header--update")}>
        <FaCircleExclamation className="tocyn-usage-credentials-icon" />
        <div>
          <h3 className="tocyn-usage-credentials-title">
            {isAuthError ? 'Cloudflare Credentials Required' : 'Update Cloudflare Credentials'}
          </h3>
          <p className="tocyn-usage-credentials-copy">
            {isAuthError
              ? 'To view your usage and costs, you need to provide your Cloudflare Account ID and an API Token with Account Analytics permissions.'
              : 'Update your Cloudflare Account ID or Analytics API Token. Leave the token field blank to keep your existing encrypted token.'}
          </p>
          <p className="tocyn-usage-credentials-note">
            Note: Storing these credentials in the database allows anyone with Admin access to view them, but it makes setup easier.
          </p>
        </div>
      </div>

      <div className="tocyn-usage-credentials-body">
        <div>
          <h4 className="tocyn-usage-credentials-step-title">1. How to get your API Token:</h4>
          <ol className="tocyn-usage-credentials-steps">
            <li>
              Go to your <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="tocyn-usage-credentials-link">Cloudflare API Tokens <FaArrowUpRightFromSquare className="tocyn-usage-credentials-link-icon" /></a> dashboard.
            </li>
            <li>Click <strong>Create Token</strong> and choose <strong>Create Custom Token</strong>.</li>
            <li>
              Under Permissions, select:
              <ul className="tocyn-usage-credentials-permissions">
                <li>Account <span className="tocyn-usage-credentials-arrow">→</span> Account Analytics <span className="tocyn-usage-credentials-arrow">→</span> Read</li>
              </ul>
            </li>
            <li>Under Account Resources, select your account.</li>
            <li>Complete the creation and copy your new token.</li>
          </ol>
        </div>

        <div>
          <h4 className="tocyn-usage-credentials-step-title tocyn-usage-credentials-step-title--form">2. Enter your credentials:</h4>
          <div className="tocyn-usage-credentials-fields">
            <div>
              <label htmlFor="cloudflare-account-id" className="tocyn-usage-credentials-label">
                Cloudflare Account ID
              </label>
              <ParkInput
                id="cloudflare-account-id"
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="e.g., 1234567890abcdef1234567890abcdef"
                className="tocyn-form-control tocyn-usage-credentials-input"
              />
            </div>
            <div>
              <label htmlFor="cloudflare-api-token" className="tocyn-usage-credentials-label">
                Cloudflare API Token
              </label>
              <ParkInput
                id="cloudflare-api-token"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder={isAuthError ? "Enter your API token" : "•••••••• (Leave blank to keep existing)"}
                className="tocyn-form-control tocyn-usage-credentials-input"
              />
            </div>
            <div className="tocyn-usage-credentials-actions">
              <ParkButton
                onClick={saveCredentials}
                disabled={savingCredentials}
                className="tocyn-usage-credentials-save"
              >
                {savingCredentials ? 'Saving...' : 'Save & View Usage'}
              </ParkButton>
              {!isAuthError && (
                <ParkButton
                  onClick={() => setShowCredentialsForm(false)}
                  disabled={savingCredentials}
                  className="tocyn-usage-credentials-cancel"
                >
                  Cancel
                </ParkButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading) {
    return <ParkEmptyState title="Loading usage data…" headingLevel={false} aria-busy="true" className="tocyn-usage-loading" />;
  }

  if (isMasterKeyMissing) {
    return (
      <div className="tocyn-usage-state-page">
        <div>
          <h1 className="tocyn-usage-state-title">
            <FaCreditCard className="tocyn-usage-state-icon" />
            Usage & Costs
          </h1>
        </div>
        <div className="tocyn-usage-critical">
          <FaCircleExclamation className="tocyn-usage-critical-icon" />
          <div>
            <h3 className="tocyn-usage-critical-title">Critical: Missing Encryption Key</h3>
            <p className="tocyn-usage-critical-copy">
              Your server is missing the <code className="tocyn-usage-critical-code">APP_MASTER_KEY</code> environment variable.
              This 32-character key is required to securely encrypt and decrypt API tokens and other sensitive settings.
            </p>
            <p className="tocyn-usage-critical-note">
              Please ask your system administrator to add it to your server's environment configuration, then restart the application.
            </p>
            <ParkButton
              onClick={fetchUsage}
              className="tocyn-usage-critical-retry"
            >
              Retry
            </ParkButton>
          </div>
        </div>
      </div>
    );
  }

  if (error && !isAuthError) {
    return (
      <div className="tocyn-usage-state-page">
        <div>
          <h1 className="tocyn-usage-state-title">
            <FaCreditCard className="tocyn-usage-state-icon" />
            Usage & Costs
          </h1>
        </div>
        <div className="tocyn-usage-error">
          <p className="tocyn-usage-error-title">Error loading usage data</p>
          <p className="tocyn-usage-error-copy">{error}</p>
          <ParkButton
            onClick={fetchUsage}
            className="tocyn-usage-error-retry"
          >
            Retry
          </ParkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="tocyn-usage-page">
      <div className="tocyn-usage-header">
        <div>
          <h1 className="tocyn-usage-title">
            <FaCreditCard className="tocyn-usage-title-icon" />
            Usage & Costs
          </h1>
          <p className="tocyn-usage-description">
            Monitor your Cloudflare resource usage against Free Tier limits. Updates may be delayed by a few hours.
          </p>
        </div>
        {!isAuthError && !showCredentialsForm && (
          <ParkButton
            onClick={() => setShowCredentialsForm(true)}
            className="tocyn-usage-update"
          >
            Update Credentials
          </ParkButton>
        )}
      </div>

      {(isAuthError || showCredentialsForm) && renderCredentialsForm()}

      {!isAuthError && !showCredentialsForm && (
        <div className="tocyn-usage-stat-grid">
          <StatCard
            title="D1 Reads and Writes"
            description="Database row operations"
            icon={FaDatabase}
            current={(data?.d1?.rowsRead || 0) + (data?.d1?.rowsWritten || 0)}
            limit={LIMITS.d1_reads_writes}
            unit="/ day"
            format={formatNumber}
            colorClass="text-blue-600"
            bgClass="bg-blue-50"
            fillClass="bg-blue-500"
          />

          <StatCard
            title="R2 Operations (Class A)"
            description="Writes to storage"
            icon={FaHardDrive}
            current={data?.r2?.classAOperations || 0}
            limit={LIMITS.r2_class_a}
            unit="/ month"
            format={formatNumber}
            colorClass="text-indigo-600"
            bgClass="bg-indigo-50"
            fillClass="bg-indigo-500"
          />

          <StatCard
            title="R2 Operations (Class B)"
            description="Reads from storage"
            icon={FaHardDrive}
            current={data?.r2?.classBOperations || 0}
            limit={LIMITS.r2_class_b}
            unit="/ month"
            format={formatNumber}
            colorClass="text-purple-600"
            bgClass="bg-purple-50"
            fillClass="bg-purple-500"
          />

          <StatCard
            title="Workers Requests"
            description="API calls, widget loads, pages"
            icon={FaChartLine}
            current={data?.workers?.requests || 0}
            limit={LIMITS.worker_requests}
            unit="/ day"
            format={formatNumber}
            colorClass="text-emerald-600"
            bgClass="bg-emerald-50"
            fillClass="bg-emerald-500"
          />

          <StatCard
            title="Workers AI Neurons"
            description="RAG, embedding, auto-responses"
            icon={FaMicrochip}
            current={data?.workersAi?.neurons || 0}
            limit={LIMITS.ai_neurons}
            unit="/ day"
            format={formatNumber}
            colorClass="text-brand-600"
            bgClass="bg-brand-50"
            fillClass="bg-brand-500"
          />

          <StatCard
            title="Durable Objects Requests"
            description="Real-time presence connections"
            icon={FaBolt}
            current={data?.durableObjects?.requests || 0}
            limit={LIMITS.do_requests}
            unit="/ day"
            format={formatNumber}
            colorClass="text-amber-600"
            bgClass="bg-amber-50"
            fillClass="bg-amber-500"
          />

          <StatCard
            title="Vectorize Queries"
            description="Vector search queries"
            icon={FaDatabase}
            current={data?.vectorize?.queried || 0}
            limit={LIMITS.vectorize_queries}
            unit="/ month"
            format={formatNumber}
            colorClass="text-pink-600"
            bgClass="bg-pink-50"
            fillClass="bg-pink-500"
          />

          <StatCard
            title="Vectorize Writes"
            description="Vector index updates"
            icon={FaDatabase}
            current={data?.vectorize?.written || 0}
            limit={LIMITS.vectorize_writes}
            unit="/ month"
            format={formatNumber}
            colorClass="text-rose-600"
            bgClass="bg-rose-50"
            fillClass="bg-rose-500"
          />
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  current: number;
  limit: number;
  unit: string;
  format?: (n: number) => string;
  colorClass: string;
  bgClass: string;
  fillClass: string;
}

function StatCard({ title, description, icon: Icon, current, limit, unit, format, colorClass, bgClass, fillClass }: StatCardProps) {
  const percentage = Math.min((current / limit) * 100, 100);
  const isNearLimit = percentage >= 80;
  const isOverLimit = percentage >= 100;

  const displayCurrent = format ? format(current) : current;
  const displayLimit = format ? format(limit) : limit;

  return (
    <div className="tocyn-usage-stat-card">
      <div className="tocyn-usage-stat-header">
        <div className="tocyn-usage-stat-heading">
          <div className={cn("tocyn-usage-stat-icon", bgClass, colorClass)}>
            <Icon className="tocyn-usage-stat-icon-glyph" />
          </div>
          <div>
            <h3 className="tocyn-usage-stat-title">{title}</h3>
            <p className="tocyn-usage-stat-description">{description}</p>
          </div>
        </div>
        <div className="tocyn-usage-stat-value">
          <div className="tocyn-usage-stat-current">
            {displayCurrent}
          </div>
          <div className="tocyn-usage-stat-limit">
            of {displayLimit} {unit}
          </div>
        </div>
      </div>

      <div className="tocyn-usage-stat-progress">
        <div className="tocyn-usage-stat-progress-label">
          <span className={cn(
            "tocyn-usage-stat-percentage",
            isOverLimit ? "tocyn-usage-stat-percentage--over" : isNearLimit ? "tocyn-usage-stat-percentage--near" : "tocyn-usage-stat-percentage--normal"
          )}>
            {percentage.toFixed(1)}% Used
          </span>
          <span className="tocyn-usage-stat-free-tier">Free Tier Limit</span>
        </div>
        <div className="tocyn-progress-track tocyn-progress-track--usage">
          <div
            className={cn("tocyn-progress-fill tocyn-usage-stat-fill",
              isOverLimit ? "bg-red-500" : isNearLimit ? "bg-orange-500" : fillClass
            )}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}

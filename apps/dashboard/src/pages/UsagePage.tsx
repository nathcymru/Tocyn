import { css } from '@luminatick/ui/styled-system/css';
import { ParkAlert, ParkButton, ParkCard, ParkEmptyState, ParkField, ParkInput, ParkProgress, ParkSkeleton } from '@luminatick/ui/park';
import { Link as ParkLink } from '@luminatick/ui/components';
import React, { useState, useEffect } from 'react';
import { dashboardApi, ApiError } from '../api/client';
import {
  IconCreditCard,
  IconDatabase,
  IconHardDrive,
  IconMicrochip,
  IconChartLine,
  IconCircleExclamation,
  IconArrowUpRightFromSquare,
  IconBolt
} from '@luminatick/ui/icons';
import { UsageStats } from '@luminatick/shared';

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
const usageHeading = css({ display: 'flex', alignItems: 'center', gap: '2', fontSize: 'xl', fontWeight: 'semibold', lineHeight: 'tight', color: 'text.primary' });

function formatNumber(num: number) {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
  return num.toString();
}

function hasMetrics(value: unknown, keys: string[]): value is Record<string, number> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && keys.every(key => typeof (value as Record<string, unknown>)[key] === 'number'
      && Number.isFinite((value as Record<string, number>)[key])
      && (value as Record<string, number>)[key] >= 0);
}

function isUsageStats(value: unknown): value is UsageStats {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const stats = value as Record<string, unknown>;
  return hasMetrics(stats.d1, ['readQueries', 'writeQueries', 'rowsRead', 'rowsWritten'])
    && hasMetrics(stats.r2, ['classAOperations', 'classBOperations'])
    && hasMetrics(stats.workersAi, ['neurons'])
    && hasMetrics(stats.workers, ['requests', 'cpuTime'])
    && (stats.durableObjects === undefined || hasMetrics(stats.durableObjects, ['requests', 'cpuTime', 'activeConnections', 'inboundWebsocketMsg', 'outboundWebsocketMsg']))
    && (stats.vectorize === undefined || hasMetrics(stats.vectorize, ['queried', 'written']));
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

      const response = await dashboardApi.get<unknown>('/settings/usage');
      if (!isUsageStats(response)) throw new Error('Usage readings are incomplete. Retry or check provider analytics.');
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
    <ParkCard.Root variant="outline">
      <ParkCard.Header className={css({ display: 'flex', alignItems: 'start', gap: '3' })}>
        <IconCircleExclamation aria-hidden="true" className={css({ w: '5', h: '5', flexShrink: 0 })} />
        <div>
          <ParkCard.Title asChild><h3>
            {isAuthError ? 'Cloudflare Credentials Required' : 'Update Cloudflare Credentials'}
          </h3></ParkCard.Title>
          <ParkCard.Description>
            {isAuthError
              ? 'To view your usage and costs, you need to provide your Cloudflare Account ID and an API Token with Account Analytics permissions.'
              : 'Update your Cloudflare Account ID or Analytics API Token. Leave the token field blank to keep your existing encrypted token.'}
          </ParkCard.Description>
        </div>
      </ParkCard.Header>

      <ParkCard.Body className={css({ display: 'grid', gap: '6', minW: 0 })}>
        <ParkAlert.Root role="note" status="info" variant="surface">
          <ParkAlert.Content><ParkAlert.Description>
            Note: Storing these credentials in the database allows anyone with Admin access to view them, but it makes setup easier.
          </ParkAlert.Description></ParkAlert.Content>
        </ParkAlert.Root>
        <div className={css({ minW: 0 })}>
        <div>
          <h4 className={css({"fontSize":"xl","fontWeight":"medium","lineHeight":"tight","color":"text.primary"})}>1. How to get your API Token:</h4>
          <ol className={css({"minW":0})}>
            <li>
              Go to your <ParkLink href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className={css({"minW":0})}>Cloudflare API Tokens <IconArrowUpRightFromSquare aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} /></ParkLink> dashboard.
            </li>
            <li>Click <strong>Create Token</strong> and choose <strong>Create Custom Token</strong>.</li>
            <li>
              Under Permissions, select:
              <ul className={css({"minW":0})}>
                <li>Account <span className={css({"minW":0})}>→</span> Account Analytics <span className={css({"minW":0})}>→</span> Read</li>
              </ul>
            </li>
            <li>Under Account Resources, select your account.</li>
            <li>Complete the creation and copy your new token.</li>
          </ol>
        </div>

        <div>
          <h4 className={css({"fontSize":"xl","fontWeight":"medium","lineHeight":"tight","color":"text.primary","maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})}>2. Enter your credentials:</h4>
          <div className={css({"display":"grid","gap":"4"})}>
            <ParkField label="Cloudflare Account ID">
              <ParkInput
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="e.g., 1234567890abcdef1234567890abcdef"
                className={css({"w":"full"})}
              />
            </ParkField>
            <ParkField label="Cloudflare API Token">
              <ParkInput
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder={isAuthError ? "Enter your API token" : "•••••••• (Leave blank to keep existing)"}
                className={css({"w":"full"})}
              />
            </ParkField>
            <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap"})}>
              <ParkButton
                onClick={saveCredentials}
                disabled={savingCredentials}
                className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
              >
                {savingCredentials ? 'Saving...' : 'Save & View Usage'}
              </ParkButton>
              {!isAuthError && (
                <ParkButton
                  onClick={() => setShowCredentialsForm(false)}
                  disabled={savingCredentials}
                  className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
                >
                  Cancel
                </ParkButton>
              )}
            </div>
          </div>
        </div>
        </div>
      </ParkCard.Body>
    </ParkCard.Root>
  );

  if (loading) {
    return <div aria-label="Loading usage data" aria-busy="true" className={css({ display: 'grid', gap: '4', maxW: '6xl', mx: 'auto', px: { base: '4', md: '6' }, py: '6' })}>
      <ParkSkeleton aria-hidden="true" className={css({ w: '48', h: '8' })} />
      <div className={css({ display: 'grid', gap: '4', gridTemplateColumns: { base: '1fr', md: 'repeat(2,minmax(0,1fr))', xl: 'repeat(3,minmax(0,1fr))' } })}>
        {Array.from({ length: 6 }, (_, index) => <ParkSkeleton key={index} aria-hidden="true" className={css({ h: '32', w: 'full' })} />)}
      </div>
    </div>;
  }

  if (isMasterKeyMissing) {
    return (
      <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})}>
        <div>
          <h1 className={usageHeading}>
            <IconCreditCard aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
            Usage & Costs
          </h1>
        </div>
        <ParkEmptyState role="alert" title="Usage data is unavailable" description="The server is missing its encryption key. Ask an administrator to restore the server configuration, then retry." action={<ParkButton onClick={fetchUsage}>Retry</ParkButton>} />
      </div>
    );
  }

  if (error && !isAuthError) {
    return (
      <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})}>
        <div>
          <h1 className={usageHeading}>
            <IconCreditCard aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
            Usage & Costs
          </h1>
        </div>
        <ParkEmptyState role="alert" title="Error loading usage data" description={error} action={<ParkButton onClick={fetchUsage}>Retry</ParkButton>} />
      </div>
    );
  }

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 className={usageHeading}>
            <IconCreditCard aria-hidden="true" className={css({"w":"4","h":"4","flexShrink":0})} />
            Usage & Costs
          </h1>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
            Monitor your Cloudflare resource usage against Free Tier limits. Updates may be delayed by a few hours.
          </p>
        </div>
        {!isAuthError && !showCredentialsForm && (
          <ParkButton
            onClick={() => setShowCredentialsForm(true)}
            className={css({"minW":0})}
          >
            Update Credentials
          </ParkButton>
        )}
      </div>

      {(isAuthError || showCredentialsForm) && renderCredentialsForm()}

      {!isAuthError && !showCredentialsForm && (
        <div className={css({"display":"grid","gap":"4","gridTemplateColumns":{"base":"1fr","md":"repeat(2,minmax(0,1fr))","xl":"repeat(3,minmax(0,1fr))"}})}>
          <StatCard
            title="D1 Reads and Writes"
            description="Database row operations"
            icon={IconDatabase}
            current={data ? data.d1.rowsRead + data.d1.rowsWritten : null}
            limit={LIMITS.d1_reads_writes}
            unit="/ day"
            format={formatNumber}
            bgClass={css({ bg: 'blue.3' })}
          />

          <StatCard
            title="R2 Operations (Class A)"
            description="Writes to storage"
            icon={IconHardDrive}
            current={data?.r2.classAOperations ?? null}
            limit={LIMITS.r2_class_a}
            unit="/ month"
            format={formatNumber}
            bgClass={css({ bg: 'blue.3' })}
          />

          <StatCard
            title="R2 Operations (Class B)"
            description="Reads from storage"
            icon={IconHardDrive}
            current={data?.r2.classBOperations ?? null}
            limit={LIMITS.r2_class_b}
            unit="/ month"
            format={formatNumber}
            bgClass={css({ bg: 'purple.3' })}
          />

          <StatCard
            title="Workers Requests"
            description="API calls, widget loads, pages"
            icon={IconChartLine}
            current={data?.workers.requests ?? null}
            limit={LIMITS.worker_requests}
            unit="/ day"
            format={formatNumber}
            bgClass={css({ bg: 'green.3' })}
          />

          <StatCard
            title="Workers AI Neurons"
            description="RAG, embedding, auto-responses"
            icon={IconMicrochip}
            current={data?.workersAi.neurons ?? null}
            limit={LIMITS.ai_neurons}
            unit="/ day"
            format={formatNumber}
            bgClass={css({ bg: 'colorPalette.3' })}
          />

          <StatCard
            title="Durable Objects Requests"
            description="Real-time presence connections"
            icon={IconBolt}
            current={data?.durableObjects?.requests ?? null}
            limit={LIMITS.do_requests}
            unit="/ day"
            format={formatNumber}
            bgClass={css({ bg: 'amber.3' })}
          />

          <StatCard
            title="Vectorize Queries"
            description="Vector search queries"
            icon={IconDatabase}
            current={data?.vectorize?.queried ?? null}
            limit={LIMITS.vectorize_queries}
            unit="/ month"
            format={formatNumber}
            bgClass={css({ bg: 'pink.3' })}
          />

          <StatCard
            title="Vectorize Writes"
            description="Vector index updates"
            icon={IconDatabase}
            current={data?.vectorize?.written ?? null}
            limit={LIMITS.vectorize_writes}
            unit="/ month"
            format={formatNumber}
            bgClass={css({ bg: 'red.3' })}
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
  current: number | null;
  limit: number;
  unit: string;
  format?: (n: number) => string;
  bgClass: string;
}

function StatCard({ title, description, icon: Icon, current, limit, unit, format, bgClass }: StatCardProps) {
  const percentage = current === null ? null : Math.min((current / limit) * 100, 100);
  const displayCurrent = current === null ? 'Unavailable' : format ? format(current) : current;
  const displayLimit = format ? format(limit) : limit;

  return <ParkCard.Root variant="outline">
    <ParkCard.Body className={css({ display: 'grid', gap: '4' })}>
      <div data-part="usage-stat-summary" className={css({ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '3', minW: 0 })}>
        <div className={css({ display: 'flex', alignItems: 'start', gap: '3', minW: 0 })}>
          <div className={[css({ display: 'grid', placeItems: 'center', w: '10', h: '10', rounded: 'md', flexShrink: 0 }), bgClass].join(' ')}><Icon aria-hidden="true" /></div>
          <div className={css({ minW: 0 })}><ParkCard.Title>{title}</ParkCard.Title><ParkCard.Description>{description}</ParkCard.Description></div>
        </div>
        <div data-part="usage-stat-reading" className={css({ display: 'flex', alignItems: 'baseline', gap: '2', flexWrap: 'wrap', fontFamily: 'tabular', fontFeatureSettings: '"tnum" 1, "cv01" 1', fontVariantNumeric: 'tabular-nums' })}>
          <strong className={css({ fontSize: '2xl', lineHeight: 'tight' })}>{displayCurrent}</strong>{' '}<span className={css({ color: 'text.muted', fontSize: 'xs' })}>of {displayLimit} {unit}</span>
        </div>
      </div>
      {percentage === null
        ? <p className={css({ color: 'text.muted', fontSize: 'sm' })}>This reading was not returned by the provider.</p>
        : <ParkProgress value={percentage} label={`${percentage.toFixed(1)}% Used · Free Tier Limit`} />}
    </ParkCard.Body>
  </ParkCard.Root>;
}

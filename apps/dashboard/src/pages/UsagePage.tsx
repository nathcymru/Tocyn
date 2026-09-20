import { css } from '@luminatick/ui/styled-system/css';
import { ParkButton, ParkCard, ParkEmptyState, ParkInput, ParkProgress } from '@luminatick/ui/park';
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
    <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
      <div className={css({ display: 'flex', alignItems: 'center', gap: '3', p: '4', bg: isAuthError ? 'bg.subtle' : 'bg.surface' })}>
        <IconCircleExclamation className={css({"w":"4","h":"4","flexShrink":0})} />
        <div>
          <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>
            {isAuthError ? 'Cloudflare Credentials Required' : 'Update Cloudflare Credentials'}
          </h3>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed","display":"inline-flex","alignItems":"center","gap":"2"})}>
            {isAuthError
              ? 'To view your usage and costs, you need to provide your Cloudflare Account ID and an API Token with Account Analytics permissions.'
              : 'Update your Cloudflare Account ID or Analytics API Token. Leave the token field blank to keep your existing encrypted token.'}
          </p>
          <p className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4","color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
            Note: Storing these credentials in the database allows anyone with Admin access to view them, but it makes setup easier.
          </p>
        </div>
      </div>

      <div className={css({"minW":0})}>
        <div>
          <h4 className={css({"fontSize":"xl","fontWeight":"medium","lineHeight":"tight","color":"text.default"})}>1. How to get your API Token:</h4>
          <ol className={css({"minW":0})}>
            <li>
              Go to your <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className={css({"minW":0})}>Cloudflare API Tokens <IconArrowUpRightFromSquare className={css({"w":"4","h":"4","flexShrink":0})} /></a> dashboard.
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
          <h4 className={css({"fontSize":"xl","fontWeight":"medium","lineHeight":"tight","color":"text.default","maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})}>2. Enter your credentials:</h4>
          <div className={css({"display":"grid","gap":"4"})}>
            <div>
              <label htmlFor="cloudflare-account-id" className={css({"fontWeight":"medium","color":"text.default","display":"grid","gap":"1","fontSize":"sm"})}>
                Cloudflare Account ID
              </label>
              <ParkInput
                id="cloudflare-account-id"
                type="text"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="e.g., 1234567890abcdef1234567890abcdef"
                className={css({"w":"full"})}
              />
            </div>
            <div>
              <label htmlFor="cloudflare-api-token" className={css({"fontWeight":"medium","color":"text.default","display":"grid","gap":"1","fontSize":"sm"})}>
                Cloudflare API Token
              </label>
              <ParkInput
                id="cloudflare-api-token"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder={isAuthError ? "Enter your API token" : "•••••••• (Leave blank to keep existing)"}
                className={css({"w":"full"})}
              />
            </div>
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
    </div>
  );

  if (loading) {
    return <ParkEmptyState title="Loading usage data…" headingLevel={false} aria-busy="true" className={css({"py":"6"})} />;
  }

  if (isMasterKeyMissing) {
    return (
      <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})}>
        <div>
          <h1 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>
            <IconCreditCard className={css({"w":"4","h":"4","flexShrink":0})} />
            Usage & Costs
          </h1>
        </div>
        <div className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4"})}>
          <IconCircleExclamation className={css({"w":"4","h":"4","flexShrink":0})} />
          <div>
            <h3 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Critical: Missing Encryption Key</h3>
            <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed","display":"inline-flex","alignItems":"center","gap":"2"})}>
              Your server is missing the <code className={css({"overflowX":"auto","rounded":"md","bg":"bg.muted","p":"3","fontFamily":"mono","fontSize":"sm"})}>APP_MASTER_KEY</code> environment variable.
              This 32-character key is required to securely encrypt and decrypt API tokens and other sensitive settings.
            </p>
            <p className={css({"bg":"bg.surface","borderWidth":"1px","borderColor":"border.default","rounded":"lg","p":"4","color":"text.muted","fontSize":"sm","lineHeight":"relaxed"})}>
              Please ask your system administrator to add it to your server's environment configuration, then restart the application.
            </p>
            <ParkButton
              onClick={fetchUsage}
              className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
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
      <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6"})}>
        <div>
          <h1 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>
            <IconCreditCard className={css({"w":"4","h":"4","flexShrink":0})} />
            Usage & Costs
          </h1>
        </div>
        <div className={css({"p":"3","rounded":"md","bg":"bg.subtle","color":"text.default"})}>
          <p className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>Error loading usage data</p>
          <p className={css({"color":"text.muted","fontSize":"sm","lineHeight":"relaxed","display":"inline-flex","alignItems":"center","gap":"2"})}>{error}</p>
          <ParkButton
            onClick={fetchUsage}
            className={css({"display":"inline-flex","alignItems":"center","gap":"2"})}
          >
            Retry
          </ParkButton>
        </div>
      </div>
    );
  }

  return (
    <div className={css({"maxW":"6xl","mx":"auto","px":{"base":"4","md":"6"},"py":"6","display":"grid","gap":"6"})}>
      <div className={css({"display":"flex","alignItems":"center","justifyContent":"space-between","gap":"3","flexWrap":"wrap","mb":"6"})}>
        <div>
          <h1 className={css({"fontSize":"xl","fontWeight":"semibold","lineHeight":"tight","color":"text.default"})}>
            <IconCreditCard className={css({"w":"4","h":"4","flexShrink":0})} />
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
            current={(data?.d1?.rowsRead || 0) + (data?.d1?.rowsWritten || 0)}
            limit={LIMITS.d1_reads_writes}
            unit="/ day"
            format={formatNumber}
            bgClass={css({ bg: 'blue.3' })}
          />

          <StatCard
            title="R2 Operations (Class A)"
            description="Writes to storage"
            icon={IconHardDrive}
            current={data?.r2?.classAOperations || 0}
            limit={LIMITS.r2_class_a}
            unit="/ month"
            format={formatNumber}
            bgClass={css({ bg: 'blue.3' })}
          />

          <StatCard
            title="R2 Operations (Class B)"
            description="Reads from storage"
            icon={IconHardDrive}
            current={data?.r2?.classBOperations || 0}
            limit={LIMITS.r2_class_b}
            unit="/ month"
            format={formatNumber}
            bgClass={css({ bg: 'purple.3' })}
          />

          <StatCard
            title="Workers Requests"
            description="API calls, widget loads, pages"
            icon={IconChartLine}
            current={data?.workers?.requests || 0}
            limit={LIMITS.worker_requests}
            unit="/ day"
            format={formatNumber}
            bgClass={css({ bg: 'green.3' })}
          />

          <StatCard
            title="Workers AI Neurons"
            description="RAG, embedding, auto-responses"
            icon={IconMicrochip}
            current={data?.workersAi?.neurons || 0}
            limit={LIMITS.ai_neurons}
            unit="/ day"
            format={formatNumber}
            bgClass={css({ bg: 'colorPalette.3' })}
          />

          <StatCard
            title="Durable Objects Requests"
            description="Real-time presence connections"
            icon={IconBolt}
            current={data?.durableObjects?.requests || 0}
            limit={LIMITS.do_requests}
            unit="/ day"
            format={formatNumber}
            bgClass={css({ bg: 'amber.3' })}
          />

          <StatCard
            title="Vectorize Queries"
            description="Vector search queries"
            icon={IconDatabase}
            current={data?.vectorize?.queried || 0}
            limit={LIMITS.vectorize_queries}
            unit="/ month"
            format={formatNumber}
            bgClass={css({ bg: 'pink.3' })}
          />

          <StatCard
            title="Vectorize Writes"
            description="Vector index updates"
            icon={IconDatabase}
            current={data?.vectorize?.written || 0}
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
  current: number;
  limit: number;
  unit: string;
  format?: (n: number) => string;
  bgClass: string;
}

function StatCard({ title, description, icon: Icon, current, limit, unit, format, bgClass }: StatCardProps) {
  const percentage = Math.min((current / limit) * 100, 100);
  const displayCurrent = format ? format(current) : current;
  const displayLimit = format ? format(limit) : limit;

  return <ParkCard.Root variant="outline">
    <ParkCard.Body className={css({ display: 'grid', gap: '4' })}>
      <div className={css({ display: 'flex', alignItems: 'start', justifyContent: 'space-between', gap: '3' })}>
        <div className={css({ display: 'flex', alignItems: 'center', gap: '3', minW: 0 })}>
          <div className={[css({ display: 'grid', placeItems: 'center', w: '10', h: '10', rounded: 'md' }), bgClass].join(' ')}><Icon aria-hidden="true" /></div>
          <div><ParkCard.Title>{title}</ParkCard.Title><ParkCard.Description>{description}</ParkCard.Description></div>
        </div>
        <div className={css({ textAlign: 'right', flexShrink: 0 })}>
          <strong>{displayCurrent}</strong><p className={css({ color: 'text.muted', fontSize: 'xs' })}>of {displayLimit} {unit}</p>
        </div>
      </div>
      <ParkProgress value={percentage} label={`${percentage.toFixed(1)}% Used · Free Tier Limit`} />
    </ParkCard.Body>
  </ParkCard.Root>;
}

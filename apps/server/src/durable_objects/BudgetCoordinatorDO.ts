import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../bindings';
import {
  createBudgetOwnerAggregateState,
  reconcileOwnerAggregate,
  refreshBudgetOwnerAggregateAuthority,
  revokeBudgetOwnerAggregateAuthority,
  reserveOwnerAggregate,
  type BudgetOwnerAggregateState,
  type ReconcileOwnerAggregateInput,
  type ReserveOwnerAggregateInput,
  type TrustedBudgetCoordinatorAuthority,
  type TrustedBudgetCoordinatorRevocation,
} from '../budgets/owner-aggregate';

const STATE_KEY = 'budget-owner-aggregate-v1';

/**
 * One coordinator is named by server-derived deployment and owner-allocation
 * authority. It contains every tenant allocation sharing that ceiling. There
 * is no fetch handler and no application route: this internal RPC surface is
 * not a client protocol and does not authenticate claims. A later #64 slice
 * must load fresh verified policy/membership authority before calling it.
 */
export class BudgetCoordinatorDO extends DurableObject<Env> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  private async read(): Promise<BudgetOwnerAggregateState> {
    const value = await this.ctx.storage.get<BudgetOwnerAggregateState>(STATE_KEY);
    if (!value) throw new Error('budget coordinator has not received trusted authority');
    return value;
  }

  /** Internal bootstrap only; exactly one trusted authority snapshot is accepted. */
  async initializeFromTrustedAuthority(authority: TrustedBudgetCoordinatorAuthority): Promise<void> {
    const existing = await this.ctx.storage.get<BudgetOwnerAggregateState>(STATE_KEY);
    if (existing) throw new Error('budget coordinator authority is already initialized');
    await this.ctx.storage.put(STATE_KEY, createBudgetOwnerAggregateState(authority));
  }

  /** Refreshes only a server-loaded authority lease; revision changes freeze new reservations. */
  async refreshFromTrustedAuthority(authority: TrustedBudgetCoordinatorAuthority): Promise<void> {
    const existing = await this.ctx.storage.get<BudgetOwnerAggregateState>(STATE_KEY);
    if (!existing) {
      await this.ctx.storage.put(STATE_KEY, createBudgetOwnerAggregateState(authority));
      return;
    }
    await this.ctx.storage.put(STATE_KEY, refreshBudgetOwnerAggregateAuthority(existing, authority));
  }

  /** Delivery path for a verified D1 revocation; reconciliation stays available. */
  async revokeFromTrustedAuthority(revocation: TrustedBudgetCoordinatorRevocation): Promise<void> {
    const current = await this.read();
    await this.ctx.storage.put(STATE_KEY, revokeBudgetOwnerAggregateAuthority(current, revocation));
  }

  /** Caller supplies only already verified, server-derived inputs. */
  async reserveFromTrustedAuthority(input: ReserveOwnerAggregateInput): Promise<ReturnType<typeof reserveOwnerAggregate>['outcome']> {
    const current = await this.read();
    const result = reserveOwnerAggregate(current, input);
    await this.ctx.storage.put(STATE_KEY, result.state);
    return result.outcome;
  }

  /** Caller binds tenant and holder to authenticated terminal evidence before this RPC. */
  async reconcileFromTrustedAuthority(input: ReconcileOwnerAggregateInput): Promise<ReturnType<typeof reconcileOwnerAggregate>['outcome']> {
    const current = await this.read();
    const result = reconcileOwnerAggregate(current, input);
    await this.ctx.storage.put(STATE_KEY, result.state);
    return result.outcome;
  }

  /** Internal diagnostics/testing only; it reveals no tenant data to an HTTP client. */
  async inspectForTrustedRuntime(): Promise<BudgetOwnerAggregateState> {
    return this.read();
  }
}

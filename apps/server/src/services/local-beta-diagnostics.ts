import type { BetaRouteClass } from '../middleware/local-beta';
import type { BetaDenialCode } from '../types/local-beta';
type Outcome = BetaDenialCode | 'accepted' | 'rejected' | 'feature_disabled';
type Diagnostic = Readonly<{ at: number; route: BetaRouteClass; outcome: Outcome; revision: number }>;
const routes = new Set(['health','auth','configuration','conversation-read','conversation-write','upload','attachment','disabled']);
const outcomes = new Set(['beta_not_invited','beta_mutation_limit','beta_upload_limit','beta_intake_stopped','beta_admission_unavailable','accepted','rejected','feature_disabled']);
/** Local metadata only; no extensible payload, request IDs, paths or error strings. */
export class LocalBetaDiagnostics {
  private events: Diagnostic[]=[];
  constructor(private now: ()=>number=()=>Date.now()) {}
  record(route: BetaRouteClass, outcome: Outcome, revision: number) {
    if (!routes.has(route) || !outcomes.has(outcome) || !Number.isSafeInteger(revision) || revision < 0) return;
    this.prune();
    const event = Object.freeze({at:this.now(),route,outcome,revision});
    if (new TextEncoder().encode(JSON.stringify(event)).byteLength > 1024) return;
    this.events.push(event);
    if (this.events.length > 1000) this.events.shift();
  }
  private prune() { const cutoff=this.now()-24*60*60*1000; this.events=this.events.filter(e=>e.at>cutoff); }
  list() { this.prune(); return [...this.events]; }
  reset() { this.events=[]; }
}

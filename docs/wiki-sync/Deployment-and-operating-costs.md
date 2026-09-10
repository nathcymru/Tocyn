# Deployment and operating costs

## Current status

Tocyn does not currently have an owner-approved production deployment date. Repository Worker configuration is implementation/development configuration and may retain inherited Luminatick resource names; it is not proof that the corresponding Tocyn production resources have been provisioned.

Current server configuration references D1, R2, a Durable Object, Vectorize, Workers AI and a Cloudflare Workflow. There is no Queue or Cloudflare Calls binding in current `apps/server/wrangler.json`.

## Environment roadmap

- **M0.3 — Preview & Beta Environments:** isolated, reproducible private-beta deployment and rehearsal.
- **M0.4 — Production Readiness:** production cutover/rollback and operational acceptance after beta evidence.

Preview/beta must not unintentionally read or mutate production tenant data or reuse production credentials.

## Cost/capacity governance

Tocyn distinguishes minimum beta guardrails from the full long-term resource-budget system:

- #93 / N37 — private-beta resource guardrails (`beta-blocker`);
- #50 and #64 / N08 — broader application resource budgets;
- #90 / N34 — owner/tenant cost and capacity controls.

The first private beta therefore requires bounded resource safety, not completion of the full future commercial capacity-control programme.

## Cost estimates

Do not publish fixed operating-cost claims from architecture alone. Cloudflare/provider pricing, included quotas and workload shape change over time. A deployer must calculate current expected cost from:

- number/size of D1 operations and stored records;
- R2 stored bytes and operations;
- Vectorize dimensions/queries/storage;
- Workers AI model/token/compute usage;
- Durable Object request/storage/realtime behaviour;
- Workflow executions;
- Resend or replacement mail transport;
- future channel-provider charges;
- monitoring/logging and custom integrations.

Record resource consumption during implementation acceptance so later cost forecasts use measured behaviour rather than generic provider examples.

## Production boundary

No document, passing CI run, milestone date or cost estimate authorises deployment. Remote provisioning/migration/cutover remains controlled by the relevant M0.3/M0.4 issue and explicit owner authority.


## Current accepted boundary

Beta.1 is complete in local Wrangler simulations with captured authentication mail. No remote resources were deployed. #159 owns observability/SLOs; #160 owns deployment residency, including separate storage/processing claims; #42 retains production acceptance. Current forecasts and full budget dependencies are in [[Post-beta-master-baseline]].

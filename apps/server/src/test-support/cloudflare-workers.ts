/** Node-only Vitest shim. Production and Miniflare retain `cloudflare:workers`. */
export class DurableObject<Env = unknown> {
  constructor(
    public readonly ctx: DurableObjectState,
    public readonly env: Env,
  ) {}
}

export class WorkflowEntrypoint<Env = unknown> {
  constructor(public readonly env: Env) {}
}

import { Env } from '../src/bindings';
import { createLocalRuntime } from '../src/local-index';
import { LocalAuthCaptureTransport } from '../src/services/email/transport';

export { NotificationDO } from '../src/durable_objects/NotificationDO';

type LocalWorkflowEnv = Env & {
  LOCAL_TEST_CLOCK_MS?: string;
  LOCAL_TEST_CAPTURE_FAILURES?: string;
};

function boundedInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^\d{1,16}$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
  return parsed;
}

let runtime: ReturnType<typeof createLocalRuntime> | undefined;

/**
 * Test-only Wrangler entry. Its clock and capture failure count are selected at
 * Worker startup through a private temporary .dev.vars file, never by HTTP.
 */
export default {
  fetch(request: Request, env: LocalWorkflowEnv, ctx: ExecutionContext): Promise<Response> {
    if (!runtime) {
      const clockMs = boundedInteger(env.LOCAL_TEST_CLOCK_MS, Date.now(), 'LOCAL_TEST_CLOCK_MS');
      const failures = boundedInteger(env.LOCAL_TEST_CAPTURE_FAILURES, 0, 'LOCAL_TEST_CAPTURE_FAILURES');
      const capture = new LocalAuthCaptureTransport(() => clockMs);
      capture.failNext(failures);
      runtime = createLocalRuntime({ now: () => clockMs, capture });
    }
    return runtime.fetch(request, env, ctx);
  },
};

import { startIsolatedSnoozeReview } from './local-snooze-review-launcher';

const green = '\u001b[32m';
const cyan = '\u001b[36m';
const yellow = '\u001b[33m';
const red = '\u001b[31m';
const reset = '\u001b[0m';
const divider = '------------------------------------------------------------';

async function main(): Promise<void> {
  const flags = /^--interactive-credentials --port=(\d{4,5}) --window-minutes=(\d{1,4})$/.exec(process.argv.slice(2).join(' '));
  if (!flags || process.stdin.isTTY !== true || process.stdout.isTTY !== true || process.stderr.isTTY !== true
    || process.env.CI !== undefined) throw new Error('Use an interactive terminal with --interactive-credentials --port=8790 --window-minutes=360');
  const port = Number(flags[1]);
  const intervalWindowMs = Number(flags[2]) * 60_000;
  const review = await startIsolatedSnoozeReview({ port, intervalWindowMs });
  const operator = review.credentials.find(item => item.email === 'fixture.operator.a@example.test');
  if (!operator?.provisioningUri) { await review.dispose(); throw new Error('Synthetic operator enrollment is unavailable'); }

  process.stdout.write(`\n${divider}\n${green}LOCAL SNOOZE REVIEW READY${reset}\n${divider}\n\n`);
  process.stdout.write(`${cyan}API URL: ${review.origin}${reset}\n`);
  process.stdout.write(`${yellow}The current dashboard dev server may still point at port 8787.${reset}\n\n`);
  process.stdout.write(`${divider}\nSYNTHETIC OPERATOR\n${divider}\n\n`);
  process.stdout.write(`Email: ${operator.email}\nPassword: ${operator.password}\nMFA enrollment: ${operator.provisioningUri}\n\n`);
  process.stdout.write(`${divider}\nWHAT TO DO NEXT\n${divider}\n\n`);
  process.stdout.write('Use the isolated API for due-snooze review. Tenant A has a short snooze; tenant B is a future-due sentinel.\n');
  process.stdout.write(`${yellow}Budget window: ${flags[2]} minutes. The timer pauses safely when authority expires.${reset}\n\n`);
  process.stdout.write(`${divider}\nSTOP\n${divider}\n\nPress Ctrl+C. This removes the run-owned state.\n\n`);
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    void review.dispose().then(() => process.exit(signal === 'SIGINT' ? 130 : 143), () => process.exit(1));
  });
}

void main().catch(() => {
  process.stderr.write(`${red}Local snooze review did not start. Check the port and run the focused launcher test; private setup details were not printed.${reset}\n`);
  process.exitCode = 1;
});

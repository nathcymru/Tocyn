import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import registry from './rehearsal-process-registry.cjs';

export const FAILED_OUTPUT_LIMIT = 64 * 1024;

// Tooling-only diagnostics. Raw bytes never enter a shareable receipt or stdout.
export class FailedCommandOutput {
  constructor(directory) {
    registry.checkDirectory(directory);
    this.directory = directory;
    this.streams = { stdout: { tail: Buffer.alloc(0), observedBytes: 0 }, stderr: { tail: Buffer.alloc(0), observedBytes: 0 } };
    this.finished = false;
  }

  append(name, chunk) {
    if (this.finished) return;
    const stream = this.streams[name];
    const limit = FAILED_OUTPUT_LIMIT / 2;
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stream.observedBytes = Math.min(Number.MAX_SAFE_INTEGER, stream.observedBytes + bytes.length);
    stream.tail = bytes.length >= limit
      ? Buffer.from(bytes.subarray(bytes.length - limit))
      : Buffer.concat([stream.tail.subarray(Math.max(0, stream.tail.length + bytes.length - limit)), bytes]);
  }

  finish(failed) {
    if (this.finished) return this.result;
    this.finished = true;
    try {
      if (failed) {
        registry.checkDirectory(this.directory);
        const streams = Object.fromEntries(Object.entries(this.streams).map(([name, stream]) => [name, {
          observedBytes: stream.observedBytes, capturedBytes: stream.tail.length, truncated: stream.observedBytes > stream.tail.length,
        }]));
        const truncated = Object.values(streams).some(stream => stream.truncated);
        const header = JSON.stringify({ format: 'private-command-tail-v1', limitBytes: FAILED_OUTPUT_LIMIT, truncated, streams });
        writeFileSync(join(this.directory, `${randomUUID()}.log`), Buffer.concat([
          Buffer.from(`${header}\n[stdout]\n`), this.streams.stdout.tail,
          Buffer.from('\n[stderr]\n'), this.streams.stderr.tail,
        ]), { mode: 0o600, flag: 'wx' });
        this.result = { output: 'retained-private', truncated };
      }
      return this.result;
    } catch {
      throw new Error('Private command diagnostics could not be retained');
    } finally {
      for (const stream of Object.values(this.streams)) {
        stream.tail.fill(0);
        stream.tail = Buffer.alloc(0);
      }
    }
  }
}

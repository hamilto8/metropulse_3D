import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { REFERENCE_REVISION, stableStringify } from './baseline-fixtures.mjs';

const evidenceDirectory = path.resolve('docs/port_evidence/phase0/verification');
const workspacePath = process.cwd();
await mkdir(evidenceDirectory, { recursive: true });

function sanitize(value) {
  if (typeof value === 'string') return value.split(workspacePath).join('<workspace>');
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitize(child)]));
  }
  return value;
}

function run(id, command, args, { env = {}, parseJson = false } = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024
  });
  let report = null;
  let parseError = null;
  if (parseJson && result.stdout) {
    try {
      const jsonStart = result.stdout.indexOf('{');
      report = JSON.parse(jsonStart >= 0 ? result.stdout.slice(jsonStart) : result.stdout);
    } catch (error) {
      parseError = error.message;
    }
  }
  return {
    id,
    command: [command, ...args],
    exitCode: result.status,
    signal: result.signal,
    durationMs: Date.now() - started,
    stdout: parseJson && report ? null : sanitize(result.stdout),
    stderr: sanitize(result.stderr),
    parseError,
    report: sanitize(report)
  };
}

const checks = [];
checks.push(run('baseline-fixtures', 'npm', ['run', 'baseline:check']));
checks.push(run('unit', 'npm', ['test']));
checks.push(run('build', 'npm', ['run', 'build']));
checks.push(run(
  'browser',
  'npm',
  ['run', 'test:browser', '--', '--reporter=json'],
  { env: { PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL || 'chrome' }, parseJson: true }
));

for (const check of checks) {
  await writeFile(
    path.join(evidenceDirectory, `${check.id}.json`),
    stableStringify({ schemaVersion: 1, referenceRevision: REFERENCE_REVISION, ...check }),
    'utf8'
  );
}

const summary = {
  schemaVersion: 1,
  referenceRevision: REFERENCE_REVISION,
  capturedOn: '2026-08-07',
  passed: checks.every(check => check.exitCode === 0),
  checks: checks.map(check => ({
    id: check.id,
    command: check.command,
    exitCode: check.exitCode,
    durationMs: check.durationMs,
    artifact: `${check.id}.json`
  }))
};
await writeFile(
  path.join(evidenceDirectory, 'summary.json'),
  stableStringify(summary),
  'utf8'
);
process.stdout.write(stableStringify(summary));
if (!summary.passed) process.exitCode = 1;

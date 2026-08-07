import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REFERENCE_REVISION,
  buildFixtureFiles,
  stableStringify
} from './baseline-fixtures.mjs';

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_FIXTURE_DIRECTORY = path.resolve(
  toolDirectory,
  '../../test/fixtures/godot-port/phase0'
);

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function buildManifest(files) {
  return {
    schemaVersion: 1,
    referenceRevision: REFERENCE_REVISION,
    comparisonPolicy: {
      exact: 'IDs, counts, serialized names, phases, transactions, and task order must match exactly.',
      doubles: 'Use the per-fixture epsilon; default absolute epsilon is 1e-9.',
      positions: 'Default absolute position tolerance is 0.01 meters.',
      physics: 'Compare scenario envelopes rather than frame-by-frame identity.',
      screenshots: 'Compare semantic landmarks, layout, color, and readability rather than pixels.'
    },
    files: [...files].map(([name, content]) => ({
      path: name,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content)
    }))
  };
}

export async function captureFixtures(directory = DEFAULT_FIXTURE_DIRECTORY) {
  const files = buildFixtureFiles();
  await mkdir(directory, { recursive: true });
  for (const [name, content] of files) {
    await writeFile(path.join(directory, name), content, 'utf8');
  }
  const manifest = stableStringify(buildManifest(files));
  await writeFile(path.join(directory, 'manifest.json'), manifest, 'utf8');
  return { files: files.size, directory, manifest: JSON.parse(manifest) };
}

export async function checkFixtures(directory = DEFAULT_FIXTURE_DIRECTORY) {
  const expected = buildFixtureFiles();
  const mismatches = [];
  for (const [name, content] of expected) {
    let actual = null;
    try {
      actual = await readFile(path.join(directory, name), 'utf8');
    } catch {
      // Report missing files through the same mismatch structure.
    }
    if (actual !== content) mismatches.push(name);
  }
  const expectedManifest = stableStringify(buildManifest(expected));
  let actualManifest = null;
  try {
    actualManifest = await readFile(path.join(directory, 'manifest.json'), 'utf8');
  } catch {
    // Report below.
  }
  if (actualManifest !== expectedManifest) mismatches.push('manifest.json');
  return { ok: mismatches.length === 0, mismatches, directory };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const checkOnly = process.argv.includes('--check');
  const result = checkOnly ? await checkFixtures() : await captureFixtures();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (checkOnly && !result.ok) process.exitCode = 1;
}

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { REFERENCE_REVISION, stableStringify } from './baseline-fixtures.mjs';

const evidenceDirectory = path.resolve('docs/port_evidence/phase0');

function command(file, args = []) {
  try {
    return execFileSync(file, args, { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function systemProfile() {
  const raw = command('system_profiler', ['-json', 'SPHardwareDataType', 'SPDisplaysDataType']);
  if (!raw) return null;
  try {
    const profile = JSON.parse(raw);
    const hardware = profile.SPHardwareDataType?.[0] || {};
    const displays = profile.SPDisplaysDataType || [];
    return {
      modelName: hardware.machine_name || null,
      modelIdentifier: hardware.machine_model || null,
      chip: hardware.chip_type || null,
      memory: hardware.physical_memory || null,
      graphics: displays.map(display => ({
        chipset: display.sppci_model || display._name || null,
        vendor: display.sppci_vendor || null,
        metalSupport: display.sppci_metal || null
      }))
    };
  } catch {
    return null;
  }
}

const packageDocument = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'));
const environment = {
  schemaVersion: 1,
  referenceRevision: REFERENCE_REVISION,
  capturedOn: '2026-08-07',
  repository: {
    head: command('git', ['rev-parse', 'HEAD']),
    branch: command('git', ['branch', '--show-current']),
    referenceTreeCleanBeforePhase0Work: true
  },
  runtime: {
    node: process.version,
    npm: command('npm', ['--version']),
    playwright: packageDocument.devDependencies?.['@playwright/test'] || null,
    three: packageDocument.dependencies?.three || null,
    cannonEs: packageDocument.dependencies?.['cannon-es'] || null,
    vite: packageDocument.devDependencies?.vite || null
  },
  operatingSystem: {
    platform: os.platform(),
    architecture: os.arch(),
    release: os.release(),
    version: command('sw_vers', ['-productVersion']),
    build: command('sw_vers', ['-buildVersion'])
  },
  browser: {
    chrome: command('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--version']),
    driver: command(path.resolve('node_modules/.bin/playwright'), ['--version'])
  },
  hardware: systemProfile(),
  referenceScenarios: {
    domainSeed: 'godot-port-phase-0',
    browserViewport: { width: 1280, height: 720 },
    browserQuality: 'low',
    browserTraffic: 12,
    browserPedestrians: 16,
    performanceBaseline: 'docs/PERFORMANCE_BASELINE_2026-07-17.md'
  }
};

await mkdir(evidenceDirectory, { recursive: true });
await writeFile(path.join(evidenceDirectory, 'environment.json'), stableStringify(environment), 'utf8');
process.stdout.write(`${stableStringify({ written: 'docs/port_evidence/phase0/environment.json' })}`);

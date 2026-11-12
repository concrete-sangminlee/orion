/**
 * `orion plan` only generates and saves a plan. Plan execution had no code
 * that wrote files yet reported steps as completed, so it was removed; this
 * guards against it coming back as a facade.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mocks = vi.hoisted(() => ({ askAI: vi.fn(), prompt: vi.fn() }));

vi.mock('inquirer', () => ({ default: { prompt: mocks.prompt } }));
vi.mock('../ai-client.js', () => ({ askAI: mocks.askAI }));
vi.mock('../utils.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils.js')>()),
  loadProjectContext: () => '',
}));

import { planCommand } from '../commands/plan.js';
import { setPipelineOptions } from '../pipeline.js';

const PLAN = [
  '## Step 1: Add the route',
  '**Files:** src/routes.ts',
  '**Complexity:** Low',
  '**Description:** Add a /login route.',
  '',
  '## Step 2: Add tests',
  '**Files:** src/routes.test.ts',
  '**Complexity:** Medium',
  '**Description:** Cover the new route.',
  '',
].join('\n');

let tmp: string;
let savedCwd: string;
let logs: string[];

beforeEach(() => {
  savedCwd = process.cwd();
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orion-plan-')));
  process.chdir(tmp);
  mocks.askAI.mockReset().mockImplementation(async (_sys, _user, callbacks) => {
    callbacks.onComplete?.(PLAN);
    return PLAN;
  });
  mocks.prompt.mockReset();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
});

afterEach(() => {
  process.chdir(savedCwd);
  setPipelineOptions({ yes: false, json: false });
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('orion plan', () => {
  it('saves the plan and makes no further AI calls or reports under --yes', async () => {
    setPipelineOptions({ yes: true, json: true });

    await planCommand('Add login');

    expect(mocks.askAI).toHaveBeenCalledOnce();
    expect(fs.readdirSync(path.join(tmp, '.orion', 'plans'))).toHaveLength(1);
    const types = logs.map(l => { try { return JSON.parse(l).type; } catch { return null; } });
    expect(types).toContain('plan');
    expect(types).not.toContain('plan_execution');
  });

  it('does not offer to execute the plan', async () => {
    await planCommand('Add login');

    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(mocks.askAI).toHaveBeenCalledOnce();
  });
});

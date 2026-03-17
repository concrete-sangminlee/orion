/**
 * Orion CLI - Pipeline / Non-Interactive Mode
 * Supports --json, --yes, --no-color, --quiet flags for CI/CD pipelines
 */

export interface PipelineOptions {
  json: boolean;
  yes: boolean;
  noColor: boolean;
  quiet: boolean;
}

let pipelineOpts: PipelineOptions = { json: false, yes: false, noColor: false, quiet: false };

export function setPipelineOptions(opts: Partial<PipelineOptions>) {
  pipelineOpts = { ...pipelineOpts, ...opts };
}

export function getPipelineOptions(): PipelineOptions {
  return pipelineOpts;
}

export function jsonOutput(type: string, data: any) {
  if (pipelineOpts.json) {
    console.log(JSON.stringify({ type, data, timestamp: new Date().toISOString() }));
  }
}

import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const runId = 'w0' + randomBytes(6).toString('hex');
const name = 'billing-w0-localstack-' + runId;
const label = 'com.billing.test-safety';
const runLabel = 'com.billing.test-run-id';

function docker(args, allowFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 && !allowFailure) {
    throw new Error('Disposable LocalStack command failed: ' + (result.stderr || result.stdout).trim());
  }
  return result;
}

let created = false;
try {
  docker([
    'run', '--detach', '--name', name,
    '--label', label + '=true',
    '--label', runLabel + '=' + runId,
    '-p', '127.0.0.1::4566',
    '-e', 'SERVICES=ssm',
    'localstack/localstack:3',
  ]);
  created = true;
  const port = docker(['port', name, '4566/tcp']).stdout.match(/127\.0\.0\.1:(\d+)/)?.[1];
  if (!port) throw new Error('Disposable LocalStack port was not published on loopback.');
  const endpoint = 'http://127.0.0.1:' + port;
  let healthy = false;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const response = await fetch(endpoint + '/_localstack/health').catch(() => null);
    if (response?.ok) {
      const body = await response.json();
      if (body.services?.ssm === 'available' || body.services?.ssm === 'running') {
        healthy = true;
        break;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!healthy) throw new Error('Disposable LocalStack SSM did not become healthy.');
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/jest/bin/jest.js',
      '--runInBand',
      '--silent',
      '--runTestsByPath',
      'src/infrastructure/secrets/__tests__/aws-parameter-store-localstack.spec.ts',
    ],
    {
      env: {
        ...process.env,
        AWS_SSM_ENDPOINT: endpoint,
        AWS_REGION: 'us-east-1',
        AWS_ACCESS_KEY_ID: 'test',
        AWS_SECRET_ACCESS_KEY: 'test',
      },
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw new Error('Disposable LocalStack SSM test failed.');
  console.log('W0_DISPOSABLE_LOCALSTACK_SSM=PASS');
} finally {
  if (created) {
    const identity = docker([
      'inspect', '--format',
      '{{ index .Config.Labels "' + label + '" }}|{{ index .Config.Labels "' + runLabel + '" }}',
      name,
    ]).stdout.trim();
    if (identity !== 'true|' + runId) {
      throw new Error('Refusing to remove a container without matching disposable labels.');
    }
    docker(['rm', '--force', name]);
  }
}

import { readFileSync } from 'fs';
import { join } from 'path';

const API_ENTRYPOINT = 'dist/src/bootstrap/api.main.js';
const WORKER_ENTRYPOINT = 'dist/src/bootstrap/worker.main.js';

describe('compiled runtime entrypoint contract', () => {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  it('uses the Nest build output path for supported npm runtime scripts', () => {
    expect(packageJson.scripts?.['start:api']).toBe(`node ${API_ENTRYPOINT}`);
    expect(packageJson.scripts?.['start:worker']).toBe(`node ${WORKER_ENTRYPOINT}`);
  });

  it('uses the same API entrypoint in the production Docker image', () => {
    const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8').replace(/\\/g, '/');

    expect(dockerfile).toContain(`CMD ["node", "${API_ENTRYPOINT}"]`);
    expect(dockerfile).not.toContain('dist/bootstrap/api.main.js');
  });

  it('uses the same worker entrypoint in docker compose', () => {
    const compose = readFileSync(join(process.cwd(), 'docker-compose.yml'), 'utf8').replace(
      /\\/g,
      '/',
    );

    expect(compose).toContain(`command: ['node', '${WORKER_ENTRYPOINT}']`);
    expect(compose).not.toContain('dist/bootstrap/worker.main.js');
  });
});

const assert = require('assert');
const path = require('path');
require('reflect-metadata');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '..', '..', 'tsconfig.json')
});

const { ApiCompatController } = require('../api-compat.controller');

async function main() {
  const calls = { tasks: [], jobs: [] };
  const controller = new ApiCompatController(
    { getInternalHealth: async () => ({ status: 'ok', dependencies: {} }) },
    {
      client: {
        createTask: async (payload) => {
          calls.tasks.push(payload);
          return { id: 'task-1', status: 'queued', input: payload.input || {}, metadata: payload.metadata || {} };
        },
        getTask: async (id) => ({ id, status: 'queued', input: { workspace: 'workspace' }, metadata: {} }),
        listTasks: async () => [],
        cancelTask: async (id) => ({ id, status: 'cancelled' }),
        listArtifacts: async () => []
      }
    },
    {
      client: {
        createJob: async (payload) => {
          calls.jobs.push(payload);
          return { id: 'worker-job-1', ...payload };
        }
      }
    },
    {
      client: {
        listJobs: async () => [],
        createJob: async (payload) => payload,
        listAccounts: async () => [],
        checkLogin: async () => ({ success: true })
      }
    },
    {
      stream: () => 'event-stream'
    }
  );

  const request = { user: { actor: 'tester', roles: ['admin'], authMode: 'token' } };
  const materialFile = { buffer: Buffer.from('video') };
  const response = await controller.startMaterialDriven(
    { material: [materialFile] },
    { sourceTitle: 'demo', sourceBody: 'body', useSmartClip: 'true' },
    request
  );

  assert.strictEqual(response.success, true);
  assert.strictEqual(calls.tasks[0].type, 'material_driven');
  assert.strictEqual(calls.jobs[0].job_type, 'material_driven_worker');
  assert.strictEqual(calls.jobs[0].payload.source_post.title, 'demo');

  const xai = await controller.runXai({ partitionId: 'crypto' }, request);
  assert.strictEqual(xai.success, true);
  assert.strictEqual(calls.jobs[1].job_type, 'xai_worker');

  assert.strictEqual(controller.progress(request), 'event-stream');
  assert.strictEqual(controller.materialProgress(request), 'event-stream');
  assert.strictEqual(controller.saveXaiConfig({ partitions: ['crypto'] }, request).success, true);
  assert.strictEqual(controller.saveReviewConfig({ min_pass_score: 70 }, request).success, true);
  assert.strictEqual(controller.workflowConfig(request).success, true);
  assert.strictEqual(controller.saveWorkflowConfig({ mode: 'worker' }, request).success, true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

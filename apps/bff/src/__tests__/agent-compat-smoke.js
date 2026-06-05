const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('reflect-metadata');
require('ts-node').register({
  transpileOnly: true,
  project: path.join(__dirname, '..', '..', 'tsconfig.json')
});

const { AgentCompatController } = require('../agent-compat.controller');
const { AppModule } = require('../app.module');

async function main() {
  const calls = { tasks: [], jobs: [], publish: [] };
  const controller = new AgentCompatController(
    {
      client: {
        createTask: async (payload) => {
          calls.tasks.push(payload);
          return { id: `task-${calls.tasks.length}`, type: payload.type, status: payload.status, input: payload.input || {}, output: {}, metadata: payload.metadata || {} };
        },
        listTasks: async () => [],
        getTask: async (id) => ({ id, type: 'material_driven', status: 'queued', input: {}, output: {}, metadata: {} }),
        resumeTask: async (id) => ({ id, status: 'queued' })
      }
    },
    {
      client: {
        createJob: async (payload) => {
          calls.jobs.push(payload);
          return { id: `worker-${calls.jobs.length}`, ...payload };
        }
      }
    },
    {
      client: {
        createJob: async (payload) => {
          calls.publish.push(payload);
          return { id: 'publish-1', ...payload };
        },
        listJobs: async () => [],
        getJob: async (id) => ({ id }),
        confirmJob: async (id, payload) => ({ id, ...payload }),
        listAccounts: async () => [],
        checkLogin: async () => ({ status: 'unknown' })
      }
    }
  );
  const request = { user: { actor: 'agent-user', roles: ['admin'], authMode: 'token' } };

  assert(AppModule, 'AppModule should load with AgentCompatController registered');
  assert.strictEqual(controller.health(request).runtime, 'bff-fastapi-agent-compat');

  const video = await controller.generateVideoFromPost({ title: 'demo' }, request);
  assert.strictEqual(video.success, true);
  assert.strictEqual(video.jobId, 'task-1');
  assert.strictEqual(calls.tasks[0].type, 'material_driven');
  assert.strictEqual(calls.jobs[0].job_type, 'material_driven_worker');

  const review = await controller.reviewVideo('task-1', { videoPath: 'out.mp4' }, request);
  assert.strictEqual(review.success, true);
  assert.strictEqual(calls.jobs[1].job_type, 'review_worker');
  assert.strictEqual(calls.jobs[1].payload.source_task_id, 'task-1');

  const draft = await controller.createPublishDraft({ platform: 'wechat-channels' }, request);
  assert.strictEqual(draft.publishJobId, 'publish-1');

  const toolsPath = path.join(__dirname, '..', '..', '..', '..', 'mcp-server', 'src', 'tools.js');
  const toolsText = fs.readFileSync(toolsPath, 'utf8');
  assert(toolsText.includes("const DEFAULT_BASE_URL = 'http://127.0.0.1:3002'"));
  assert(!toolsText.includes("const DEFAULT_BASE_URL = 'http://127.0.0.1:3001'"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

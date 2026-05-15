#!/usr/bin/env node

const { spawnSync } = require('child_process');

const ZERO_SHA = /^0{40}$/;

const BLOCKED_RULES = [
  { label: 'runtime directory', pattern: /^(data|projects|frontend-dist)(\/|$)/ },
  { label: 'local secret/config', pattern: /^(\.env($|\.)|\.claude\/settings\.local\.json$)/ },
  { label: 'public runtime asset', pattern: /^public\/(presets|generated_avatar|xai_vertical_queue)(\/|$)/ },
  { label: 'public generated media/meta', pattern: /^public\/.*\.(mp4|mov|webm|m4a|wav|mp3|meta\.json)$/i },
  { label: 'publish runtime state', pattern: /^python\/publish\/(platform_config\.json|publish_jobs\.json|.*\.(db|db-shm|db-wal|bak|png)|browser_profiles\/|wechat_channels_tasks\/|wechat_channels_user_data\/)/i },
  { label: 'xai runtime output', pattern: /^python\/xai\/(result.*\.json|run_log.*\.txt|run_error.*\.log|xai_top10_cache\.json|xai_accounts\.json)$/i },
  { label: 'root generated artifact', pattern: /^(--input|aiman_audio\.json|aiman_subtitles\.json|background_generated\.png|temp_audio_analysis\.wav)$/i },
  { label: 'subtitle card output', pattern: /^subtitle_cards\// },
  { label: 'media/db/font artifact', pattern: /\.(mp4|mov|webm|m4a|wav|mp3|ttc|db|db-shm|db-wal|sqlite|sqlite3)$/i },
  { label: 'generated sqlite test db', pattern: /(^|\/)test_.*\.db(-shm|-wal)?$/i }
];

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const message = result.stderr || result.stdout || `git ${args.join(' ')} failed`;
    throw new Error(message.trim());
  }
  return result.stdout;
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function findBlocked(paths) {
  return unique(paths.map(normalizePath)).flatMap((filePath) => {
    const rule = BLOCKED_RULES.find(({ pattern }) => pattern.test(filePath));
    return rule ? [{ filePath, label: rule.label }] : [];
  });
}

function printBlocked(title, blocked) {
  console.error('');
  console.error(title);
  console.error('These files look like local runtime artifacts and must not be pushed:');
  for (const { filePath, label } of blocked.slice(0, 80)) {
    console.error(`  - ${filePath} (${label})`);
  }
  if (blocked.length > 80) {
    console.error(`  ...and ${blocked.length - 80} more`);
  }
  console.error('');
  console.error('Move them out of Git tracking or keep them ignored before committing/pushing.');
}

function getStagedPaths() {
  return runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMRT'])
    .split(/\r?\n/)
    .map(normalizePath);
}

function getPathsForPush(localSha, remoteSha) {
  if (!localSha || ZERO_SHA.test(localSha)) {
    return [];
  }

  const range = remoteSha && !ZERO_SHA.test(remoteSha)
    ? `${remoteSha}..${localSha}`
    : localSha;

  return runGit(['rev-list', '--objects', range])
    .split(/\r?\n/)
    .map((line) => {
      const spaceIndex = line.indexOf(' ');
      return spaceIndex >= 0 ? line.slice(spaceIndex + 1) : '';
    })
    .map(normalizePath);
}

function checkStaged() {
  const blocked = findBlocked(getStagedPaths());
  if (blocked.length > 0) {
    printBlocked('Runtime artifact guard blocked this commit.', blocked);
    process.exit(1);
  }
}

function checkPrePush() {
  const input = require('fs').readFileSync(0, 'utf8');
  const paths = [];

  for (const line of input.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    paths.push(...getPathsForPush(localSha, remoteSha));
  }

  const blocked = findBlocked(paths);
  if (blocked.length > 0) {
    printBlocked('Runtime artifact guard blocked this push.', blocked);
    process.exit(1);
  }
}

function main() {
  const mode = process.argv[2];
  if (mode === '--staged') {
    checkStaged();
    return;
  }
  if (mode === '--pre-push') {
    checkPrePush();
    return;
  }

  console.error('Usage: node scripts/check-runtime-artifacts.js --staged|--pre-push');
  process.exit(2);
}

main();

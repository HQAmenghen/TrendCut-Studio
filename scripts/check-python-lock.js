#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const requirementsPath = path.join(rootDir, 'python', 'pipeline', 'requirements.txt');
const lockPath = path.join(rootDir, 'requirements.lock.txt');

function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/_/g, '-');
}

function parseRequirementLine(line) {
  const stripped = String(line || '').trim();
  if (!stripped || stripped.startsWith('#') || stripped.startsWith('-r ')) return null;
  const withoutMarker = stripped.split(';', 1)[0].trim();
  const match = withoutMarker.match(/^([A-Za-z0-9_.-]+)/);
  if (!match) return null;
  return normalizeName(match[1]);
}

function parseRequirementNames(filePath) {
  return new Set(
    fs.readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map(parseRequirementLine)
      .filter(Boolean)
  );
}

function main() {
  const declared = parseRequirementNames(requirementsPath);
  const locked = parseRequirementNames(lockPath);
  const missing = Array.from(declared).filter((name) => !locked.has(name)).sort();

  if (missing.length) {
    console.error('requirements.lock.txt is missing direct Python requirements:');
    for (const name of missing) console.error(`- ${name}`);
    console.error('\nRegenerate or edit requirements.lock.txt before committing.');
    process.exit(1);
  }

  console.log(`Python lock covers ${declared.size} direct requirements.`);
}

main();

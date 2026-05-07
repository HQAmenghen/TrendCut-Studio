const fs = require('fs');
const path = require('path');

function listFiles(dirPath) {
  try {
    return fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(dirPath, entry.name))
      .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-CN'));
  } catch (_error) {
    return [];
  }
}

function resolvePresetFile(dirPath, requestedName = '') {
  const files = listFiles(dirPath);
  if (!requestedName) {
    const firstFile = files[0] || '';
    return {
      path: firstFile,
      resolvedName: firstFile ? path.basename(firstFile) : '',
      matchType: firstFile ? 'first_available' : 'missing'
    };
  }

  const exactPath = path.join(dirPath, requestedName);
  try {
    if (fs.existsSync(exactPath) && fs.statSync(exactPath).isFile()) {
      return {
        path: exactPath,
        resolvedName: requestedName,
        matchType: 'exact'
      };
    }
  } catch (_error) {}

  const requestedStem = path.basename(requestedName, path.extname(requestedName)).toLowerCase();
  const sameStemMatches = files.filter((filePath) => {
    const fileStem = path.basename(filePath, path.extname(filePath)).toLowerCase();
    return fileStem === requestedStem;
  });

  if (sameStemMatches.length === 1) {
    return {
      path: sameStemMatches[0],
      resolvedName: path.basename(sameStemMatches[0]),
      matchType: 'stem'
    };
  }

  return {
    path: '',
    resolvedName: '',
    matchType: 'missing'
  };
}

module.exports = {
  resolvePresetFile
};

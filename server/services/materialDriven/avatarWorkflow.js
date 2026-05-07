const CHINESE_CHARACTER_PATTERN = /[\u4e00-\u9fff]/u;
const ASCII_ENGLISH_PATTERN = /^[A-Za-z0-9\s.,!?'"():;%+\-/]+$/u;
const CONTROL_TAG_PATTERN = /<\|[^|>]+?\|>/gu;
const HASH_END_MARKER_PATTERN = /#{3,}\s*结束\s*#{3,}/gu;
const TERMINAL_PUNCTUATION_PATTERN = /[。！？!?…]$/u;
const TRAILING_END_MARKER_PATTERN = /(?:^|[。！？!?…，,\s])结束[。！？!?…\s]*$/u;
const AVATAR_SPEECH_CLASS_PATTERN = /^FL_CosyVoice3_/u;
const PROMPT_LIST_GENERATOR_CLASS_PATTERN = /^PromptListGenerator$/u;
const MAX_TEXT_LINK_DEPTH = 8;
const TTS_CHUNK_CHAR_LIMIT = 200;
const DEFAULT_EXTERNAL_AUDIO_NODE_ID = '6';
const DEFAULT_AVATAR_IMAGE_NODE_ID = '180';
const EXTERNAL_AUDIO_CONSUMER_NODE_IDS = ['9', '129', '136', '151'];
const EMBEDDED_TTS_CLASS_PATTERNS = [
  /^FL_CosyVoice3_/u,
  /^PromptListGenerator$/u,
  /^AudioListCombine$/u
];
const EMBEDDED_TTS_NODE_IDS = new Set(['277', '278', '283', '287', '291']);

function stripInlineControlMarkers(text) {
  return String(text || '')
    .replace(CONTROL_TAG_PATTERN, ' ')
    .replace(HASH_END_MARKER_PATTERN, ' ');
}

function stripTrailingEndMarker(text) {
  let cleaned = String(text || '').trim();
  let previous = '';
  while (cleaned && cleaned !== previous) {
    previous = cleaned;
    cleaned = cleaned.replace(TRAILING_END_MARKER_PATTERN, '').trim();
  }
  return cleaned;
}

function normalizeNarrationSentence(text) {
  let cleaned = stripInlineControlMarkers(text)
    .replace(/\s+/gu, ' ')
    .trim();

  cleaned = stripTrailingEndMarker(cleaned);
  cleaned = cleaned.replace(/^[，、；\s]+|[，、；\s]+$/gu, '').trim();

  if (!cleaned) return '';
  if (!TERMINAL_PUNCTUATION_PATTERN.test(cleaned)) {
    cleaned += '。';
  }
  return cleaned;
}

function sanitizeNarrationText(text) {
  const normalized = stripInlineControlMarkers(String(text || ''))
    .replace(/\r\n?/g, '\n');

  const lines = normalized
    .split(/\n+/)
    .map((line) => normalizeNarrationSentence(line))
    .filter(Boolean);

  let cleaned = lines.join('').trim();
  cleaned = stripTrailingEndMarker(cleaned);
  cleaned = cleaned.replace(/[，、；\s]+$/gu, '').trim();

  if (cleaned && !TERMINAL_PUNCTUATION_PATTERN.test(cleaned)) {
    cleaned += '。';
  }
  return cleaned;
}

function prepareNarrationTextForAvatarWorkflow(text) {
  const workflowText = stripInlineControlMarkers(String(text || ''))
    .replace(/\r\n?/g, '\n')
    .trim();
  const validationText = sanitizeNarrationText(workflowText);

  return {
    workflowText,
    validationText,
    isUsable: Boolean(validationText)
  };
}

function preservePromptListNarrationText(text) {
  const normalized = stripInlineControlMarkers(String(text || ''))
    .replace(/\r\n?/g, '\n');

  const lines = normalized
    .split(/\n+/)
    .map((line) => {
      const cleaned = stripTrailingEndMarker(line.trim())
        .replace(/^[，、；\s]+|[，、；\s]+$/gu, '')
        .trim();
      return cleaned;
    })
    .filter(Boolean);

  return stripTrailingEndMarker(lines.join('\n')).trim();
}

function inferTargetLanguage(text) {
  const cleaned = String(text || '').trim();
  if (!cleaned) return 'auto';
  if (CHINESE_CHARACTER_PATTERN.test(cleaned)) return 'zh';
  if (ASCII_ENGLISH_PATTERN.test(cleaned)) return 'en';
  return 'auto';
}

function isWorkflowLink(value) {
  return Array.isArray(value) && typeof value[0] === 'string' && value[0].trim();
}

function cloneWorkflowNode(node = {}) {
  return {
    ...node,
    inputs: {
      ...(node.inputs || {})
    },
    _meta: node._meta
      ? {
        ...node._meta
      }
      : node._meta
  };
}

function resolveAvatarSpeechNodeId(workflow) {
  if (!workflow || typeof workflow !== 'object') return '';
  const legacySpeechNode = workflow?.['278'];
  if (
    legacySpeechNode?.inputs &&
    (
      AVATAR_SPEECH_CLASS_PATTERN.test(String(legacySpeechNode.class_type || '')) ||
      legacySpeechNode.inputs.reference_audio ||
      legacySpeechNode.inputs.speed !== undefined ||
      legacySpeechNode.inputs.seed !== undefined
    )
  ) {
    return '278';
  }

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!AVATAR_SPEECH_CLASS_PATTERN.test(String(node?.class_type || ''))) continue;
    if (node?.inputs?.reference_audio) {
      return nodeId;
    }
  }

  return '';
}

function resolveNarrationTextNodeId(workflow, startNodeId, depth = 0) {
  if (!workflow || !startNodeId || depth > MAX_TEXT_LINK_DEPTH) return '';
  const node = workflow[startNodeId];
  if (!node?.inputs) return '';

  if (typeof node.inputs.text === 'string') {
    return startNodeId;
  }

  if (isWorkflowLink(node.inputs.text)) {
    const nextNodeId = String(node.inputs.text[0] || '').trim();
    if (!nextNodeId || nextNodeId === startNodeId) return '';
    return resolveNarrationTextNodeId(workflow, nextNodeId, depth + 1);
  }

  return '';
}

function resolveTextInputChain(workflow, startNodeId) {
  const chain = [];
  let nodeId = String(startNodeId || '').trim();
  let depth = 0;
  while (workflow?.[nodeId]?.inputs && depth <= MAX_TEXT_LINK_DEPTH) {
    if (chain.includes(nodeId)) break;
    chain.push(nodeId);

    const textInput = workflow[nodeId].inputs.text;
    if (!isWorkflowLink(textInput)) break;

    nodeId = String(textInput[0] || '').trim();
    if (!nodeId) break;
    depth += 1;
  }
  return chain;
}

function resolvePromptListNodeId(workflow, startNodeId) {
  const chain = resolveTextInputChain(workflow, startNodeId);
  for (const nodeId of chain.slice(1, -1)) {
    const node = workflow?.[nodeId];
    if (PROMPT_LIST_GENERATOR_CLASS_PATTERN.test(String(node?.class_type || ''))) {
      return nodeId;
    }
  }
  return '';
}

function splitLongSentence(sentence, maxChars = TTS_CHUNK_CHAR_LIMIT) {
  const text = String(sentence || '').trim();
  if (!text) return [];
  if (text.length <= maxChars) return [text];

  const clauses = text.match(/[^，,；;、]+[，,；;、]?/gu) || [text];
  const chunks = [];
  let current = '';

  for (const clause of clauses.map((item) => item.trim()).filter(Boolean)) {
    if ((current + clause).length <= maxChars) {
      current += clause;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = '';
    }
    if (clause.length <= maxChars) {
      current = clause;
      continue;
    }
    for (let index = 0; index < clause.length; index += maxChars) {
      chunks.push(clause.slice(index, index + maxChars));
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function partitionChunksByCount(parts, chunkCount, maxChars) {
  const lengths = parts.map((part) => part.length);
  const prefix = [0];
  for (const length of lengths) {
    prefix.push(prefix[prefix.length - 1] + length);
  }

  const totalLength = prefix[prefix.length - 1];
  const targetLength = totalLength / chunkCount;
  const dp = Array.from({ length: parts.length + 1 }, () => Array(chunkCount + 1).fill(Infinity));
  const previous = Array.from({ length: parts.length + 1 }, () => Array(chunkCount + 1).fill(-1));
  dp[0][0] = 0;

  for (let chunkIndex = 1; chunkIndex <= chunkCount; chunkIndex += 1) {
    for (let end = chunkIndex; end <= parts.length; end += 1) {
      for (let start = chunkIndex - 1; start < end; start += 1) {
        const segmentLength = prefix[end] - prefix[start];
        if (segmentLength > maxChars || !Number.isFinite(dp[start][chunkIndex - 1])) continue;
        const score = dp[start][chunkIndex - 1] + ((segmentLength - targetLength) ** 2);
        if (score < dp[end][chunkIndex]) {
          dp[end][chunkIndex] = score;
          previous[end][chunkIndex] = start;
        }
      }
    }
  }

  if (!Number.isFinite(dp[parts.length][chunkCount])) return null;

  const chunks = [];
  let end = parts.length;
  let chunkIndex = chunkCount;
  while (chunkIndex > 0) {
    const start = previous[end][chunkIndex];
    if (start < 0) return null;
    chunks.unshift(parts.slice(start, end).join(''));
    end = start;
    chunkIndex -= 1;
  }
  return chunks;
}

function partitionBalancedChunks(parts, maxChars = TTS_CHUNK_CHAR_LIMIT) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const minimumChunkCount = Math.max(1, Math.ceil(totalLength / maxChars));
  for (let chunkCount = minimumChunkCount; chunkCount <= parts.length; chunkCount += 1) {
    const chunks = partitionChunksByCount(parts, chunkCount, maxChars);
    if (chunks) return chunks;
  }
  return parts;
}

function chunkNarrationForTts(text, maxChars = TTS_CHUNK_CHAR_LIMIT) {
  const sentences = String(text || '')
    .match(/[^。！？!?…]+[。！？!?…]?/gu) || [];
  const parts = [];

  for (const rawSentence of sentences.map((item) => item.trim()).filter(Boolean)) {
    const sentenceParts = splitLongSentence(rawSentence, maxChars);
    for (const sentence of sentenceParts) {
      parts.push(sentence);
    }
  }

  if (!parts.length) return [String(text || '').trim()].filter(Boolean);
  return partitionBalancedChunks(parts, maxChars);
}

function resolveAvatarSeed(workflow, explicitSeed) {
  const normalizedExplicitSeed = Number(explicitSeed);
  if (Number.isFinite(normalizedExplicitSeed) && normalizedExplicitSeed >= 0) {
    return Math.floor(normalizedExplicitSeed);
  }
  return undefined;
}

function prepareAvatarSpeechWorkflow(workflow, options = {}) {
  const speechNodeId = resolveAvatarSpeechNodeId(workflow);
  if (!workflow || !speechNodeId) {
    throw new Error('数字人工作流缺少 CosyVoice 语音节点');
  }

  const preservedPromptListText = options.preservePromptListLines === true
    ? preservePromptListNarrationText(options.narrationText)
    : '';
  const sanitizedText = sanitizeNarrationText(options.narrationText);
  const effectiveText = preservedPromptListText || sanitizedText;
  if (!effectiveText) {
    throw new Error('缺少可用口播文案');
  }

  const preparedWorkflow = {
    ...workflow
  };
  const speechNode = cloneWorkflowNode(workflow[speechNodeId]);
  const narrationTextNodeId = resolveNarrationTextNodeId(workflow, speechNodeId);
  const promptListNodeId = resolvePromptListNodeId(workflow, speechNodeId);
  const promptListDelimiter = promptListNodeId
    ? String(workflow[promptListNodeId]?.inputs?.delimiter || '\n')
    : '\n';
  const narrationTextForWorkflow = promptListNodeId
    ? (preservedPromptListText || chunkNarrationForTts(sanitizedText).join(promptListDelimiter || '\n'))
    : sanitizedText;

  if (narrationTextNodeId && narrationTextNodeId !== speechNodeId) {
    const narrationTextNode = cloneWorkflowNode(workflow[narrationTextNodeId]);
    narrationTextNode.inputs.text = narrationTextForWorkflow;
    preparedWorkflow[narrationTextNodeId] = narrationTextNode;
  } else {
    speechNode.inputs.text = narrationTextForWorkflow;
  }

  speechNode.inputs = {
    ...(speechNode.inputs || {}),
    text_frontend: speechNode.inputs?.text_frontend !== false
  };

  if (String(speechNode.class_type || '').includes('CrossLingual')) {
    speechNode.inputs.target_language = String(
      options.targetLanguage || speechNode.inputs.target_language || inferTargetLanguage(effectiveText)
    );
  }

  if (options.overrideSpeechSeed === true) {
    const resolvedSeed = resolveAvatarSeed(workflow, options.seed);
    if (Number.isFinite(resolvedSeed) && resolvedSeed >= 0) {
      speechNode.inputs.seed = resolvedSeed;
    }
  }

  if (promptListNodeId) {
    preparedWorkflow[promptListNodeId] = cloneWorkflowNode(workflow[promptListNodeId]);
  }

  preparedWorkflow[speechNodeId] = speechNode;
  return preparedWorkflow;
}

function shouldRemoveEmbeddedTtsNode(nodeId, node) {
  if (EMBEDDED_TTS_NODE_IDS.has(String(nodeId))) return true;
  const classType = String(node?.class_type || '');
  return EMBEDDED_TTS_CLASS_PATTERNS.some((pattern) => pattern.test(classType));
}

function prepareAvatarExternalAudioWorkflow(workflow, options = {}) {
  if (!workflow || typeof workflow !== 'object') {
    throw new Error('数字人工作流无效');
  }

  const audioNodeId = String(options.audioNodeId || DEFAULT_EXTERNAL_AUDIO_NODE_ID);
  const imageNodeId = String(options.imageNodeId || DEFAULT_AVATAR_IMAGE_NODE_ID);
  if (!workflow[audioNodeId]?.inputs) {
    throw new Error(`数字人工作流缺少音频输入节点: ${audioNodeId}`);
  }

  const preparedWorkflow = {};
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (shouldRemoveEmbeddedTtsNode(nodeId, node)) continue;
    preparedWorkflow[nodeId] = cloneWorkflowNode(node);
  }

  preparedWorkflow[audioNodeId].inputs.audio = String(options.audioName || preparedWorkflow[audioNodeId].inputs.audio || '');
  if (!preparedWorkflow[audioNodeId].inputs.audio) {
    throw new Error('缺少可用口播音频');
  }

  if (options.imageName !== undefined) {
    if (!preparedWorkflow[imageNodeId]?.inputs) {
      throw new Error(`数字人工作流缺少人物图片节点: ${imageNodeId}`);
    }
    preparedWorkflow[imageNodeId].inputs.image = String(options.imageName || '');
  }

  for (const nodeId of EXTERNAL_AUDIO_CONSUMER_NODE_IDS) {
    if (preparedWorkflow[nodeId]?.inputs?.audio !== undefined) {
      preparedWorkflow[nodeId].inputs.audio = [audioNodeId, 0];
    }
  }

  return preparedWorkflow;
}

module.exports = {
  inferTargetLanguage,
  prepareAvatarExternalAudioWorkflow,
  prepareAvatarSpeechWorkflow,
  prepareNarrationTextForAvatarWorkflow,
  resolveAvatarSpeechNodeId,
  resolveAvatarSeed,
  sanitizeNarrationText
};

const CHINESE_CHARACTER_PATTERN = /[\u4e00-\u9fff]/u;
const ASCII_ENGLISH_PATTERN = /^[A-Za-z0-9\s.,!?'"():;%+\-/]+$/u;
const BILL_IDENTIFIER_LEADING_PREFIX_PATTERN = '(?:H\\.?\\s*R\\.?|H\\.?\\s*B\\.?|S\\.?\\s*B\\.?|A\\.?\\s*B\\.?|S\\.|H\\.?\\s*RES\\.?|S\\.?\\s*RES\\.?|H\\.?\\s*J\\.?\\s*RES\\.?|S\\.?\\s*J\\.?\\s*RES\\.?|H\\.?\\s*CON\\.?\\s*RES\\.?|S\\.?\\s*CON\\.?\\s*RES\\.?)';
const BILL_IDENTIFIER_FOLLOWUP_PREFIX_PATTERN = '(?:H\\.?\\s*R\\.?|H\\.?\\s*B\\.?|S\\.?\\s*B\\.?|A\\.?\\s*B\\.?|S\\.?|H\\.?\\s*RES\\.?|S\\.?\\s*RES\\.?|H\\.?\\s*J\\.?\\s*RES\\.?|S\\.?\\s*J\\.?\\s*RES\\.?|H\\.?\\s*CON\\.?\\s*RES\\.?|S\\.?\\s*CON\\.?\\s*RES\\.?)';
const BILL_IDENTIFIER_PATTERN = new RegExp(
  `\\b(${BILL_IDENTIFIER_LEADING_PREFIX_PATTERN})\\s*(\\d{1,6})(?:\\s*[,，]\\s*(${BILL_IDENTIFIER_FOLLOWUP_PREFIX_PATTERN}\\s*)?(\\d{1,6}))+`,
  'giu'
);
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
const DIGIT_SPEECH_MAP = {
  0: '零',
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '七',
  8: '八',
  9: '九'
};
const NUMBER_TOKEN_PATTERN = '[+-]?\\d+(?:[,.]\\d+)*';
const NUMBER_BOUNDARY_PATTERN = '(?<![A-Za-z0-9_])';
const CURRENCY_SYMBOL_UNIT_MAP = {
  $: '美元',
  '¥': '元',
  '￥': '元',
  '€': '欧元',
  '£': '英镑'
};
const CURRENCY_UNIT_PATTERN = [
  '万美元',
  '亿美元',
  '人民币',
  '元人民币',
  '美元',
  '美金',
  '欧元',
  '英镑',
  '日元',
  '港币',
  '港元',
  '澳元',
  '加元',
  '新台币',
  '台币',
  '韩元',
  '新币',
  '泰铢',
  '卢布',
  '比特币',
  '以太坊',
  'USDT',
  'BTC',
  'ETH',
  '元',
  '块钱',
  '块'
].join('|');
const MEASURE_UNIT_PATTERN = [
  '个百分点',
  '个基点',
  '平方公里',
  '平方米',
  '个点',
  '摄氏度',
  '小时',
  '分钟',
  '秒钟',
  '个月',
  '星期',
  '公里',
  '千米',
  '公斤',
  '千克',
  '周',
  '天',
  '年',
  '月',
  '日',
  '次',
  '倍',
  '人',
  '名',
  '位',
  '家公司',
  '家',
  '条',
  '枚',
  '笔',
  '单',
  '台',
  '部',
  '篇',
  '份',
  '只',
  '张',
  '套',
  '件',
  '吨',
  '克',
  '米',
  '度'
].join('|');
const NUMBER_UNIT_PATTERN = `${CURRENCY_UNIT_PATTERN}|${MEASURE_UNIT_PATTERN}`;
const FULL_DATE_PATTERN = new RegExp(`${NUMBER_BOUNDARY_PATTERN}((?:19|20)\\d{2})年(\\d{1,2})月(\\d{1,2})(日|号)?`, 'gu');
const YEAR_PATTERN = new RegExp(`${NUMBER_BOUNDARY_PATTERN}((?:19|20)\\d{2})年`, 'gu');
const PERCENT_PATTERN = new RegExp(`${NUMBER_BOUNDARY_PATTERN}(${NUMBER_TOKEN_PATTERN})\\s*(%|％)`, 'gu');
const RANGE_WITH_UNIT_PATTERN = new RegExp(
  `${NUMBER_BOUNDARY_PATTERN}(${NUMBER_TOKEN_PATTERN})\\s*(?:-|－|—|–|~|～|至|到)\\s*(${NUMBER_TOKEN_PATTERN})\\s*(${NUMBER_UNIT_PATTERN})`,
  'giu'
);
const PREFIX_CURRENCY_PATTERN = new RegExp(`([\\$¥￥€£])\\s*(${NUMBER_TOKEN_PATTERN})`, 'gu');
const SUFFIX_CURRENCY_PATTERN = new RegExp(`${NUMBER_BOUNDARY_PATTERN}(${NUMBER_TOKEN_PATTERN})\\s*(${CURRENCY_UNIT_PATTERN})`, 'giu');
const SUFFIX_MEASURE_PATTERN = new RegExp(`${NUMBER_BOUNDARY_PATTERN}(${NUMBER_TOKEN_PATTERN})\\s*(${MEASURE_UNIT_PATTERN})`, 'gu');

function spellDigitsForSpeech(value) {
  return String(value || '')
    .split('')
    .map((digit) => DIGIT_SPEECH_MAP[digit] || digit)
    .join('');
}

function convertFourDigitGroupToChinese(value) {
  const number = Number(value || 0);
  if (!number) return '';
  const digits = [
    Math.floor(number / 1000) % 10,
    Math.floor(number / 100) % 10,
    Math.floor(number / 10) % 10,
    number % 10
  ];
  const units = ['千', '百', '十', ''];
  let result = '';
  let zeroPending = false;

  digits.forEach((digit, index) => {
    if (!digit) {
      if (result) zeroPending = true;
      return;
    }
    if (zeroPending) {
      result += '零';
      zeroPending = false;
    }
    if (!(digit === 1 && units[index] === '十' && !result)) {
      result += DIGIT_SPEECH_MAP[digit];
    }
    result += units[index];
  });

  return result;
}

function integerTextToChinese(integerText) {
  const cleaned = String(integerText || '').replace(/\D/gu, '').replace(/^0+(?=\d)/u, '');
  if (!cleaned || /^0+$/u.test(cleaned)) return '零';
  if (cleaned.length > 16) return spellDigitsForSpeech(cleaned);

  const chunks = [];
  for (let end = cleaned.length; end > 0; end -= 4) {
    chunks.unshift(cleaned.slice(Math.max(0, end - 4), end));
  }

  const largeUnits = ['', '万', '亿', '万亿'];
  let result = '';
  let zeroPending = false;

  chunks.forEach((chunk, index) => {
    const chunkValue = Number(chunk);
    const unitIndex = chunks.length - index - 1;
    if (!chunkValue) {
      if (result) zeroPending = true;
      return;
    }

    if (result && (zeroPending || chunkValue < 1000)) {
      result += '零';
    }
    result += `${convertFourDigitGroupToChinese(chunkValue)}${largeUnits[unitIndex] || ''}`;
    zeroPending = false;
  });

  return result.replace(/零+/gu, '零').replace(/零$/u, '') || '零';
}

function parseLocalizedNumber(numberText) {
  let normalized = String(numberText || '').trim().replace(/\s+/gu, '');
  let sign = '';
  if (/^[+-]/u.test(normalized)) {
    sign = normalized[0];
    normalized = normalized.slice(1);
  }

  let integerPart = normalized;
  let decimalPart = '';
  let match = normalized.match(/^(\d{1,3}(?:,\d{3})+)\.(\d+)$/u);
  if (match) {
    integerPart = match[1].replace(/,/gu, '');
    decimalPart = match[2];
  } else {
    match = normalized.match(/^(\d{1,3}(?:\.\d{3})+),(\d+)$/u);
    if (match) {
      integerPart = match[1].replace(/\./gu, '');
      decimalPart = match[2];
    } else if (/^\d{1,3}(?:[,.]\d{3})+$/u.test(normalized)) {
      integerPart = normalized.replace(/[,.]/gu, '');
    } else if (/^\d+\.\d+$/u.test(normalized)) {
      [integerPart, decimalPart] = normalized.split('.');
    } else if (/^\d+,\d+$/u.test(normalized) && !/^\d{1,3},\d{3}$/u.test(normalized)) {
      [integerPart, decimalPart] = normalized.split(',');
    } else {
      integerPart = normalized.replace(/\D/gu, '');
    }
  }

  decimalPart = String(decimalPart || '').replace(/0+$/u, '');
  return {
    sign,
    integerPart: integerPart.replace(/^0+(?=\d)/u, '') || '0',
    decimalPart
  };
}

function localizedNumberToChinese(numberText) {
  const parsed = parseLocalizedNumber(numberText);
  let result = integerTextToChinese(parsed.integerPart);
  if (parsed.decimalPart) {
    result += `点${spellDigitsForSpeech(parsed.decimalPart)}`;
  }
  if (parsed.sign === '-' && result !== '零') {
    result = `负${result}`;
  }
  return result;
}

function createNormalization(kind, raw, reading) {
  return {
    kind,
    raw: String(raw || ''),
    reading: String(reading || '')
  };
}

function normalizeNumericExpressionsForSpeech(text) {
  const normalizations = [];
  let speechText = String(text || '');

  function record(kind, raw, reading) {
    if (raw !== reading) {
      normalizations.push(createNormalization(kind, raw, reading));
    }
    return reading;
  }

  speechText = speechText.replace(FULL_DATE_PATTERN, (raw, year, month, day, suffix) => record(
    'date',
    raw,
    `${spellDigitsForSpeech(year)}年${integerTextToChinese(month)}月${integerTextToChinese(day)}${suffix || '日'}`
  ));

  speechText = speechText.replace(YEAR_PATTERN, (raw, year) => record(
    'year',
    raw,
    `${spellDigitsForSpeech(year)}年`
  ));

  speechText = speechText.replace(PERCENT_PATTERN, (raw, numberText) => record(
    'percent',
    raw,
    `百分之${localizedNumberToChinese(numberText)}`
  ));

  speechText = speechText.replace(RANGE_WITH_UNIT_PATTERN, (raw, startNumber, endNumber, unit) => record(
    'range',
    raw,
    `${localizedNumberToChinese(startNumber)}到${localizedNumberToChinese(endNumber)}${unit}`
  ));

  speechText = speechText.replace(PREFIX_CURRENCY_PATTERN, (raw, symbol, numberText) => record(
    'currency',
    raw,
    `${localizedNumberToChinese(numberText)}${CURRENCY_SYMBOL_UNIT_MAP[symbol] || ''}`
  ));

  speechText = speechText.replace(SUFFIX_CURRENCY_PATTERN, (raw, numberText, unit) => record(
    'currency',
    raw,
    `${localizedNumberToChinese(numberText)}${unit}`
  ));

  speechText = speechText.replace(SUFFIX_MEASURE_PATTERN, (raw, numberText, unit) => record(
    'measure',
    raw,
    `${localizedNumberToChinese(numberText)}${unit}`
  ));

  return {
    text: speechText,
    normalizations
  };
}

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

function normalizeBillIdentifierPrefix(prefix) {
  return String(prefix || '')
    .replace(/\./gu, '')
    .replace(/\s+/gu, '')
    .toUpperCase()
    .split('')
    .join(' ');
}

function spellBillIdentifierNumberForSpeech(numberText) {
  return spellDigitsForSpeech(numberText);
}

function normalizeBillIdentifiersForSpeech(text) {
  return String(text || '').replace(BILL_IDENTIFIER_PATTERN, (match, prefix, firstNumber) => {
    const normalizedPrefix = normalizeBillIdentifierPrefix(prefix);
    const parts = [`${normalizedPrefix} ${spellBillIdentifierNumberForSpeech(firstNumber)}`];
    const restPattern = new RegExp(`[,，]\\s*(${BILL_IDENTIFIER_FOLLOWUP_PREFIX_PATTERN}\\s*)?(\\d{1,6})`, 'giu');
    let restMatch = restPattern.exec(match);
    while (restMatch) {
      const [, nextPrefix, nextNumber] = restMatch;
      const normalizedNextPrefix = nextPrefix
        ? `${normalizeBillIdentifierPrefix(nextPrefix)} `
        : '';
      parts.push(`${normalizedNextPrefix}${spellBillIdentifierNumberForSpeech(nextNumber)}`);
      restMatch = restPattern.exec(match);
    }
    return parts.join('，');
  });
}

function prepareNarrationTextForSpeech(text) {
  return prepareNarrationTextForSpeechWithMeta(text).speechText;
}

function prepareNarrationTextForSpeechWithMeta(text) {
  const displayText = sanitizeNarrationText(text);
  const billSafeText = normalizeBillIdentifiersForSpeech(displayText);
  const normalized = normalizeNumericExpressionsForSpeech(billSafeText);

  return {
    displayText,
    speechText: normalized.text,
    normalizations: normalized.normalizations,
    changed: displayText !== normalized.text
  };
}

function prepareNarrationTextForAvatarWorkflow(text) {
  const workflowText = stripInlineControlMarkers(String(text || ''))
    .replace(/\r\n?/g, '\n')
    .trim();
  const validationText = sanitizeNarrationText(workflowText);
  const speech = prepareNarrationTextForSpeechWithMeta(workflowText);

  return {
    workflowText,
    validationText,
    speechText: speech.speechText,
    speechNormalizations: speech.normalizations,
    speechTextChanged: speech.changed,
    isUsable: Boolean(speech.speechText)
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
  normalizeBillIdentifiersForSpeech,
  prepareAvatarExternalAudioWorkflow,
  prepareAvatarSpeechWorkflow,
  prepareNarrationTextForAvatarWorkflow,
  prepareNarrationTextForSpeech,
  prepareNarrationTextForSpeechWithMeta,
  resolveAvatarSpeechNodeId,
  resolveAvatarSeed,
  sanitizeNarrationText
};

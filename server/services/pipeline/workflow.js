const fs = require('fs');

function readWorkflow(workflowPath) {
  return JSON.parse(fs.readFileSync(workflowPath, 'utf-8'));
}

function writeWorkflow(workflowPath, workflow) {
  fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2), 'utf-8');
}

function extractWorkflowConfig(workflow) {
  return {
    positivePrompt: workflow['114']?.inputs?.positive_prompt || '',
    negativePrompt: workflow['114']?.inputs?.negative_prompt || '',
    steps: workflow['27']?.inputs?.steps ?? 4,
    cfg: workflow['27']?.inputs?.cfg ?? 1,
    shift: workflow['27']?.inputs?.shift ?? 11,
    scheduler: workflow['27']?.inputs?.scheduler || 'dpm++_sde',
    seed: workflow['27']?.inputs?.seed ?? 1,
    audioSpeed: workflow['278']?.inputs?.speed ?? 1,
    scaleLength: workflow['186']?.inputs?.value ?? 1024,
    frameRate: workflow['151']?.inputs?.frame_rate ?? 25,
    outputCrf: workflow['151']?.inputs?.crf ?? 19,
    outputFormat: workflow['151']?.inputs?.format || 'video/h264-mp4',
    videoModel: workflow['176']?.inputs?.model || '',
    lora: workflow['269']?.inputs?.lora || '',
    loraStrength: workflow['269']?.inputs?.strength ?? 0.5
  };
}

function applyWorkflowConfig(workflow, config = {}) {
  if (config.positivePrompt !== undefined) workflow['114'].inputs.positive_prompt = String(config.positivePrompt);
  if (config.negativePrompt !== undefined) workflow['114'].inputs.negative_prompt = String(config.negativePrompt);
  if (config.steps !== undefined) workflow['27'].inputs.steps = Number(config.steps);
  if (config.cfg !== undefined) workflow['27'].inputs.cfg = Number(config.cfg);
  if (config.shift !== undefined) workflow['27'].inputs.shift = Number(config.shift);
  if (config.scheduler !== undefined) workflow['27'].inputs.scheduler = String(config.scheduler);
  if (config.seed !== undefined) {
    const seed = Number(config.seed);
    workflow['27'].inputs.seed = seed;
    workflow['278'].inputs.seed = seed;
  }
  if (config.audioSpeed !== undefined) workflow['278'].inputs.speed = Number(config.audioSpeed);
  if (config.scaleLength !== undefined) workflow['186'].inputs.value = Number(config.scaleLength);
  if (config.frameRate !== undefined) workflow['151'].inputs.frame_rate = Number(config.frameRate);
  if (config.outputCrf !== undefined) workflow['151'].inputs.crf = Number(config.outputCrf);
  if (config.outputFormat !== undefined) workflow['151'].inputs.format = String(config.outputFormat);
  if (config.videoModel !== undefined) workflow['176'].inputs.model = String(config.videoModel);
  if (config.lora !== undefined) workflow['269'].inputs.lora = String(config.lora);
  if (config.loraStrength !== undefined) workflow['269'].inputs.strength = Number(config.loraStrength);
  return workflow;
}

module.exports = {
  applyWorkflowConfig,
  extractWorkflowConfig,
  readWorkflow,
  writeWorkflow
};

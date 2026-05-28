const DEFAULT_RUNNINGHUB_WORKFLOW_ID = process.env.RUNNINGHUB_WORKFLOW_ID || '2059563685034680322';

const RUNNINGHUB_INFINITETALK_3INPUT = {
  workflowPresetFile: 'runninghub_infinitetalk_3input_1024x576.json',
  workflowId: DEFAULT_RUNNINGHUB_WORKFLOW_ID,
  audioNodeId: '6',
  audioFieldName: 'audio',
  imageNodeId: '180',
  imageFieldName: 'image',
  poseNodeId: '279',
  poseFieldName: 'video',
  outputNodeId: '151',
  width: 1024,
  height: 576,
  fps: 25
};

module.exports = {
  DEFAULT_RUNNINGHUB_WORKFLOW_ID,
  RUNNINGHUB_INFINITETALK_3INPUT
};

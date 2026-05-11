const fs = require('fs');
const path = require('path');

describe('material-driven RunningHub frontend config surface', () => {
  const setupPanelSource = fs.readFileSync(
    path.join(__dirname, '../components/materialDriven/MaterialDrivenSetupPanel.vue'),
    'utf8'
  );
  const composableSource = fs.readFileSync(
    path.join(__dirname, '../composables/useMaterialDriven.js'),
    'utf8'
  );
  const nodeConfigPanelSource = fs.readFileSync(
    path.join(__dirname, '../components/materialDriven/MaterialDrivenNodeConfigPanel.vue'),
    'utf8'
  );
  const workspaceSource = fs.readFileSync(
    path.join(__dirname, '../components/MaterialDrivenWorkspace.vue'),
    'utf8'
  );
  const planPreviewSource = fs.readFileSync(
    path.join(__dirname, '../components/materialDriven/MaterialDrivenPlanPreview.vue'),
    'utf8'
  );

  test('does not expose RunningHub internal workflow parameters in the operator UI', () => {
    [
      'API Base URL',
      'RunningHub Workflow ID',
      '音频节点',
      '图片节点',
      '音频字段',
      '图片字段',
      '输出节点',
      '实例类型',
      'Run Path',
      '个人队列',
      '保留秒数',
      'RunningHub API Key',
      'API Key'
    ].forEach((label) => {
      expect(setupPanelSource).not.toContain(label);
      expect(nodeConfigPanelSource).not.toContain(label);
    });
  });

  test('submits only the selected render provider for RunningHub', () => {
    [
      "formData.append('runningHubApiKey'",
      "formData.append('runningHubBaseUrl'",
      "formData.append('runningHubWorkflowId'",
      "formData.append('runningHubRunPath'",
      "formData.append('runningHubInstanceType'",
      "formData.append('runningHubUsePersonalQueue'",
      "formData.append('runningHubRetainSeconds'",
      "formData.append('runningHubAudioNodeId'",
      "formData.append('runningHubAudioFieldName'",
      "formData.append('runningHubImageNodeId'",
      "formData.append('runningHubImageFieldName'",
      "formData.append('runningHubOutputNodeId'"
    ].forEach((snippet) => {
      expect(composableSource).not.toContain(snippet);
    });

    expect(composableSource).toContain("formData.append('renderProvider'");
    expect(composableSource).toContain('renderProvider');
    expect(composableSource).toContain('JSON.stringify({');
    expect(composableSource).not.toContain('runningHubBaseUrl: renderProvider');
  });

  test('exposes RunningHub as a render provider option', () => {
    expect(setupPanelSource).toContain('RunningHub Workflow API');
    expect(setupPanelSource).toContain('renderProvider');
  });

  test('uses provider-aware labels for RunningHub node checks', () => {
    expect(nodeConfigPanelSource).toContain('providerTitle');
    expect(nodeConfigPanelSource).toContain('testedUrlLabel');
    expect(nodeConfigPanelSource).toContain('RunningHub 工作流配置');
    expect(nodeConfigPanelSource).toContain('工作流地址');
    expect(nodeConfigPanelSource).not.toContain('探测 ComfyUI');
  });

  test('checks selected provider and keeps RunningHub copy out of ComfyUI probing flow', () => {
    expect(composableSource).toContain("renderProvider,");
    expect(composableSource).toContain('getRenderProviderLabel(renderProvider)');
    expect(composableSource).not.toContain('ComfyUI 连通测试成功');
    expect(composableSource).not.toContain('ComfyUI 连通性检测失败');
  });

  test('keeps restored narration visible when only snake_case text is available', () => {
    expect(composableSource).toContain('payload.full_text');
    expect(workspaceSource).toContain('props.narrationSummary?.full_text');
    expect(workspaceSource).toContain('hasNarrationPreview');
    expect(planPreviewSource).toContain('v-if="hasNarrationPreview"');
  });

  test('keeps narration/status cards readable in light theme', () => {
    const metricCardRule = workspaceSource.match(/\.mini-status-card strong \{[\s\S]*?\}/)?.[0] || '';
    expect(metricCardRule).toContain('color: var(--strong-text);');
    expect(metricCardRule).not.toContain('-webkit-text-fill-color: transparent');
  });
});

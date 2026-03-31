import { ref, computed } from 'vue';

export function useVideoReview() {
  const config = ref(null);
  const reviewing = ref(false);
  const currentReview = ref(null);
  const loading = ref(false);

  async function loadConfig() {
    loading.value = true;
    try {
      const res = await fetch('/api/review/config');
      const data = await res.json();
      if (data.success) {
        config.value = data.config;
      }
    } catch (err) {
      console.error('加载审核配置失败:', err);
    } finally {
      loading.value = false;
    }
  }

  async function updateConfig(newConfig) {
    loading.value = true;
    try {
      const res = await fetch('/api/review/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      const data = await res.json();
      if (data.success) {
        config.value = data.config;
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      console.error('更新审核配置失败:', err);
      return { success: false, error: err.message };
    } finally {
      loading.value = false;
    }
  }

  async function reviewVideo(videoPath, assetId) {
    reviewing.value = true;
    currentReview.value = null;
    try {
      const res = await fetch('/api/review/video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath, assetId })
      });
      const data = await res.json();

      if (data.success) {
        if (data.skipped) {
          return {
            success: true,
            skipped: true,
            reason: data.reason
          };
        }

        currentReview.value = data.result;
        return {
          success: true,
          reviewId: data.reviewId,
          result: data.result
        };
      }

      return {
        success: false,
        error: data.error || '审核失败'
      };
    } catch (err) {
      console.error('视频审核失败:', err);
      return {
        success: false,
        error: err.message
      };
    } finally {
      reviewing.value = false;
    }
  }

  async function skipReview(videoPath, assetId, reason = 'manual_skip') {
    try {
      const res = await fetch('/api/review/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPath, assetId, reason })
      });
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('跳过审核失败:', err);
      return { success: false, error: err.message };
    }
  }

  async function getHistory(limit = 50, offset = 0) {
    try {
      const res = await fetch(`/api/review/history?limit=${limit}&offset=${offset}`);
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('获取审核历史失败:', err);
      return { success: false, error: err.message };
    }
  }

  async function getReview(reviewId) {
    try {
      const res = await fetch(`/api/review/${reviewId}`);
      const data = await res.json();
      return data;
    } catch (err) {
      console.error('获取审核记录失败:', err);
      return { success: false, error: err.message };
    }
  }

  const isEnabled = computed(() => config.value?.enabled || false);
  const minPassScore = computed(() => config.value?.min_pass_score || 70);

  return {
    config,
    reviewing,
    currentReview,
    loading,
    isEnabled,
    minPassScore,
    loadConfig,
    updateConfig,
    reviewVideo,
    skipReview,
    getHistory,
    getReview
  };
}

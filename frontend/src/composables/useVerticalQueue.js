import { computed, ref } from 'vue';
import axios from 'axios';

export function useVerticalQueue() {
  const loading = ref(false);
  const error = ref('');
  const status = ref(null);

  const jobs = computed(() => status.value?.jobs || []);
  const stats = computed(() => ({
    running: status.value?.running || 0,
    queued: status.value?.queued || 0,
    concurrency: status.value?.concurrency || 0,
    total: jobs.value.length
  }));

  const refresh = async () => {
    loading.value = true;
    error.value = '';
    try {
      const res = await axios.get('/api/xai-top10/vertical-jobs');
      status.value = res.data?.status || null;
    } catch (err) {
      error.value = err.response?.data?.error || err.message;
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    error,
    status,
    jobs,
    stats,
    refresh
  };
}

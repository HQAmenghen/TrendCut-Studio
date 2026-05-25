<template>
  <nav class="top-nav" aria-label="Console navigation">
    <div v-for="section in sections" :key="section.label" class="nav-section">
      <div class="section-label">{{ section.label }}</div>
      <div class="nav-pills">
        <button
          v-for="item in section.items"
          :key="item.key"
          type="button"
          class="nav-pill"
          :class="{ active: item.key === activeKey }"
          :title="item.desc"
          @click="$emit('change', item.key)"
        >
          <component :is="item.icon" v-if="item.icon" class="nav-icon" aria-hidden="true" />
          <span>{{ item.title }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  items: { type: Array, default: () => [] },
  activeKey: { type: String, default: '' }
});

defineEmits(['change']);

const sections = computed(() => {
  const groups = [];
  const groupMap = new Map();
  for (const item of props.items) {
    const label = item.section || '工作区';
    if (!groupMap.has(label)) {
      const group = { label, items: [] };
      groups.push(group);
      groupMap.set(label, group);
    }
    groupMap.get(label).items.push(item);
  }
  return groups;
});
</script>

<style scoped>
.top-nav {
  display: grid;
  gap: 12px;
  border: 1px solid var(--line-soft);
  border-radius: 8px;
  background: var(--panel);
  padding: 12px;
  box-shadow: var(--shadow);
}

.nav-section {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
}

.section-label {
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--muted);
}

.nav-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.nav-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  border: 1px solid var(--line-soft);
  border-radius: 7px;
  padding: 7px 10px;
  background: var(--panel-soft);
  color: var(--muted);
  cursor: pointer;
  font-size: 13px;
  font-weight: 800;
  transition: border-color 0.16s ease, background 0.16s ease, color 0.16s ease;
}

.nav-pill:hover {
  border-color: var(--line-strong);
  color: var(--strong-text);
}

.nav-pill.active {
  border-color: var(--brand-a);
  background: var(--nav-active-bg);
  color: var(--strong-text);
  box-shadow: inset 0 0 0 1px rgba(20, 184, 166, 0.12);
}

.nav-icon {
  width: 15px;
  height: 15px;
  flex: none;
}

@media (max-width: 760px) {
  .nav-section {
    grid-template-columns: 1fr;
  }
}
</style>

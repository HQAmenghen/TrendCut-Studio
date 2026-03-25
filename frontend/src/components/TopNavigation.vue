<template>
  <div class="top-nav">
    <button
      v-for="item in items"
      :key="item.key"
      type="button"
      class="nav-card"
      :class="{ active: item.key === activeKey }"
      @click="$emit('change', item.key)"
    >
      <div class="nav-kicker">{{ item.kicker }}</div>
      <div class="nav-title">{{ item.title }}</div>
      <div class="nav-desc">{{ item.desc }}</div>
    </button>
  </div>
</template>

<script setup>
defineProps({
  items: { type: Array, default: () => [] },
  activeKey: { type: String, default: '' }
});

defineEmits(['change']);
</script>

<style scoped>
.top-nav {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.nav-card {
  border: 1px solid var(--line-soft);
  border-radius: 20px;
  padding: 14px 16px;
  background: var(--panel-subtle);
  color: inherit;
  text-align: left;
  cursor: pointer;
  box-shadow: var(--shadow);
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease, background .18s ease;
}

.nav-card:hover {
  transform: translateY(-1px);
  border-color: #64748b;
}

.nav-card.active {
  border-color: rgba(139, 92, 246, 0.72);
  background: var(--nav-active-bg);
  box-shadow: var(--nav-active-shadow);
}

.nav-kicker {
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}

.nav-title {
  margin-top: 7px;
  font-size: 16px;
  font-weight: 800;
  color: var(--strong-text);
}

.nav-desc {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.55;
  color: var(--muted);
}
</style>

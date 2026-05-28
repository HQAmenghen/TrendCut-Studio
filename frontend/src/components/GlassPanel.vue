<template>
  <component :is="as" class="glass-panel" :class="[variantClass, { 'glass-panel-overflow': allowOverflow }]">
    <slot />
  </component>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  as: {
    type: String,
    default: 'section'
  },
  variant: {
    type: String,
    default: 'default'
  },
  allowOverflow: {
    type: Boolean,
    default: false
  }
});

const variantClass = computed(() => `glass-panel-${props.variant}`);
</script>

<style scoped>
.glass-panel {
  position: relative;
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--glass-panel-strong) 58%, transparent), color-mix(in srgb, var(--glass-panel) 86%, transparent)),
    var(--panel);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(26px) saturate(1.28);
  padding: 16px;
  overflow: hidden;
  transition: border-color 0.22s ease, box-shadow 0.22s ease, transform 0.22s ease, background 0.22s ease;
}

.glass-panel::before {
  content: "";
  position: absolute;
  inset: 0 12px auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--glass-highlight), transparent);
  opacity: 0.82;
  pointer-events: none;
}

.glass-panel::after {
  content: "";
  position: absolute;
  inset: 0;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.34), transparent 38%),
    radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--brand-a) 10%, transparent), transparent 38%);
  opacity: 0.72;
  pointer-events: none;
}

.glass-panel > :deep(*) {
  position: relative;
  z-index: 1;
}

.glass-panel:hover {
  border-color: color-mix(in srgb, var(--brand-a) 24%, var(--glass-border));
  transform: translateY(-1px);
}

.glass-panel-soft {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--glass-panel-strong) 56%, transparent), var(--glass-panel)),
    var(--panel);
}

.glass-panel-plain {
  background: var(--glass-panel);
}

.glass-panel-overflow {
  overflow: visible;
}
</style>

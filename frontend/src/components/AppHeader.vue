<template>
  <header class="page-header">
    <div class="header-copy">
      <div class="header-kicker">TrendCut Studio</div>
      <h1>热点剪辑工作室</h1>
    </div>
    <div class="status-card">
      <div class="theme-toggle">
        <button type="button" :class="{ active: themeMode === 'dark' }" @click="$emit('update-theme', 'dark')">
          <Moon class="status-icon" aria-hidden="true" />
          暗色
        </button>
        <button type="button" :class="{ active: themeMode === 'light' }" @click="$emit('update-theme', 'light')">
          <Sun class="status-icon" aria-hidden="true" />
          亮色
        </button>
      </div>
      <div class="status-online" :class="engineStatusClass">
        <span class="dot"></span>
        <strong>{{ engineStatusLabel }}</strong>
      </div>
    </div>
  </header>
</template>

<script setup>
import { Moon, Sun } from 'lucide-vue-next';

defineProps({
  themeMode: {
    type: String,
    required: true
  },
  engineStatusLabel: {
    type: String,
    required: true
  },
  engineStatusClass: {
    type: String,
    default: 'ok'
  }
});

defineEmits(['update-theme']);
</script>

<style scoped>
.page-header {
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  border: 1px solid color-mix(in srgb, var(--line-soft) 76%, transparent);
  border-radius: 12px;
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--glass-panel-strong) 92%, var(--brand-a) 8%), var(--glass-panel)),
    var(--panel);
  box-shadow: var(--glass-shadow);
  overflow: hidden;
  padding: 16px 18px;
  backdrop-filter: blur(22px) saturate(1.25);
  animation: header-enter 0.5s ease both;
  transition: border-color 0.24s ease, box-shadow 0.24s ease, background 0.24s ease, transform 0.24s ease;
}

.page-header::before {
  content: "";
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(var(--glass-highlight) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--glass-highlight) 72%, transparent) 1px, transparent 1px);
  background-size: 34px 34px;
  mask-image: linear-gradient(90deg, #000 0%, transparent 78%);
  opacity: 0.5;
}

.page-header::after {
  content: "";
  position: absolute;
  inset: 1px 18px auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--glass-highlight), transparent);
  pointer-events: none;
}

.header-copy,
.status-card {
  position: relative;
  z-index: 1;
}

.header-kicker {
  color: var(--brand-a);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 850;
}

h1 {
  margin: 8px 0 0;
  font-size: 28px;
  line-height: 1.12;
  color: var(--strong-text);
}

.status-card {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  border-radius: 10px;
  border: 1px solid var(--glass-border);
  background: var(--glass-panel);
  backdrop-filter: blur(18px) saturate(1.22);
  padding: 10px 14px;
  box-shadow: 0 12px 26px color-mix(in srgb, var(--brand-a) 10%, transparent), 0 1px 0 var(--glass-highlight) inset;
}

.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 9px;
  border: 1px solid var(--glass-border);
  background: color-mix(in srgb, var(--input-bg) 76%, transparent);
  padding: 4px;
  box-shadow: 0 1px 0 var(--glass-highlight) inset;
}

.theme-toggle button {
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--muted);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 6px 10px;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.22s ease, color 0.22s ease, transform 0.22s ease, box-shadow 0.22s ease;
}

.theme-toggle button:hover {
  color: var(--strong-text);
  transform: translateY(-1px);
}

.theme-toggle button.active {
  color: #04110f;
  background: linear-gradient(135deg, color-mix(in srgb, var(--brand-a) 88%, white), var(--brand-b));
  box-shadow: 0 8px 16px color-mix(in srgb, var(--brand-a) 18%, transparent), 0 1px 0 rgba(255, 255, 255, 0.48) inset;
}

.status-online {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  color: var(--ok);
  font-weight: 800;
}

.status-online.warn {
  color: var(--warn);
}

.status-online.danger {
  color: var(--danger);
}

.dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  background: currentColor;
  box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 16%, transparent);
  animation: status-pulse 1.8s ease-in-out infinite;
}

.status-icon {
  width: 15px;
  height: 15px;
}

@keyframes header-enter {
  from {
    opacity: 0;
    transform: translateY(-8px) scale(0.996);
    filter: blur(3px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
    filter: blur(0);
  }
}

@keyframes status-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 5px color-mix(in srgb, currentColor 14%, transparent);
  }
  50% {
    box-shadow: 0 0 0 8px color-mix(in srgb, currentColor 6%, transparent);
  }
}

@media (max-width: 760px) {
  .page-header {
    flex-direction: column;
    padding: 14px;
  }

  .status-card {
    width: 100%;
    justify-content: space-between;
    flex-wrap: wrap;
  }
}
</style>

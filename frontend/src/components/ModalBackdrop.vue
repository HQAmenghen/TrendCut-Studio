<template>
  <div class="picker-backdrop" @click.self="$emit('close')">
    <slot />
  </div>
</template>

<script setup>
defineEmits(['close']);
</script>

<style scoped>
.picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 20px;
  background:
    radial-gradient(circle at 50% 18%, var(--modal-backdrop-glow), transparent 34%),
    var(--modal-backdrop-bg);
  backdrop-filter: var(--modal-backdrop-filter);
  animation: backdrop-enter 0.24s ease both;
}

:slotted(.source-modal) {
  animation: modal-enter 0.32s cubic-bezier(0.2, 0.9, 0.2, 1) both;
}

@keyframes backdrop-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes modal-enter {
  from {
    opacity: 0;
    transform: translateY(14px) scale(0.982);
    filter: blur(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
    filter: blur(0);
  }
}

@media (max-width: 720px) {
  .picker-backdrop {
    padding: 12px;
  }
}
</style>

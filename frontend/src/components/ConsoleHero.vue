<template>
  <section class="hero">
    <div>
      <div class="kicker">{{ kicker }}</div>
      <h1>{{ title }}</h1>
      <p>{{ description }}</p>
    </div>
    <div class="stats">
      <div v-for="item in stats" :key="item.label" class="stat-card">
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <p>{{ item.tip }}</p>
      </div>
    </div>
  </section>
</template>

<script setup>
defineProps({
  kicker: { type: String, default: '' },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  stats: { type: Array, default: () => [] }
});
</script>

<style scoped>
.hero {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 20px;
  padding: 28px;
  border: 1px solid var(--line-soft);
  border-radius: 24px;
  background: var(--hero-bg);
  box-shadow: var(--shadow);
}

.kicker {
  color: #8ed1ff;
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}

h1 {
  margin: 14px 0 0;
  font-size: 40px;
  line-height: 1.1;
  color: var(--strong-text);
}

p {
  margin: 16px 0 0;
  max-width: 760px;
  color: var(--muted);
  line-height: 1.8;
}

.stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.stat-card {
  padding: 18px;
  border: 1px solid var(--line-soft);
  border-radius: 18px;
  background: var(--console-bg);
}

.stat-card span {
  font-size: 12px;
  color: var(--muted);
}

.stat-card strong {
  display: block;
  margin-top: 10px;
  font-size: 28px;
  color: var(--strong-text);
}

.stat-card p {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--muted);
}
</style>

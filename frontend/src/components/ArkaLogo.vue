<script setup lang="ts">
// Arka "fast-forward" play mark, rebuilt as SVG from the brand assets.
// Palette: #d3ebfe #a6c9ff #6699ff #162d73
withDefaults(defineProps<{
  size?: number;        // tile height in px
  wordmark?: boolean;   // show ARKA / digital marketing text
  light?: boolean;      // light text (on dark backgrounds)
  tile?: boolean;       // render the rounded navy tile behind the mark
}>(), { size: 40, wordmark: false, light: false, tile: true });
</script>

<template>
  <div class="arka-logo" :style="{ '--logo-size': size + 'px' }">
    <div class="arka-mark" :class="{ 'no-tile': !tile }">
      <svg viewBox="0 0 112 84" xmlns="http://www.w3.org/2000/svg" aria-label="Arka">
        <g stroke-linejoin="round" stroke-linecap="round">
          <path d="M14 16 L14 68 L48 42 Z" fill="#d3ebfe" stroke="#d3ebfe" stroke-width="9"/>
          <path d="M42 16 L42 68 L76 42 Z" fill="#a6c9ff" stroke="#a6c9ff" stroke-width="9"/>
          <path d="M70 16 L70 68 L104 42 Z" fill="#6699ff" stroke="#6699ff" stroke-width="9"/>
        </g>
      </svg>
    </div>
    <div v-if="wordmark" class="arka-word" :class="{ light }">
      <div class="arka-name">ARKA</div>
      <div class="arka-sub">digital marketing</div>
    </div>
  </div>
</template>

<style scoped>
.arka-logo { display: inline-flex; align-items: center; gap: 12px; }
.arka-mark {
  width: var(--logo-size); height: var(--logo-size); flex: none;
  display: grid; place-items: center; border-radius: 28%;
  background: linear-gradient(145deg, #1f3fa0 0%, #162d73 70%);
  box-shadow: 0 6px 18px rgba(22, 45, 115, .28);
  padding: 16%;
}
.arka-mark.no-tile { background: none; box-shadow: none; padding: 0; }
.arka-mark svg { width: 100%; height: 100%; display: block; }
.arka-word { line-height: 1; }
.arka-name {
  font-weight: 800; letter-spacing: .14em; font-size: calc(var(--logo-size) * .42);
  color: #162d73;
}
.arka-sub {
  font-size: calc(var(--logo-size) * .19); letter-spacing: .12em; color: #6699ff;
  margin-top: 3px; font-weight: 600;
}
.arka-word.light .arka-name { color: #ffffff; }
.arka-word.light .arka-sub { color: #a6c9ff; }
</style>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { faNum } from '../lib/format';
import { toast } from '../lib/toast';

const ready = ref<any>(null);
const sys = ref<any>(null);

async function refresh() {
  try {
    ready.value = (await http.get('/health/ready')).data;
    sys.value = (await http.get('/health/system')).data;
  } catch (e) { toast(apiError(e), 'err'); }
}
onMounted(refresh);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">System Health</div><h1>سلامت سامانه</h1></div>
      <button class="btn ghost" @click="refresh">به‌روزرسانی</button>
    </div>

    <div class="grid grid-3" v-if="ready">
      <div class="stat" v-for="(c, k) in ready.checks" :key="k">
        <div class="bar" :style="{ background: c.status === 'up' ? 'var(--pos)' : 'var(--bau-red)' }"></div>
        <div class="label">{{ k }}</div>
        <div class="value" :class="c.status === 'up' ? 'pos' : 'neg'" style="font-size:20px">
          {{ c.status === 'up' ? 'سالم' : 'خطا' }}
        </div>
        <div class="muted mono" style="font-size:11px">{{ c.detail }}</div>
      </div>
    </div>

    <div class="panel mt" v-if="sys">
      <header><h3>وضعیت زیرساخت</h3></header>
      <table class="tbl">
        <tbody>
          <tr><td>یکپارچگی زنجیرهٔ audit (hash-chain)</td>
            <td class="num"><span class="badge" :class="sys.auditChainIntact ? 'green' : 'red'">
              {{ sys.auditChainIntact ? 'سالم و دست‌نخورده' : 'نقض شده!' }}</span></td></tr>
          <tr><td>اتصالات فعال پایگاه‌داده</td><td class="num mono">{{ faNum(sys.dbConnections) }}</td></tr>
          <tr><td>حجم پایگاه‌داده</td><td class="num mono">{{ sys.databaseSize }}</td></tr>
          <tr><td>مصرف حافظهٔ سرویس (RSS)</td>
            <td class="num mono">{{ faNum((sys.memory.rss / 1048576).toFixed(0)) }} MB</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { money } from '../lib/format';
import { toast } from '../lib/toast';

const data = ref<any>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await http.get('/reports/balance-sheet');
    data.value = res.data;
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Balance Sheet</div><h1>ترازنامه</h1></div>
      <span v-if="data" class="badge" :class="data.totals.balanced ? 'green' : 'red'">
        {{ data.totals.balanced ? '✓ دارایی = بدهی + سرمایه' : 'عدم توازن' }}
      </span>
    </div>

    <div class="grid grid-2" style="background:transparent;border:0;gap:24px" v-if="data">
      <div class="panel">
        <header><h3>دارایی‌ها</h3></header>
        <table class="tbl">
          <tbody>
            <tr v-for="r in data.assets" :key="r.code"><td class="mono">{{ r.code }}</td><td>{{ r.name }}</td>
              <td class="num">{{ money(r.amount, { unit: false, toman: true }) }}</td></tr>
          </tbody>
          <tfoot><tr><td colspan="2">جمع دارایی‌ها</td><td class="num">{{ money(data.totals.assets, { unit: false, toman: true }) }}</td></tr></tfoot>
        </table>
      </div>

      <div class="panel">
        <header><h3>بدهی‌ها و سرمایه</h3></header>
        <table class="tbl">
          <tbody>
            <tr v-for="r in data.liabilities" :key="r.code"><td class="mono">{{ r.code }}</td><td>{{ r.name }}</td>
              <td class="num">{{ money(r.amount, { unit: false, toman: true }) }}</td></tr>
            <tr v-for="r in data.equity" :key="r.code"><td class="mono">{{ r.code }}</td><td>{{ r.name }}</td>
              <td class="num">{{ money(r.amount, { unit: false, toman: true }) }}</td></tr>
            <tr><td colspan="2" class="muted">سود انباشتهٔ دوره (بسته‌نشده)</td>
              <td class="num muted">{{ money(data.totals.netIncome, { unit: false, toman: true }) }}</td></tr>
          </tbody>
          <tfoot><tr><td colspan="2">جمع بدهی + سرمایه</td>
            <td class="num">{{ money(data.totals.liabilitiesPlusEquity, { unit: false, toman: true }) }}</td></tr></tfoot>
        </table>
      </div>
    </div>
    <p v-else-if="loading" class="muted">در حال بارگذاری…</p>
  </div>
</template>

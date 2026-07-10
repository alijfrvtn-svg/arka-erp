<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { money } from '../lib/format';
import { toast } from '../lib/toast';

const data = ref<any>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await http.get('/reports/profit-and-loss');
    data.value = res.data;
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Income Statement</div><h1>صورت سود و زیان</h1></div>
    </div>

    <div class="grid grid-2" style="background:transparent;border:0;gap:24px" v-if="data">
      <div class="panel">
        <header><h3>درآمدها</h3></header>
        <table class="tbl">
          <tbody>
            <tr v-for="r in data.income" :key="r.code"><td class="mono">{{ r.code }}</td><td>{{ r.name }}</td>
              <td class="num pos">{{ money(r.amount, { unit: false, toman: true }) }}</td></tr>
            <tr v-if="!data.income.length"><td class="muted" colspan="3">—</td></tr>
          </tbody>
          <tfoot><tr><td colspan="2">جمع درآمد</td><td class="num pos">{{ money(data.totalIncome, { unit: false, toman: true }) }}</td></tr></tfoot>
        </table>
      </div>

      <div class="panel">
        <header><h3>هزینه‌ها</h3></header>
        <table class="tbl">
          <tbody>
            <tr v-for="r in data.expense" :key="r.code"><td class="mono">{{ r.code }}</td><td>{{ r.name }}</td>
              <td class="num neg">{{ money(r.amount, { unit: false, toman: true }) }}</td></tr>
            <tr v-if="!data.expense.length"><td class="muted" colspan="3">—</td></tr>
          </tbody>
          <tfoot><tr><td colspan="2">جمع هزینه</td><td class="num neg">{{ money(data.totalExpense, { unit: false, toman: true }) }}</td></tr></tfoot>
        </table>
      </div>
    </div>

    <div class="stat mt" v-if="data" style="border:2px solid var(--line)">
      <div class="label">سود (زیان) خالص</div>
      <div class="value mono" :class="Number(data.netProfit) >= 0 ? 'pos' : 'neg'">
        {{ money(data.netProfit, { toman: true }) }}
      </div>
    </div>
    <p v-else-if="loading" class="muted">در حال بارگذاری…</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { money } from '../lib/format';
import { toast } from '../lib/toast';

const data = ref<any>(null);
const loading = ref(true);

onMounted(async () => {
  try {
    const res = await http.get('/reports/trial-balance');
    data.value = res.data;
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Trial Balance</div><h1>تراز آزمایشی</h1></div>
      <span v-if="data" class="badge" :class="data.balanced ? 'green' : 'red'">
        {{ data.balanced ? '✓ تراز است' : 'ناتراز!' }}
      </span>
    </div>

    <div class="panel" v-if="data">
      <table class="tbl">
        <thead><tr><th>کد</th><th>حساب</th><th class="num">مانده بدهکار</th><th class="num">مانده بستانکار</th></tr></thead>
        <tbody>
          <tr v-for="r in data.rows" :key="r.account_id">
            <td class="mono">{{ r.code }}</td>
            <td>{{ r.name }}</td>
            <td class="num">{{ r.debit_balance !== '0' ? money(r.debit_balance, { unit: false, toman: true }) : '—' }}</td>
            <td class="num">{{ r.credit_balance !== '0' ? money(r.credit_balance, { unit: false, toman: true }) : '—' }}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2">جمع کل</td>
            <td class="num">{{ money(data.totalDebit, { unit: false, toman: true }) }}</td>
            <td class="num">{{ money(data.totalCredit, { unit: false, toman: true }) }}</td>
          </tr>
        </tfoot>
      </table>
    </div>
    <p v-else-if="loading" class="muted">در حال بارگذاری…</p>
  </div>
</template>

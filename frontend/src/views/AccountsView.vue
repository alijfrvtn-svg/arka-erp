<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { money } from '../lib/format';
import { toast } from '../lib/toast';

const rows = ref<any[]>([]);
const loading = ref(true);

const typeLabel: Record<string, string> = {
  ASSET: 'دارایی', LIABILITY: 'بدهی', EQUITY: 'سرمایه', INCOME: 'درآمد', EXPENSE: 'هزینه',
};
const typeColor: Record<string, string> = {
  ASSET: 'blue', LIABILITY: 'red', EQUITY: 'yellow', INCOME: 'green', EXPENSE: 'gray',
};

onMounted(async () => {
  try {
    const { data } = await http.get('/accounts');
    rows.value = data;
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Chart of Accounts</div><h1>سرفصل حساب‌ها</h1></div>
    </div>
    <div class="panel">
      <table class="tbl">
        <thead><tr><th>کد</th><th>عنوان حساب</th><th>نوع</th><th>ماهیت</th><th class="num">مانده (تومان)</th></tr></thead>
        <tbody>
          <tr v-for="a in rows" :key="a.id">
            <td class="mono">{{ a.code }}</td>
            <td :style="{ paddingInlineStart: (10 + (a.depth - 1) * 22) + 'px', fontWeight: a.is_postable ? 400 : 700 }">
              {{ a.name }}
              <span v-if="!a.is_postable" class="muted" style="font-size:11px"> (کنترلی)</span>
            </td>
            <td><span class="badge" :class="typeColor[a.account_type]">{{ typeLabel[a.account_type] }}</span></td>
            <td class="muted">{{ a.normal_balance === 'DEBIT' ? 'بدهکار' : 'بستانکار' }}</td>
            <td class="num">{{ a.is_postable ? money(a.balance, { unit: false, toman: true }) : '—' }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="loading" class="card muted">در حال بارگذاری…</p>
    </div>
  </div>
</template>

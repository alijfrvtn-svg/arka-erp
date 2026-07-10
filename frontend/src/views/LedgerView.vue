<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
// @ts-ignore - no bundled types for the beta build
import { RecycleScroller } from 'vue-virtual-scroller';
import { http, apiError } from '../api/client';
import { money, faDate } from '../lib/format';
import { toast } from '../lib/toast';

const loading = ref(true);
const rows = ref<any[]>([]);
const accounts = ref<any[]>([]);
const accountId = ref<string>('');

async function load() {
  loading.value = true;
  try {
    const params: any = { limit: 1000 };
    if (accountId.value) params.accountId = accountId.value;
    const { data } = await http.get('/reports/general-ledger', { params });
    rows.value = data.map((r: any, i: number) => ({ ...r, _k: i }));
  } catch (e) {
    toast(apiError(e), 'err');
  } finally {
    loading.value = false;
  }
}

const totals = computed(() => {
  let d = 0n, c = 0n;
  for (const r of rows.value) { d += BigInt(r.debit); c += BigInt(r.credit); }
  return { debit: d.toString(), credit: c.toString() };
});

onMounted(async () => {
  try {
    const { data } = await http.get('/accounts/postable');
    accounts.value = data;
  } catch { /* ignore */ }
  await load();
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">General Ledger</div>
        <h1>دفتر روزنامه</h1>
      </div>
      <div class="flex gap center">
        <select class="input" style="width:240px" v-model="accountId" @change="load">
          <option value="">همهٔ حساب‌ها</option>
          <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
        </select>
        <RouterLink :to="{ name: 'journal-new' }" class="btn red">+ سند جدید</RouterLink>
      </div>
    </div>

    <div class="flex between center mb">
      <div class="muted mono">{{ rows.length }} سطر</div>
      <div class="flex gap">
        <span class="badge gray">جمع بدهکار: <b class="mono">{{ money(totals.debit, { toman: true }) }}</b></span>
        <span class="badge gray">جمع بستانکار: <b class="mono">{{ money(totals.credit, { toman: true }) }}</b></span>
      </div>
    </div>

    <div class="ledger-row head">
      <div>شماره</div><div>تاریخ</div><div>حساب / شرح</div>
      <div class="num">بدهکار</div><div class="num">بستانکار</div><div>منبع</div>
    </div>

    <div v-if="loading" class="card muted">در حال بارگذاری…</div>
    <RecycleScroller
      v-else
      class="ledger-scroller"
      :items="rows"
      :item-size="44"
      key-field="_k"
      v-slot="{ item }"
    >
      <div class="ledger-row">
        <div class="mono">#{{ item.entry_no }}</div>
        <div>{{ faDate(item.entry_date) }}</div>
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          <b>{{ item.account_code }}</b> {{ item.account_name }}
          <span class="muted"> · {{ item.line_memo || item.entry_memo }}</span>
        </div>
        <div class="num" :class="{ pos: item.debit !== '0' }">
          {{ item.debit !== '0' ? money(item.debit, { unit: false, toman: true }) : '—' }}
        </div>
        <div class="num" :class="{ neg: item.credit !== '0' }">
          {{ item.credit !== '0' ? money(item.credit, { unit: false, toman: true }) : '—' }}
        </div>
        <div><span class="badge gray">{{ item.source }}</span></div>
      </div>
    </RecycleScroller>
    <p class="muted mono" style="margin-top:8px;font-size:11px">مبالغ به تومان نمایش داده می‌شوند.</p>
  </div>
</template>

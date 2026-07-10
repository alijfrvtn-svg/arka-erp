<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { http, apiError } from '../api/client';
import { moneyCompact, money, faDate, faNum } from '../lib/format';
import { toast } from '../lib/toast';

const loading = ref(true);
const d = ref<any>(null);

const statusLabel: Record<string, string> = {
  LEAD: 'سرنخ', PROPOSAL: 'پیشنهاد', CONTRACT: 'قرارداد', ACTIVE: 'فعال',
  ON_HOLD: 'معلق', DELIVERED: 'تحویل‌شده', CLOSED: 'بسته', CANCELLED: 'لغو',
};

const maxTrend = computed(() => {
  const t = d.value?.revenueTrend || [];
  return Math.max(1, ...t.map((x: any) => Number(x.income)));
});

onMounted(async () => {
  try {
    const { data } = await http.get('/dashboard/ceo');
    d.value = data;
  } catch (e) {
    toast(apiError(e), 'err');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">Executive Overview</div>
        <h1>داشبورد مدیریت</h1>
      </div>
      <div class="muted" v-if="d">به‌روزرسانی: {{ faDate(d.generatedAt) }}</div>
    </div>

    <div v-if="loading" class="muted">در حال بارگذاری…</div>

    <template v-else-if="d">
      <div class="grid grid-4">
        <div class="stat">
          <div class="bar" style="background:var(--bau-blue)"></div>
          <div class="label">موجودی نقد و بانک</div>
          <div class="value mono">{{ moneyCompact(d.cashPosition) }}</div>
        </div>
        <div class="stat">
          <div class="bar" style="background:var(--pos)"></div>
          <div class="label">درآمد (تجمعی)</div>
          <div class="value mono">{{ moneyCompact(d.revenue) }}</div>
        </div>
        <div class="stat">
          <div class="bar" style="background:var(--bau-red)"></div>
          <div class="label">هزینه‌ها (تجمعی)</div>
          <div class="value mono">{{ moneyCompact(d.expenses) }}</div>
        </div>
        <div class="stat">
          <div class="bar" style="background:var(--bau-yellow)"></div>
          <div class="label">سود خالص</div>
          <div class="value mono" :class="Number(d.netProfit) >= 0 ? 'pos' : 'neg'">
            {{ moneyCompact(d.netProfit) }}
          </div>
        </div>
      </div>

      <div class="grid grid-3 mt">
        <div class="stat">
          <div class="label">حساب‌های دریافتنی</div>
          <div class="value mono">{{ moneyCompact(d.totalReceivables) }}</div>
        </div>
        <div class="stat">
          <div class="label">حساب‌های پرداختنی</div>
          <div class="value mono">{{ moneyCompact(d.totalPayables) }}</div>
        </div>
        <div class="stat">
          <div class="label">پروژه‌های دارای تأخیر</div>
          <div class="value mono" :class="d.overdueProjects > 0 ? 'neg' : ''">{{ faNum(d.overdueProjects) }}</div>
        </div>
      </div>

      <div class="grid grid-2 mt" style="background:transparent;border:0;gap:24px">
        <div class="panel">
          <header><h3>روند درآمد ثبت‌شده</h3></header>
          <div class="card">
            <div class="bars" v-if="d.revenueTrend?.length">
              <div v-for="(p, i) in d.revenueTrend" :key="i"
                   class="b"
                   :style="{ height: (Number(p.income) / maxTrend * 100) + '%',
                             background: i === d.revenueTrend.length - 1 ? 'var(--bau-red)' : 'var(--bau-blue)' }"
                   :title="faDate(p.d) + ' — ' + money(p.income, { toman: true })"></div>
            </div>
            <p v-else class="muted">داده‌ای برای نمایش نیست.</p>
            <div class="flex between muted" style="font-size:11px;margin-top:8px" v-if="d.revenueTrend?.length">
              <span>{{ faDate(d.revenueTrend[0].d) }}</span>
              <span>{{ faDate(d.revenueTrend[d.revenueTrend.length - 1].d) }}</span>
            </div>
          </div>
        </div>

        <div class="panel">
          <header><h3>وضعیت پروژه‌ها</h3></header>
          <div class="body">
            <table class="tbl">
              <tbody>
                <tr v-for="p in d.projectsByStatus" :key="p.status">
                  <td><span class="badge blue">{{ statusLabel[p.status] || p.status }}</span></td>
                  <td class="num">{{ faNum(p.n) }}</td>
                </tr>
                <tr v-if="!d.projectsByStatus?.length"><td class="muted">پروژه‌ای ثبت نشده.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="grid grid-2 mt" style="background:transparent;border:0;gap:24px">
        <div class="panel">
          <header><h3>بزرگ‌ترین بدهکاران</h3></header>
          <div class="body">
            <table class="tbl">
              <thead><tr><th>مشتری</th><th class="num">مانده بدهی</th></tr></thead>
              <tbody>
                <tr v-for="c in d.topDebtors" :key="c.customer_code">
                  <td>{{ c.display_name }}</td>
                  <td class="num">{{ money(c.balance, { toman: true }) }}</td>
                </tr>
                <tr v-if="!d.topDebtors?.length"><td colspan="2" class="muted">بدهکاری وجود ندارد.</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="panel">
          <header><h3>آخرین اسناد</h3></header>
          <div class="body">
            <table class="tbl">
              <thead><tr><th>شماره</th><th>شرح</th><th class="num">مبلغ</th></tr></thead>
              <tbody>
                <tr v-for="e in d.recentEntries" :key="e.entry_no">
                  <td class="mono">#{{ e.entry_no }}</td>
                  <td>{{ e.memo }}</td>
                  <td class="num">{{ money(e.amount, { toman: true }) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

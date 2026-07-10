<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { money } from '../lib/format';
import { toast } from '../lib/toast';

const auth = useAuth();
const router = useRouter();
const route = useRoute();
const accounts = ref<any[]>([]);
const submitting = ref(false);

const editId = computed(() => route.params.id as string | undefined);
const isEdit = computed(() => !!editId.value);

interface Line { accountId: string; side: 'debit' | 'credit'; amount: string; memo: string; }

const form = ref({
  memo: '',
  entryDate: new Date().toISOString().slice(0, 10),
  reference: '',
  lines: [
    { accountId: '', side: 'debit', amount: '', memo: '' },
    { accountId: '', side: 'credit', amount: '', memo: '' },
  ] as Line[],
});

const toRial = (toman: string) => (toman ? (BigInt(toman.replace(/\D/g, '') || '0') * 10n).toString() : '0');
const toToman = (rial: string) => (BigInt(rial || '0') / 10n).toString();

const totals = computed(() => {
  let d = 0n, c = 0n;
  for (const l of form.value.lines) {
    const v = BigInt(l.amount.replace(/\D/g, '') || '0');
    if (l.side === 'debit') d += v; else c += v;
  }
  return { debit: d, credit: c, balanced: d === c && d > 0n };
});

function addLine() { form.value.lines.push({ accountId: '', side: 'debit', amount: '', memo: '' }); }
function removeLine(i: number) { if (form.value.lines.length > 2) form.value.lines.splice(i, 1); }

async function submit(postAfter: boolean) {
  if (!totals.value.balanced) { toast('سند متوازن نیست', 'err'); return; }
  if (form.value.lines.some((l) => !l.accountId)) { toast('برای هر سطر یک حساب انتخاب کنید', 'err'); return; }
  submitting.value = true;
  try {
    const payload = {
      memo: form.value.memo,
      entryDate: form.value.entryDate,
      reference: form.value.reference || undefined,
      source: 'MANUAL',
      lines: form.value.lines.map((l) => ({
        accountId: l.accountId,
        debit: l.side === 'debit' ? toRial(l.amount) : '0',
        credit: l.side === 'credit' ? toRial(l.amount) : '0',
        memo: l.memo || undefined,
      })),
    };
    let id = editId.value;
    if (isEdit.value) {
      await http.patch(`/journal/${id}`, payload);
    } else {
      id = (await http.post('/journal', payload)).data.id;
    }
    if (postAfter) {
      await http.post(`/journal/${id}/post`);
      toast('سند ثبت و قطعی شد', 'ok');
    } else {
      toast(isEdit.value ? 'پیش‌نویس به‌روزرسانی شد' : 'پیش‌نویس ذخیره شد', 'ok');
    }
    router.push({ name: 'journal-entries' });
  } catch (e) {
    toast(apiError(e), 'err');
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  accounts.value = (await http.get('/accounts/postable')).data;
  if (isEdit.value) {
    try {
      const e = (await http.get(`/journal/${editId.value}`)).data;
      if (e.status !== 'DRAFT') { toast('فقط پیش‌نویس قابل ویرایش است', 'err'); router.push({ name: 'journal-entries' }); return; }
      form.value.memo = e.memo;
      form.value.entryDate = String(e.entry_date).slice(0, 10);
      form.value.reference = e.reference || '';
      form.value.lines = e.lines.map((l: any) => ({
        accountId: l.account_id,
        side: l.debit !== '0' ? 'debit' : 'credit',
        amount: toToman(l.debit !== '0' ? l.debit : l.credit),
        memo: l.memo || '',
      }));
    } catch (e) { toast(apiError(e), 'err'); }
  }
});
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <div class="eyebrow">{{ isEdit ? 'Edit Entry' : 'New Journal Entry' }}</div>
        <h1>{{ isEdit ? 'ویرایش سند' : 'ثبت سند حسابداری' }}</h1>
      </div>
    </div>

    <div class="panel">
      <div class="card">
        <div class="grid grid-3" style="background:transparent;border:0;gap:16px">
          <label class="fld"><span class="lab">شرح سند</span>
            <input class="input" v-model="form.memo" placeholder="مثلاً: خرید تجهیزات" /></label>
          <label class="fld"><span class="lab">تاریخ</span>
            <input class="input" type="date" v-model="form.entryDate" /></label>
          <label class="fld"><span class="lab">شماره مرجع (اختیاری)</span>
            <input class="input" v-model="form.reference" placeholder="INV-1001" /></label>
        </div>

        <table class="tbl mt">
          <thead>
            <tr><th style="width:34%">حساب</th><th style="width:14%">نوع</th><th style="width:22%">مبلغ (تومان)</th><th>شرح سطر</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in form.lines" :key="i">
              <td>
                <select class="input" v-model="l.accountId">
                  <option value="">— انتخاب حساب —</option>
                  <option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.code }} — {{ a.name }}</option>
                </select>
              </td>
              <td>
                <select class="input" v-model="l.side">
                  <option value="debit">بدهکار</option>
                  <option value="credit">بستانکار</option>
                </select>
              </td>
              <td><input class="input mono" v-model="l.amount" inputmode="numeric" placeholder="0" /></td>
              <td><input class="input" v-model="l.memo" /></td>
              <td><button class="btn ghost" style="padding:6px 10px" @click="removeLine(i)" :disabled="form.lines.length <= 2">✕</button></td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="2"><button class="btn ghost" @click="addLine">+ افزودن سطر</button></td>
              <td class="num">
                <div class="mono">بدهکار: {{ money(totals.debit.toString(), { unit: false, toman: true }) }}</div>
                <div class="mono">بستانکار: {{ money(totals.credit.toString(), { unit: false, toman: true }) }}</div>
              </td>
              <td colspan="2">
                <span class="badge" :class="totals.balanced ? 'green' : 'red'">{{ totals.balanced ? '✓ متوازن' : 'نامتوازن' }}</span>
              </td>
            </tr>
          </tfoot>
        </table>

        <div class="flex gap mt">
          <button class="btn" :disabled="submitting || !totals.balanced" @click="submit(false)">
            {{ isEdit ? 'ذخیرهٔ ویرایش' : 'ذخیرهٔ پیش‌نویس' }}
          </button>
          <button v-if="auth.can('ledger.post')" class="btn red" :disabled="submitting || !totals.balanced" @click="submit(true)">
            <span v-if="submitting" class="spinner"></span> ثبت و قطعی‌سازی
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

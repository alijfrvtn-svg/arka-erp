<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { money } from '../lib/format';
import { toast } from '../lib/toast';

const auth = useAuth();
const rows = ref<any[]>([]);
const loading = ref(true);
const saving = ref(false);

const showForm = ref(false);
const editId = ref<string | null>(null);
const form = ref<any>({});
const toRial = (t: string) => (t ? (BigInt(String(t).replace(/\D/g, '') || '0') * 10n).toString() : '0');
const toToman = (r: string) => (BigInt(r || '0') / 10n).toString();

const deleteTarget = ref<any | null>(null);
const deleteReason = ref('');

function blank() {
  return { kind:'COMPANY', displayName:'', legalName:'', email:'', phone:'', iban:'', taxId:'', creditLimit:'' };
}
function openCreate() { editId.value = null; form.value = blank(); showForm.value = true; }
function openEdit(c: any) {
  editId.value = c.id;
  form.value = {
    kind: c.kind, displayName: c.display_name, legalName: c.legal_name || '',
    email: c.email || '', phone: c.phone || '', iban: '', taxId: '',
    creditLimit: toToman(c.credit_limit),
  };
  showForm.value = true;
}

async function load() {
  loading.value = true;
  try { rows.value = (await http.get('/customers')).data; }
  catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
}

async function save() {
  if (!form.value.displayName) { toast('نام مشتری لازم است', 'err'); return; }
  saving.value = true;
  const payload: any = {
    kind: form.value.kind,
    displayName: form.value.displayName,
    legalName: form.value.legalName || undefined,
    email: form.value.email || undefined,
    phone: form.value.phone || undefined,
    creditLimit: toRial(form.value.creditLimit),
  };
  if (form.value.iban) payload.iban = form.value.iban;
  if (form.value.taxId) payload.taxId = form.value.taxId;
  try {
    if (editId.value) { await http.patch(`/customers/${editId.value}`, payload); toast('مشتری ویرایش شد', 'ok'); }
    else { await http.post('/customers', payload); toast('مشتری ایجاد شد (کد خودکار ثبت شد)', 'ok'); }
    showForm.value = false;
    await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { saving.value = false; }
}

async function doDelete() {
  if (!deleteReason.value.trim()) { toast('دلیل حذف الزامی است', 'err'); return; }
  try {
    await http.delete(`/customers/${deleteTarget.value.id}`, { data: { reason: deleteReason.value.trim() } });
    toast('مشتری حذف شد (در «رکوردهای حذف‌شده» قابل بازگردانی است)', 'ok');
    deleteTarget.value = null; deleteReason.value = '';
    await load();
  } catch (e) { toast(apiError(e), 'err'); }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Customers</div><h1>مشتریان</h1></div>
      <button v-if="auth.can('customer.manage')" class="btn red" @click="openCreate">+ مشتری جدید</button>
    </div>

    <div class="panel">
      <table class="tbl">
        <thead><tr><th>کد</th><th>نام</th><th>نوع</th><th>تماس</th>
          <th class="num">مانده دریافتنی</th><th class="num">سقف اعتبار</th>
          <th v-if="auth.can('customer.manage')" class="num">عملیات</th></tr></thead>
        <tbody>
          <tr v-for="c in rows" :key="c.id">
            <td class="mono">{{ c.code }}</td>
            <td><b>{{ c.display_name }}</b><div class="muted" style="font-size:11px">{{ c.legal_name }}</div></td>
            <td>{{ c.kind === 'COMPANY' ? 'شرکت' : 'شخص' }}</td>
            <td class="muted">{{ c.email || c.phone || '—' }}</td>
            <td class="num" :class="Number(c.receivable_balance) > 0 ? 'neg' : ''">{{ money(c.receivable_balance, { unit: false, toman: true }) }}</td>
            <td class="num muted">{{ money(c.credit_limit, { unit: false, toman: true }) }}</td>
            <td v-if="auth.can('customer.manage')" class="num">
              <div class="flex gap-s" style="justify-content:flex-end">
                <button class="btn ghost" style="padding:5px 10px" @click="openEdit(c)">ویرایش</button>
                <button class="btn ghost" style="padding:5px 10px;color:var(--bau-red)" @click="deleteTarget = c; deleteReason = ''">حذف</button>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td :colspan="auth.can('customer.manage') ? 7 : 6" class="muted">مشتری‌ای ثبت نشده.</td></tr>
        </tbody>
      </table>
      <p v-if="loading" class="card muted">در حال بارگذاری…</p>
    </div>

    <!-- create/edit modal -->
    <div v-if="showForm" class="modal-back" @click.self="showForm = false">
      <div class="modal">
        <h2 class="mb">{{ editId ? 'ویرایش مشتری' : 'ثبت مشتری جدید' }}</h2>
        <div class="grid grid-2" style="background:transparent;border:0;gap:14px">
          <label class="fld"><span class="lab">نام نمایشی</span><input class="input" v-model="form.displayName" /></label>
          <label class="fld"><span class="lab">نوع</span>
            <select class="input" v-model="form.kind"><option value="COMPANY">شرکت</option><option value="INDIVIDUAL">شخص</option></select>
          </label>
          <label class="fld"><span class="lab">نام حقوقی</span><input class="input" v-model="form.legalName" /></label>
          <label class="fld"><span class="lab">ایمیل</span><input class="input" type="email" v-model="form.email" /></label>
          <label class="fld"><span class="lab">تلفن</span><input class="input mono" v-model="form.phone" /></label>
          <label class="fld"><span class="lab">سقف اعتبار (تومان)</span><input class="input mono" v-model="form.creditLimit" inputmode="numeric" /></label>
          <label class="fld"><span class="lab">شبا / IBAN (رمزنگاری‌شده)</span><input class="input mono" v-model="form.iban" :placeholder="editId ? 'برای حفظ مقدار قبلی خالی بگذارید' : ''" /></label>
          <label class="fld"><span class="lab">شناسه/کد ملی (رمزنگاری‌شده)</span><input class="input mono" v-model="form.taxId" :placeholder="editId ? 'برای حفظ مقدار قبلی خالی بگذارید' : ''" /></label>
        </div>
        <div class="flex gap">
          <button class="btn red" :disabled="saving" @click="save"><span v-if="saving" class="spinner"></span> {{ editId ? 'ذخیرهٔ ویرایش' : 'ایجاد مشتری' }}</button>
          <button class="btn ghost" @click="showForm = false">انصراف</button>
        </div>
      </div>
    </div>

    <!-- delete modal -->
    <div v-if="deleteTarget" class="modal-back" @click.self="deleteTarget = null">
      <div class="modal" style="max-width:460px">
        <h2 class="mb">حذف مشتری «{{ deleteTarget.display_name }}»</h2>
        <p class="muted mb">حذف دائمی نیست؛ در «رکوردهای حذف‌شده» با نام شما، تاریخ و دلیل ثبت و قابل بازگردانی است.</p>
        <label class="fld"><span class="lab">دلیل حذف (الزامی)</span><textarea class="input" rows="2" v-model="deleteReason"></textarea></label>
        <div class="flex gap">
          <button class="btn red" :disabled="!deleteReason.trim()" @click="doDelete">حذف</button>
          <button class="btn ghost" @click="deleteTarget = null">انصراف</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-back { position: fixed; inset: 0; background: rgba(10,10,10,.55); display:flex; align-items:center; justify-content:center; z-index: 50; padding: 24px; }
.modal { background: var(--paper-2); border: 2px solid var(--line); padding: 24px; width: 100%; max-width: 620px; max-height: 88vh; overflow:auto; }
</style>

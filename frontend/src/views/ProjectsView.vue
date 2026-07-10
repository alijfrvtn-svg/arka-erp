<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { money, faDate, faNum } from '../lib/format';
import { toast } from '../lib/toast';

const auth = useAuth();
const rows = ref<any[]>([]);
const customers = ref<any[]>([]);
const loading = ref(true);
const saving = ref(false);

const statusLabel: Record<string, string> = {
  LEAD: 'سرنخ', PROPOSAL: 'پیشنهاد', CONTRACT: 'قرارداد', ACTIVE: 'فعال',
  ON_HOLD: 'معلق', DELIVERED: 'تحویل‌شده', CLOSED: 'بسته', CANCELLED: 'لغو',
};
const statusColor: Record<string, string> = {
  ACTIVE: 'blue', DELIVERED: 'green', CLOSED: 'gray', CANCELLED: 'red',
  LEAD: 'yellow', PROPOSAL: 'yellow', CONTRACT: 'blue', ON_HOLD: 'red',
};
const STATUSES = Object.keys(statusLabel);

const showForm = ref(false);
const editId = ref<string | null>(null);
const form = ref<any>({});
const toRial = (t: string) => (t ? (BigInt(String(t).replace(/\D/g, '') || '0') * 10n).toString() : '0');
const toToman = (r: string) => (BigInt(r || '0') / 10n).toString();

const deleteTarget = ref<any | null>(null);
const deleteReason = ref('');

function blank() {
  return { name:'', customerId:'', status:'LEAD', budget:'', contractValue:'', progressPct:0, startsOn:'', dueOn:'', description:'' };
}
function openCreate() { editId.value = null; form.value = blank(); showForm.value = true; }
function openEdit(p: any) {
  editId.value = p.id;
  form.value = {
    name: p.name, customerId: p.customer_id || '', status: p.status,
    budget: toToman(p.budget), contractValue: toToman(p.contract_value),
    progressPct: Number(p.progress_pct), startsOn: p.starts_on ? String(p.starts_on).slice(0,10) : '',
    dueOn: p.due_on ? String(p.due_on).slice(0,10) : '', description: p.description || '',
  };
  showForm.value = true;
}

async function load() {
  loading.value = true;
  try {
    rows.value = (await http.get('/projects')).data;
    if (auth.can('customer.view')) customers.value = (await http.get('/customers')).data;
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
}

async function save() {
  if (!form.value.name) { toast('نام پروژه لازم است', 'err'); return; }
  saving.value = true;
  const payload = {
    name: form.value.name,
    customerId: form.value.customerId || undefined,
    status: form.value.status,
    budget: toRial(form.value.budget),
    contractValue: toRial(form.value.contractValue),
    progressPct: Number(form.value.progressPct) || 0,
    startsOn: form.value.startsOn || undefined,
    dueOn: form.value.dueOn || undefined,
    description: form.value.description || undefined,
  };
  try {
    if (editId.value) { await http.patch(`/projects/${editId.value}`, payload); toast('پروژه ویرایش شد', 'ok'); }
    else { await http.post('/projects', payload); toast('پروژه ایجاد شد (کد خودکار ثبت شد)', 'ok'); }
    showForm.value = false;
    await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { saving.value = false; }
}

async function doDelete() {
  if (!deleteReason.value.trim()) { toast('دلیل حذف الزامی است', 'err'); return; }
  try {
    await http.delete(`/projects/${deleteTarget.value.id}`, { data: { reason: deleteReason.value.trim() } });
    toast('پروژه حذف شد (در «رکوردهای حذف‌شده» قابل بازگردانی است)', 'ok');
    deleteTarget.value = null; deleteReason.value = '';
    await load();
  } catch (e) { toast(apiError(e), 'err'); }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Projects</div><h1>پروژه‌ها</h1></div>
      <button v-if="auth.can('project.manage')" class="btn red" @click="openCreate">+ پروژهٔ جدید</button>
    </div>

    <div class="panel">
      <table class="tbl">
        <thead><tr><th>کد</th><th>نام پروژه</th><th>مشتری</th><th>وضعیت</th>
          <th class="num">مبلغ قرارداد</th><th class="num">پیشرفت</th><th>سررسید</th>
          <th v-if="auth.can('project.manage')" class="num">عملیات</th></tr></thead>
        <tbody>
          <tr v-for="p in rows" :key="p.id">
            <td class="mono">{{ p.code }}</td>
            <td><b>{{ p.name }}</b></td>
            <td>{{ p.customer_name || '—' }}</td>
            <td><span class="badge" :class="statusColor[p.status]">{{ statusLabel[p.status] || p.status }}</span></td>
            <td class="num">{{ money(p.contract_value, { unit: false, toman: true }) }}</td>
            <td class="num">
              <div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">
                <span class="mono">{{ faNum(Number(p.progress_pct).toFixed(0)) }}٪</span>
                <div style="width:60px;height:6px;background:var(--line-soft)">
                  <div :style="{ width: p.progress_pct + '%', height: '100%', background: 'var(--bau-blue)' }"></div>
                </div>
              </div>
            </td>
            <td>{{ faDate(p.due_on) }}</td>
            <td v-if="auth.can('project.manage')" class="num">
              <div class="flex gap-s" style="justify-content:flex-end">
                <button class="btn ghost" style="padding:5px 10px" @click="openEdit(p)">ویرایش</button>
                <button class="btn ghost" style="padding:5px 10px;color:var(--bau-red)" @click="deleteTarget = p; deleteReason = ''">حذف</button>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td :colspan="auth.can('project.manage') ? 8 : 7" class="muted">پروژه‌ای ثبت نشده.</td></tr>
        </tbody>
      </table>
      <p v-if="loading" class="card muted">در حال بارگذاری…</p>
    </div>

    <!-- create/edit modal -->
    <div v-if="showForm" class="modal-back" @click.self="showForm = false">
      <div class="modal">
        <h2 class="mb">{{ editId ? 'ویرایش پروژه' : 'ثبت پروژهٔ جدید' }}</h2>
        <div class="grid grid-2" style="background:transparent;border:0;gap:14px">
          <label class="fld" style="grid-column:1 / -1"><span class="lab">نام پروژه</span><input class="input" v-model="form.name" /></label>
          <label class="fld"><span class="lab">مشتری</span>
            <select class="input" v-model="form.customerId">
              <option value="">— بدون مشتری —</option>
              <option v-for="c in customers" :key="c.id" :value="c.id">{{ c.display_name }}</option>
            </select>
          </label>
          <label class="fld"><span class="lab">وضعیت</span>
            <select class="input" v-model="form.status"><option v-for="s in STATUSES" :key="s" :value="s">{{ statusLabel[s] }}</option></select>
          </label>
          <label class="fld"><span class="lab">بودجه (تومان)</span><input class="input mono" v-model="form.budget" inputmode="numeric" /></label>
          <label class="fld"><span class="lab">مبلغ قرارداد (تومان)</span><input class="input mono" v-model="form.contractValue" inputmode="numeric" /></label>
          <label class="fld"><span class="lab">تاریخ شروع</span><input class="input" type="date" v-model="form.startsOn" /></label>
          <label class="fld"><span class="lab">سررسید</span><input class="input" type="date" v-model="form.dueOn" /></label>
          <label class="fld"><span class="lab">پیشرفت (٪)</span><input class="input mono" type="number" min="0" max="100" v-model="form.progressPct" /></label>
        </div>
        <label class="fld"><span class="lab">توضیحات</span><textarea class="input" rows="2" v-model="form.description"></textarea></label>
        <div class="flex gap">
          <button class="btn red" :disabled="saving" @click="save"><span v-if="saving" class="spinner"></span> {{ editId ? 'ذخیرهٔ ویرایش' : 'ایجاد پروژه' }}</button>
          <button class="btn ghost" @click="showForm = false">انصراف</button>
        </div>
      </div>
    </div>

    <!-- delete modal -->
    <div v-if="deleteTarget" class="modal-back" @click.self="deleteTarget = null">
      <div class="modal" style="max-width:460px">
        <h2 class="mb">حذف پروژهٔ «{{ deleteTarget.name }}»</h2>
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

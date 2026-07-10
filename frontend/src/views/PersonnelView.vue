<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { faDate, money } from '../lib/format';
import { toast } from '../lib/toast';

const auth = useAuth();
const rows = ref<any[]>([]);
const positions = ref<any[]>([]);
const directory = ref<any[]>([]);
const loading = ref(true);
const saving = ref(false);

const statusLabel: Record<string, string> = { ACTIVE:'شاغل', ON_LEAVE:'مرخصی', TERMINATED:'خاتمه همکاری' };
const statusColor: Record<string, string> = { ACTIVE:'green', ON_LEAVE:'yellow', TERMINATED:'gray' };

const showForm = ref(false);
const editId = ref<string | null>(null);
const form = ref<any>({});
const toRial = (t: string) => (t ? (BigInt(String(t).replace(/\D/g, '') || '0') * 10n).toString() : '0');
const toToman = (r: string) => (BigInt(r || '0') / 10n).toString();

const deleteTarget = ref<any | null>(null);
const deleteReason = ref('');
const showPositions = ref(false);
const newPosition = ref('');

function blank() {
  return { userId:'', firstName:'', lastName:'', nationalId:'', birthDate:'', gender:'', phone:'', email:'',
           address:'', positionId:'', department:'', hireDate:'', baseSalary:'', iban:'', employmentStatus:'ACTIVE' };
}
function openCreate() { editId.value = null; form.value = blank(); showForm.value = true; }
async function openEdit(p: any) {
  editId.value = p.id;
  const d = (await http.get(`/personnel/${p.id}`)).data;
  form.value = {
    userId: d.user_id || '', firstName: d.first_name, lastName: d.last_name, nationalId: '',
    birthDate: d.birth_date ? String(d.birth_date).slice(0,10) : '', gender: d.gender || '',
    phone: d.phone || '', email: d.email || '', address: d.address || '',
    positionId: d.position_id || '', department: d.department || '',
    hireDate: d.hire_date ? String(d.hire_date).slice(0,10) : '',
    baseSalary: toToman(d.base_salary), iban: '', employmentStatus: d.employment_status,
  };
  showForm.value = true;
}

async function load() {
  loading.value = true;
  try {
    rows.value = (await http.get('/personnel')).data;
    positions.value = (await http.get('/positions')).data;
    directory.value = (await http.get('/users/directory')).data;
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
}

async function save() {
  if (!form.value.firstName || !form.value.lastName) { toast('نام و نام خانوادگی لازم است', 'err'); return; }
  saving.value = true;
  const payload: any = {
    userId: form.value.userId || undefined,
    firstName: form.value.firstName, lastName: form.value.lastName,
    birthDate: form.value.birthDate || undefined, gender: form.value.gender || undefined,
    phone: form.value.phone || undefined, email: form.value.email || undefined, address: form.value.address || undefined,
    positionId: form.value.positionId || undefined, department: form.value.department || undefined,
    hireDate: form.value.hireDate || undefined, baseSalary: toRial(form.value.baseSalary),
    employmentStatus: form.value.employmentStatus,
  };
  if (form.value.nationalId) payload.nationalId = form.value.nationalId;
  if (form.value.iban) payload.iban = form.value.iban;
  try {
    if (editId.value) { await http.patch(`/personnel/${editId.value}`, payload); toast('پرسنل ویرایش شد', 'ok'); }
    else { await http.post('/personnel', payload); toast('پرسنل ایجاد شد (کد خودکار)', 'ok'); }
    showForm.value = false; await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { saving.value = false; }
}

async function doDelete() {
  if (!deleteReason.value.trim()) { toast('دلیل حذف الزامی است', 'err'); return; }
  try {
    await http.delete(`/personnel/${deleteTarget.value.id}`, { data: { reason: deleteReason.value.trim() } });
    toast('پرسنل حذف شد (قابل بازگردانی در «رکوردهای حذف‌شده»)', 'ok');
    deleteTarget.value = null; deleteReason.value = ''; await load();
  } catch (e) { toast(apiError(e), 'err'); }
}

async function addPosition() {
  if (!newPosition.value.trim()) return;
  try { await http.post('/positions', { title: newPosition.value.trim() }); newPosition.value = ''; positions.value = (await http.get('/positions')).data; toast('سمت افزوده شد', 'ok'); }
  catch (e) { toast(apiError(e), 'err'); }
}
async function delPosition(p: any) {
  if (!confirm(`حذف سمت «${p.title}»؟`)) return;
  try { await http.delete(`/positions/${p.id}`); positions.value = (await http.get('/positions')).data; }
  catch (e) { toast(apiError(e), 'err'); }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Human Resources</div><h1>پرسنل</h1></div>
      <div class="flex gap">
        <button class="btn ghost" @click="showPositions = true">سمت‌های شغلی</button>
        <button v-if="auth.can('hr.manage')" class="btn red" @click="openCreate">+ پرسنل جدید</button>
      </div>
    </div>

    <div class="panel">
      <table class="tbl">
        <thead><tr><th>کد</th><th>نام</th><th>سمت</th><th>واحد</th><th>تماس</th>
          <th class="num">حقوق پایه</th><th>وضعیت</th><th>حساب کاربری</th>
          <th v-if="auth.can('hr.manage')" class="num">عملیات</th></tr></thead>
        <tbody>
          <tr v-for="p in rows" :key="p.id">
            <td class="mono">{{ p.employee_code }}</td>
            <td><b>{{ p.full_name }}</b></td>
            <td>{{ p.position_title || '—' }}</td>
            <td>{{ p.department || '—' }}</td>
            <td class="muted">{{ p.phone || p.email || '—' }}</td>
            <td class="num">{{ money(p.base_salary, { unit: false, toman: true }) }}</td>
            <td><span class="badge" :class="statusColor[p.employment_status]">{{ statusLabel[p.employment_status] }}</span></td>
            <td class="muted">{{ p.login_email || '—' }}</td>
            <td v-if="auth.can('hr.manage')" class="num">
              <div class="flex gap-s" style="justify-content:flex-end">
                <button class="btn ghost" style="padding:5px 10px" @click="openEdit(p)">ویرایش</button>
                <button class="btn ghost" style="padding:5px 10px;color:var(--bau-red)" @click="deleteTarget = p; deleteReason = ''">حذف</button>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td :colspan="auth.can('hr.manage') ? 9 : 8" class="muted">پرسنلی ثبت نشده.</td></tr>
        </tbody>
      </table>
      <p v-if="loading" class="card muted">در حال بارگذاری…</p>
    </div>

    <!-- create/edit modal -->
    <div v-if="showForm" class="modal-back" @click.self="showForm = false">
      <div class="modal">
        <h2 class="mb">{{ editId ? 'ویرایش پرسنل' : 'ثبت پرسنل جدید' }}</h2>
        <div class="grid grid-3" style="background:transparent;border:0;gap:14px">
          <label class="fld"><span class="lab">نام</span><input class="input" v-model="form.firstName" /></label>
          <label class="fld"><span class="lab">نام خانوادگی</span><input class="input" v-model="form.lastName" /></label>
          <label class="fld"><span class="lab">کد ملی (رمزنگاری‌شده)</span><input class="input mono" v-model="form.nationalId" :placeholder="editId ? 'برای حفظ مقدار قبلی خالی' : ''" /></label>
          <label class="fld"><span class="lab">تاریخ تولد</span><input class="input" type="date" v-model="form.birthDate" /></label>
          <label class="fld"><span class="lab">جنسیت</span>
            <select class="input" v-model="form.gender"><option value="">—</option><option value="M">مرد</option><option value="F">زن</option></select>
          </label>
          <label class="fld"><span class="lab">تلفن</span><input class="input mono" v-model="form.phone" /></label>
          <label class="fld"><span class="lab">ایمیل</span><input class="input" type="email" v-model="form.email" /></label>
          <label class="fld"><span class="lab">سمت شغلی</span>
            <select class="input" v-model="form.positionId">
              <option value="">—</option><option v-for="p in positions" :key="p.id" :value="p.id">{{ p.title }}</option>
            </select>
          </label>
          <label class="fld"><span class="lab">واحد / دپارتمان</span><input class="input" v-model="form.department" /></label>
          <label class="fld"><span class="lab">تاریخ استخدام</span><input class="input" type="date" v-model="form.hireDate" /></label>
          <label class="fld"><span class="lab">حقوق پایه (تومان)</span><input class="input mono" v-model="form.baseSalary" inputmode="numeric" /></label>
          <label class="fld"><span class="lab">شبا (رمزنگاری‌شده)</span><input class="input mono" v-model="form.iban" :placeholder="editId ? 'برای حفظ مقدار قبلی خالی' : ''" /></label>
          <label class="fld"><span class="lab">وضعیت</span>
            <select class="input" v-model="form.employmentStatus">
              <option value="ACTIVE">شاغل</option><option value="ON_LEAVE">مرخصی</option><option value="TERMINATED">خاتمه همکاری</option>
            </select>
          </label>
          <label class="fld"><span class="lab">اتصال به حساب کاربری</span>
            <select class="input" v-model="form.userId">
              <option value="">— بدون حساب —</option>
              <option v-for="u in directory" :key="u.id" :value="u.id">{{ u.full_name }}</option>
            </select>
          </label>
        </div>
        <label class="fld"><span class="lab">آدرس</span><textarea class="input" rows="2" v-model="form.address"></textarea></label>
        <div class="flex gap">
          <button class="btn red" :disabled="saving" @click="save"><span v-if="saving" class="spinner"></span> {{ editId ? 'ذخیره' : 'ایجاد' }}</button>
          <button class="btn ghost" @click="showForm = false">انصراف</button>
        </div>
      </div>
    </div>

    <!-- positions modal -->
    <div v-if="showPositions" class="modal-back" @click.self="showPositions = false">
      <div class="modal" style="max-width:480px">
        <h2 class="mb">سمت‌های شغلی</h2>
        <div v-if="auth.can('hr.manage')" class="flex gap mb">
          <input class="input" v-model="newPosition" placeholder="عنوان سمت جدید" @keyup.enter="addPosition" />
          <button class="btn" @click="addPosition">افزودن</button>
        </div>
        <table class="tbl">
          <tbody>
            <tr v-for="p in positions" :key="p.id">
              <td><b>{{ p.title }}</b></td>
              <td class="num muted">{{ p.headcount }} نفر</td>
              <td class="num"><button v-if="auth.can('hr.manage')" class="btn ghost" style="padding:4px 8px;color:var(--bau-red)" @click="delPosition(p)">✕</button></td>
            </tr>
            <tr v-if="!positions.length"><td class="muted" colspan="3">سمتی تعریف نشده.</td></tr>
          </tbody>
        </table>
        <div class="mt"><button class="btn ghost" @click="showPositions = false">بستن</button></div>
      </div>
    </div>

    <!-- delete modal -->
    <div v-if="deleteTarget" class="modal-back" @click.self="deleteTarget = null">
      <div class="modal" style="max-width:460px">
        <h2 class="mb">حذف پرسنل «{{ deleteTarget.full_name }}»</h2>
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
.modal { background: var(--paper-2); border: 2px solid var(--line); padding: 24px; width: 100%; max-width: 760px; max-height: 90vh; overflow:auto; }
.lab { font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-2); margin-bottom: 4px; }
</style>

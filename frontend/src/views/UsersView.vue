<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { faDate } from '../lib/format';
import { toast } from '../lib/toast';

const auth = useAuth();
const users = ref<any[]>([]);
const roleMap = ref<Record<string, string[]>>({});
const catalog = ref<any[]>([]);
const showForm = ref(false);
const saving = ref(false);

const ROLES = ['CEO','ACCOUNTANT','SALES','DESIGNER','DEVELOPER','PHOTOGRAPHER','CUSTOMER','GUEST'];
const roleLabel: Record<string, string> = {
  CEO:'مدیرعامل', ACCOUNTANT:'حسابدار', SALES:'فروش', DESIGNER:'طراح',
  DEVELOPER:'برنامه‌نویس', PHOTOGRAPHER:'عکاس', CUSTOMER:'مشتری', GUEST:'مهمان',
};
const categoryLabel: Record<string, string> = {
  ledger:'دفتر و اسناد', treasury:'خزانه‌داری', sales:'فروش و فاکتور', reporting:'گزارش‌ها',
  projects:'پروژه‌ها', crm:'مشتریان', hr:'منابع انسانی', assets:'دارایی‌ها',
  admin:'مدیریت سیستم', analytics:'تحلیل و هوش مصنوعی', workspace:'میز کار و وظایف',
};
const permLabel: Record<string, string> = {
  'ledger.view':'مشاهدهٔ اسناد', 'ledger.create':'ثبت پیش‌نویس سند', 'ledger.post':'قطعی‌سازی سند', 'ledger.reverse':'برگشت سند',
  'fund.transfer':'انتقال وجه', 'invoice.issue':'صدور فاکتور', 'invoice.approve':'تأیید فاکتور',
  'report.financial':'گزارش‌های مالی', 'report.ceo':'داشبورد مدیریت',
  'project.view':'مشاهدهٔ پروژه', 'project.manage':'مدیریت پروژه',
  'customer.view':'مشاهدهٔ مشتری', 'customer.manage':'مدیریت مشتری',
  'hr.view':'مشاهدهٔ پرسنل', 'hr.manage':'مدیریت پرسنل', 'payroll.run':'اجرای حقوق و دستمزد',
  'asset.view':'مشاهدهٔ دارایی', 'asset.manage':'مدیریت دارایی',
  'user.manage':'مدیریت کاربران', 'role.manage':'مدیریت نقش‌ها', 'audit.view':'مشاهدهٔ ردگیری',
  'ai.query':'دستیار هوش مصنوعی', 'system.admin':'مدیریت و پایش سیستم',
  'task.manage':'مدیریت وظایف تیم',
};

const grouped = computed(() => {
  const g: Record<string, any[]> = {};
  for (const p of catalog.value) { (g[p.category] ||= []).push(p); }
  return g;
});

const form = ref<{ fullName:string; email:string; role:string; password:string; perms:string[] }>(
  { fullName:'', email:'', role:'DESIGNER', password:'', perms:[] });

function applyRoleDefaults() { form.value.perms = [...(roleMap.value[form.value.role] || [])]; }
function togglePerm(code: string) {
  const i = form.value.perms.indexOf(code);
  if (i >= 0) form.value.perms.splice(i, 1); else form.value.perms.push(code);
}

// edit-permissions modal
const permUser = ref<any | null>(null);
const permSel = ref<string[]>([]);
async function openPerms(u: any) {
  try {
    const d = (await http.get(`/users/${u.id}`)).data;
    permUser.value = { ...u, ...d };
    permSel.value = [...(d.permissions || [])];
  } catch (e) { toast(apiError(e), 'err'); }
}
function togglePermSel(code: string) {
  const i = permSel.value.indexOf(code);
  if (i >= 0) permSel.value.splice(i, 1); else permSel.value.push(code);
}
async function savePerms() {
  try {
    await http.patch(`/users/${permUser.value.id}/permissions`, { permissions: permSel.value });
    toast('دسترسی‌های کاربر ذخیره شد', 'ok');
    permUser.value = null; await load();
  } catch (e) { toast(apiError(e), 'err'); }
}

async function load() {
  try {
    users.value = (await http.get('/users')).data;
    roleMap.value = (await http.get('/users/roles')).data;
    catalog.value = (await http.get('/users/permission-catalog')).data;
  } catch (e) { toast(apiError(e), 'err'); }
}

function openCreate() {
  form.value = { fullName:'', email:'', role:'DESIGNER', password:'', perms:[] };
  applyRoleDefaults();
  showForm.value = true;
}

async function createUser() {
  if (!form.value.fullName || !form.value.email || form.value.password.length < 8) {
    toast('نام، ایمیل و گذرواژهٔ حداقل ۸ نویسه لازم است', 'err'); return;
  }
  saving.value = true;
  try {
    await http.post('/users', {
      fullName: form.value.fullName,
      email: form.value.email,
      role: form.value.role,
      password: form.value.password,
      permissions: form.value.perms,   // send only DTO fields (not the internal `perms`)
    });
    toast('کاربر ایجاد شد', 'ok');
    showForm.value = false;
    await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { saving.value = false; }
}

async function changeRole(u: any, role: string) {
  try { await http.patch(`/users/${u.id}`, { role }); toast('نقش به‌روزرسانی شد', 'ok'); await load(); }
  catch (e) { toast(apiError(e), 'err'); await load(); }
}
async function toggleActive(u: any) {
  try { await http.patch(`/users/${u.id}`, { isActive: !u.is_active }); await load(); }
  catch (e) { toast(apiError(e), 'err'); }
}
async function resetPass(u: any) {
  const p = prompt(`گذرواژهٔ جدید برای ${u.full_name} (حداقل ۸ نویسه):`);
  if (!p) return;
  try { await http.patch(`/users/${u.id}/password`, { newPassword: p }); toast('گذرواژه بازنشانی شد', 'ok'); }
  catch (e) { toast(apiError(e), 'err'); }
}
async function resetMfa(u: any) {
  if (!confirm(`بازنشانی احراز دومرحله‌ای برای «${u.full_name}»؟`)) return;
  try { await http.post(`/users/${u.id}/mfa/reset`); toast('MFA کاربر بازنشانی شد', 'ok'); await load(); }
  catch (e) { toast(apiError(e), 'err'); }
}
async function removeUser(u: any) {
  if (!confirm(`حذف کاربر «${u.full_name}»؟`)) return;
  try { await http.delete(`/users/${u.id}`); toast('کاربر حذف شد', 'ok'); await load(); }
  catch (e) { toast(apiError(e), 'err'); }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">User Management</div><h1>مدیریت کاربران</h1></div>
      <button class="btn red" @click="openCreate">+ کاربر جدید</button>
    </div>

    <div class="panel">
      <table class="tbl">
        <thead><tr><th>نام</th><th>ایمیل</th><th>نقش</th><th>وضعیت</th><th>MFA</th><th>آخرین ورود</th><th class="num">عملیات</th></tr></thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td><b>{{ u.full_name }}</b></td>
            <td class="muted">{{ u.email }}</td>
            <td>
              <select class="input" style="padding:5px 8px;width:auto" :value="u.role"
                      @change="changeRole(u, ($event.target as HTMLSelectElement).value)">
                <option v-for="r in ROLES" :key="r" :value="r">{{ roleLabel[r] }}</option>
              </select>
            </td>
            <td>
              <button class="badge" :class="u.is_active ? 'green' : 'red'" style="cursor:pointer;border:0" @click="toggleActive(u)">
                {{ u.is_active ? 'فعال' : 'غیرفعال' }}
              </button>
            </td>
            <td>
              <span class="badge" :class="u.mfa_enabled ? 'blue' : 'gray'">{{ u.mfa_enabled ? 'دارد' : '—' }}</span>
              <button v-if="u.mfa_enabled" class="btn ghost" style="padding:3px 8px;font-size:10px;margin-inline-start:6px" @click="resetMfa(u)">بازنشانی</button>
            </td>
            <td class="muted">{{ u.last_login_at ? faDate(u.last_login_at) : 'هرگز' }}</td>
            <td class="num">
              <div class="flex gap-s" style="justify-content:flex-end;flex-wrap:wrap">
                <button class="btn ghost" style="padding:5px 10px" @click="openPerms(u)">دسترسی‌ها</button>
                <button class="btn ghost" style="padding:5px 10px" @click="resetPass(u)">بازنشانی رمز</button>
                <button v-if="u.id !== auth.user?.id" class="btn ghost" style="padding:5px 10px;color:var(--bau-red)" @click="removeUser(u)">حذف</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- create user modal with permission checkboxes -->
    <div v-if="showForm" class="modal-back" @click.self="showForm = false">
      <div class="modal">
        <h2 class="mb">ایجاد کاربر جدید</h2>
        <div class="grid grid-2" style="background:transparent;border:0;gap:14px">
          <label class="fld"><span class="lab">نام و نام خانوادگی</span><input class="input" v-model="form.fullName" /></label>
          <label class="fld"><span class="lab">ایمیل (نام کاربری)</span><input class="input" type="email" v-model="form.email" /></label>
          <label class="fld"><span class="lab">نقش پایه (پیش‌فرض دسترسی‌ها)</span>
            <select class="input" v-model="form.role" @change="applyRoleDefaults">
              <option v-for="r in ROLES" :key="r" :value="r">{{ roleLabel[r] }}</option>
            </select>
          </label>
          <label class="fld"><span class="lab">گذرواژهٔ اولیه</span><input class="input" type="text" v-model="form.password" placeholder="حداقل ۸ نویسه" /></label>
        </div>

        <div class="lab mb" style="margin-top:6px">سطوح دسترسی (تیک بزنید کدام بخش‌ها در دسترس باشند)</div>
        <div class="perm-grid">
          <div v-for="(items, cat) in grouped" :key="cat" class="perm-cat">
            <div class="perm-cat-title">{{ categoryLabel[cat] || cat }}</div>
            <label v-for="p in items" :key="p.code" class="perm-item">
              <input type="checkbox" :checked="form.perms.includes(p.code)" @change="togglePerm(p.code)" />
              <span>{{ permLabel[p.code] || p.code }}</span>
            </label>
          </div>
        </div>

        <div class="flex gap mt">
          <button class="btn red" :disabled="saving" @click="createUser"><span v-if="saving" class="spinner"></span> ایجاد کاربر</button>
          <button class="btn ghost" @click="showForm = false">انصراف</button>
        </div>
      </div>
    </div>

    <!-- edit permissions modal -->
    <div v-if="permUser" class="modal-back" @click.self="permUser = null">
      <div class="modal">
        <h2 class="mb">دسترسی‌های «{{ permUser.full_name }}»</h2>
        <p class="muted mb">این تیک‌ها دسترسی نقش را بازنویسی می‌کنند. اگر همه را بردارید، دوباره از نقش پیروی می‌شود.</p>
        <div class="perm-grid">
          <div v-for="(items, cat) in grouped" :key="cat" class="perm-cat">
            <div class="perm-cat-title">{{ categoryLabel[cat] || cat }}</div>
            <label v-for="p in items" :key="p.code" class="perm-item">
              <input type="checkbox" :checked="permSel.includes(p.code)" @change="togglePermSel(p.code)" />
              <span>{{ permLabel[p.code] || p.code }}</span>
            </label>
          </div>
        </div>
        <div class="flex gap mt">
          <button class="btn red" @click="savePerms">ذخیرهٔ دسترسی‌ها</button>
          <button class="btn ghost" @click="permUser = null">انصراف</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-back { position: fixed; inset: 0; background: rgba(10,10,10,.55); display:flex; align-items:center; justify-content:center; z-index: 50; padding: 24px; }
.modal { background: var(--paper-2); border: 2px solid var(--line); padding: 24px; width: 100%; max-width: 720px; max-height: 90vh; overflow:auto; }
.perm-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 20px; border: 1px solid var(--line-soft); padding: 14px; }
.perm-cat-title { font-size: 11px; font-weight: 800; letter-spacing: .04em; color: var(--bau-blue); margin-bottom: 6px; text-transform: uppercase; }
.perm-item { display:flex; align-items:center; gap:7px; font-size: 12.5px; padding: 3px 0; cursor: pointer; }
.perm-item input { width: 15px; height: 15px; accent-color: var(--bau-red); }
</style>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { http, apiError } from '../api/client';
import { faDate } from '../lib/format';
import { toast } from '../lib/toast';

const rows = ref<any[]>([]);
const directory = ref<any[]>([]);
const projects = ref<any[]>([]);
const loading = ref(true);
const saving = ref(false);
const filter = ref('');

const statusLabel: Record<string, string> = { TODO:'انجام‌نشده', IN_PROGRESS:'در حال انجام', DONE:'انجام‌شده', BLOCKED:'متوقف' };
const statusColor: Record<string, string> = { TODO:'gray', IN_PROGRESS:'blue', DONE:'green', BLOCKED:'red' };
const prioLabel: Record<string, string> = { LOW:'کم', NORMAL:'عادی', HIGH:'زیاد', URGENT:'فوری' };
const prioColor: Record<string, string> = { LOW:'gray', NORMAL:'blue', HIGH:'yellow', URGENT:'red' };
const STATUSES = ['TODO','IN_PROGRESS','DONE','BLOCKED'];
const PRIOS = ['LOW','NORMAL','HIGH','URGENT'];

const showForm = ref(false);
const editId = ref<string | null>(null);
const form = ref<any>({});
const deleteTarget = ref<any | null>(null);
const deleteReason = ref('');

const filtered = computed(() => filter.value ? rows.value.filter(t => t.kind === filter.value) : rows.value);

function blank() { return { title:'', description:'', kind:'PERSONAL', assigneeId:'', projectId:'', priority:'NORMAL', status:'TODO', dueDate:'' }; }
function openCreate() { editId.value = null; form.value = blank(); showForm.value = true; }
function openEdit(t: any) {
  editId.value = t.id;
  form.value = { title: t.title, description: t.description || '', kind: t.kind, assigneeId: t.assignee_id || '',
    projectId: t.project_id || '', priority: t.priority, status: t.status, dueDate: t.due_date ? String(t.due_date).slice(0,10) : '' };
  showForm.value = true;
}

async function load() {
  loading.value = true;
  try {
    rows.value = (await http.get('/tasks')).data;
    directory.value = (await http.get('/users/directory')).data;
    projects.value = await http.get('/projects').then(r => r.data).catch(() => []);
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
}

async function save() {
  if (!form.value.title) { toast('عنوان لازم است', 'err'); return; }
  if (form.value.kind === 'PERSONAL' && !form.value.assigneeId) { toast('برای وظیفهٔ شخصی، مسئول را انتخاب کنید', 'err'); return; }
  saving.value = true;
  const payload: any = {
    title: form.value.title, description: form.value.description || undefined,
    kind: form.value.kind,
    assigneeId: form.value.kind === 'PERSONAL' ? form.value.assigneeId : undefined,
    projectId: form.value.projectId || undefined,
    priority: form.value.priority, status: form.value.status,
    dueDate: form.value.dueDate || undefined,
  };
  try {
    if (editId.value) { await http.patch(`/tasks/${editId.value}`, payload); toast('وظیفه ویرایش شد', 'ok'); }
    else { await http.post('/tasks', payload); toast('وظیفه ایجاد و ارجاع شد', 'ok'); }
    showForm.value = false; await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { saving.value = false; }
}

async function doDelete() {
  if (!deleteReason.value.trim()) { toast('دلیل حذف الزامی است', 'err'); return; }
  try {
    await http.delete(`/tasks/${deleteTarget.value.id}`, { data: { reason: deleteReason.value.trim() } });
    toast('وظیفه حذف شد', 'ok'); deleteTarget.value = null; deleteReason.value = ''; await load();
  } catch (e) { toast(apiError(e), 'err'); }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Task Management</div><h1>مدیریت وظایف</h1></div>
      <div class="flex gap center">
        <select class="input" style="width:150px" v-model="filter">
          <option value="">همه</option><option value="PERSONAL">شخصی</option><option value="GROUP">گروهی</option>
        </select>
        <button class="btn red" @click="openCreate">+ وظیفهٔ جدید</button>
      </div>
    </div>

    <div class="panel">
      <table class="tbl">
        <thead><tr><th>کد</th><th>عنوان</th><th>نوع</th><th>مسئول</th><th>پروژه</th>
          <th>اولویت</th><th>وضعیت</th><th>سررسید</th><th class="num">عملیات</th></tr></thead>
        <tbody>
          <tr v-for="t in filtered" :key="t.id">
            <td class="mono">{{ t.task_code }}</td>
            <td><b>{{ t.title }}</b></td>
            <td><span class="badge" :class="t.kind==='GROUP' ? 'yellow' : 'blue'">{{ t.kind==='GROUP' ? 'گروهی' : 'شخصی' }}</span></td>
            <td>{{ t.kind==='GROUP' ? 'همه' : (t.assignee_name || '—') }}</td>
            <td class="muted">{{ t.project_name || '—' }}</td>
            <td><span class="badge" :class="prioColor[t.priority]">{{ prioLabel[t.priority] }}</span></td>
            <td><span class="badge" :class="statusColor[t.status]">{{ statusLabel[t.status] }}</span></td>
            <td>{{ faDate(t.due_date) }}</td>
            <td class="num">
              <div class="flex gap-s" style="justify-content:flex-end">
                <button class="btn ghost" style="padding:5px 10px" @click="openEdit(t)">ویرایش</button>
                <button class="btn ghost" style="padding:5px 10px;color:var(--bau-red)" @click="deleteTarget = t; deleteReason = ''">حذف</button>
              </div>
            </td>
          </tr>
          <tr v-if="!filtered.length && !loading"><td colspan="9" class="muted">وظیفه‌ای ثبت نشده.</td></tr>
        </tbody>
      </table>
      <p v-if="loading" class="card muted">در حال بارگذاری…</p>
    </div>

    <!-- create/edit modal -->
    <div v-if="showForm" class="modal-back" @click.self="showForm = false">
      <div class="modal">
        <h2 class="mb">{{ editId ? 'ویرایش وظیفه' : 'ایجاد و ارجاع وظیفه' }}</h2>
        <label class="fld"><span class="lab">عنوان وظیفه</span><input class="input" v-model="form.title" /></label>
        <label class="fld"><span class="lab">شرح</span><textarea class="input" rows="2" v-model="form.description"></textarea></label>
        <div class="grid grid-3" style="background:transparent;border:0;gap:14px">
          <label class="fld"><span class="lab">نوع</span>
            <select class="input" v-model="form.kind">
              <option value="PERSONAL">شخصی (به یک نفر)</option><option value="GROUP">گروهی (همه ببینند)</option>
            </select>
          </label>
          <label class="fld" v-if="form.kind === 'PERSONAL'"><span class="lab">مسئول</span>
            <select class="input" v-model="form.assigneeId">
              <option value="">— انتخاب —</option>
              <option v-for="u in directory" :key="u.id" :value="u.id">{{ u.full_name }}</option>
            </select>
          </label>
          <label class="fld"><span class="lab">پروژه (اختیاری)</span>
            <select class="input" v-model="form.projectId">
              <option value="">—</option><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
          </label>
          <label class="fld"><span class="lab">اولویت</span>
            <select class="input" v-model="form.priority"><option v-for="p in PRIOS" :key="p" :value="p">{{ prioLabel[p] }}</option></select>
          </label>
          <label class="fld"><span class="lab">وضعیت</span>
            <select class="input" v-model="form.status"><option v-for="s in STATUSES" :key="s" :value="s">{{ statusLabel[s] }}</option></select>
          </label>
          <label class="fld"><span class="lab">سررسید</span><input class="input" type="date" v-model="form.dueDate" /></label>
        </div>
        <div class="flex gap">
          <button class="btn red" :disabled="saving" @click="save"><span v-if="saving" class="spinner"></span> {{ editId ? 'ذخیره' : 'ایجاد' }}</button>
          <button class="btn ghost" @click="showForm = false">انصراف</button>
        </div>
      </div>
    </div>

    <!-- delete modal -->
    <div v-if="deleteTarget" class="modal-back" @click.self="deleteTarget = null">
      <div class="modal" style="max-width:460px">
        <h2 class="mb">حذف وظیفهٔ «{{ deleteTarget.title }}»</h2>
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
.modal { background: var(--paper-2); border: 2px solid var(--line); padding: 24px; width: 100%; max-width: 680px; max-height: 90vh; overflow:auto; }
</style>

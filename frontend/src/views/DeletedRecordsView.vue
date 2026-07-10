<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { faDate } from '../lib/format';
import { toast } from '../lib/toast';

const auth = useAuth();
const tab = ref<string>('journal');
const data = ref<Record<string, any[]>>({ journal: [], projects: [], customers: [], personnel: [], tasks: [] });
const loading = ref(false);

const tabs = computed(() => [
  { key: 'journal', label: 'اسناد حسابداری', perm: 'ledger.view' },
  { key: 'projects', label: 'پروژه‌ها', perm: 'project.manage' },
  { key: 'customers', label: 'مشتریان', perm: 'customer.manage' },
  { key: 'personnel', label: 'پرسنل', perm: 'hr.manage' },
  { key: 'tasks', label: 'وظایف', perm: 'task.manage' },
].filter((t) => auth.can(t.perm)));

const endpoints: Record<string, string> = {
  journal: '/journal/trash', projects: '/projects/trash', customers: '/customers/trash',
  personnel: '/personnel/trash', tasks: '/tasks/trash',
};

async function loadTab(t: string) {
  loading.value = true;
  try { data.value[t] = (await http.get(endpoints[t])).data; }
  catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
}

async function restore(t: string, id: string) {
  if (!confirm('بازگردانی این رکورد؟')) return;
  try {
    await http.post(`${endpoints[t].replace('/trash', '')}/${id}/restore`);
    toast('رکورد بازگردانده شد', 'ok');
    await loadTab(t);
  } catch (e) { toast(apiError(e), 'err'); }
}

function switchTab(t: any) { tab.value = t; loadTab(t); }
function titleOf(t: string, r: any) {
  if (t === 'journal') return `#${r.entry_no} — ${r.memo}`;
  if (t === 'projects') return `${r.code} — ${r.name}`;
  if (t === 'customers') return `${r.code} — ${r.display_name}`;
  if (t === 'personnel') return `${r.employee_code} — ${r.full_name}`;
  if (t === 'tasks') return `${r.task_code} — ${r.title}`;
  return r.id;
}

onMounted(() => { if (tabs.value.length) switchTab(tabs.value[0].key); });
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Recycle Bin · Audit</div><h1>رکوردهای حذف‌شده</h1></div>
    </div>
    <p class="muted mb">هیچ رکوردی برای همیشه حذف نمی‌شود. اینجا می‌توانید ببینید چه چیزی، توسط چه کسی، چه زمانی و با چه دلیلی حذف شده و در صورت نیاز آن را بازگردانید.</p>

    <div class="flex gap mb">
      <button v-for="t in tabs" :key="t.key" class="btn" :class="tab === t.key ? 'red' : 'ghost'" @click="switchTab(t.key)">{{ t.label }}</button>
    </div>

    <div class="panel">
      <table class="tbl">
        <thead><tr><th>رکورد</th><th>حذف‌کننده</th><th>تاریخ حذف</th><th>دلیل حذف</th><th class="num">عملیات</th></tr></thead>
        <tbody>
          <tr v-for="r in data[tab]" :key="r.id">
            <td><b>{{ titleOf(tab, r) }}</b></td>
            <td>{{ r.deleted_by_name || '—' }}</td>
            <td class="muted">{{ faDate(r.deleted_at) }}</td>
            <td>{{ r.deleted_reason || '—' }}</td>
            <td class="num"><button class="btn ghost" style="padding:5px 10px;color:var(--pos)" @click="restore(tab, r.id)">بازگردانی</button></td>
          </tr>
          <tr v-if="!data[tab].length && !loading"><td colspan="5" class="muted">رکورد حذف‌شده‌ای وجود ندارد.</td></tr>
        </tbody>
      </table>
      <p v-if="loading" class="card muted">در حال بارگذاری…</p>
    </div>
  </div>
</template>

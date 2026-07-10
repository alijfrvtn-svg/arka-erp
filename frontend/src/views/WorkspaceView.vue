<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { faDate, money } from '../lib/format';
import { toast } from '../lib/toast';

const auth = useAuth();
const me = ref<any | null>(null);
const mine = ref<any[]>([]);
const group = ref<any[]>([]);
const loading = ref(true);

const statusLabel: Record<string, string> = { TODO:'انجام‌نشده', IN_PROGRESS:'در حال انجام', DONE:'انجام‌شده', BLOCKED:'متوقف' };
const statusColor: Record<string, string> = { TODO:'gray', IN_PROGRESS:'blue', DONE:'green', BLOCKED:'red' };
const prioLabel: Record<string, string> = { LOW:'کم', NORMAL:'عادی', HIGH:'زیاد', URGENT:'فوری' };
const prioColor: Record<string, string> = { LOW:'gray', NORMAL:'blue', HIGH:'yellow', URGENT:'red' };
const STATUSES = ['TODO','IN_PROGRESS','DONE','BLOCKED'];

async function load() {
  loading.value = true;
  try {
    const [m, mt, gt] = await Promise.all([
      http.get('/personnel/me').then(r => r.data).catch(() => null),
      http.get('/tasks/mine').then(r => r.data),
      http.get('/tasks/group').then(r => r.data),
    ]);
    me.value = m; mine.value = mt; group.value = gt;
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
}

async function setStatus(t: any, status: string) {
  try {
    const updated = (await http.patch(`/tasks/${t.id}/status`, { status })).data;
    Object.assign(t, updated);
    toast('وضعیت به‌روزرسانی شد', 'ok');
  } catch (e) { toast(apiError(e), 'err'); await load(); }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">My Workspace</div><h1>میز کار من</h1></div>
      <div class="muted">{{ auth.user?.fullName }}</div>
    </div>

    <!-- my personnel info -->
    <div class="panel mb" v-if="me">
      <header><h3>اطلاعات پرسنلی من</h3><span class="badge blue mono">{{ me.employee_code }}</span></header>
      <div class="card">
        <div class="grid grid-4" style="background:transparent;border:0;gap:16px">
          <div><div class="lab">نام</div><b>{{ me.full_name }}</b></div>
          <div><div class="lab">سمت</div><b>{{ me.position_title || '—' }}</b></div>
          <div><div class="lab">واحد</div><b>{{ me.department || '—' }}</b></div>
          <div><div class="lab">تاریخ استخدام</div><b>{{ faDate(me.hire_date) }}</b></div>
          <div><div class="lab">تلفن</div><b class="mono">{{ me.phone || '—' }}</b></div>
          <div><div class="lab">ایمیل</div><b>{{ me.email || '—' }}</b></div>
          <div><div class="lab">کد ملی</div><b class="mono">{{ me.national_id_last4 ? '••••'+me.national_id_last4 : '—' }}</b></div>
          <div><div class="lab">وضعیت</div><span class="badge green">{{ me.employment_status }}</span></div>
        </div>
      </div>
    </div>
    <div class="panel mb" v-else-if="!loading">
      <div class="card muted">هنوز پروندهٔ پرسنلی برای حساب شما ثبت نشده است. مدیر می‌تواند از بخش «پرسنل» آن را ایجاد و به حساب شما متصل کند.</div>
    </div>

    <div class="grid grid-2" style="background:transparent;border:0;gap:24px">
      <!-- my personal tasks -->
      <div class="panel">
        <header><h3>وظایف من</h3><span class="badge gray mono">{{ mine.length }}</span></header>
        <div class="body">
          <table class="tbl">
            <tbody>
              <tr v-for="t in mine" :key="t.id">
                <td>
                  <b>{{ t.title }}</b>
                  <div class="muted" style="font-size:11px">
                    {{ t.project_name ? 'پروژه: '+t.project_name+' · ' : '' }}{{ t.due_date ? 'سررسید '+faDate(t.due_date) : '' }}
                  </div>
                </td>
                <td><span class="badge" :class="prioColor[t.priority]">{{ prioLabel[t.priority] }}</span></td>
                <td class="num">
                  <select class="input" style="padding:5px 8px;width:auto" :value="t.status"
                          @change="setStatus(t, ($event.target as HTMLSelectElement).value)">
                    <option v-for="s in STATUSES" :key="s" :value="s">{{ statusLabel[s] }}</option>
                  </select>
                </td>
              </tr>
              <tr v-if="!mine.length && !loading"><td class="muted">وظیفهٔ شخصی‌ای به شما ارجاع نشده.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- group tasks -->
      <div class="panel">
        <header><h3>تسک‌های گروهی تیم</h3><span class="badge gray mono">{{ group.length }}</span></header>
        <div class="body">
          <table class="tbl">
            <tbody>
              <tr v-for="t in group" :key="t.id">
                <td>
                  <b>{{ t.title }}</b>
                  <div class="muted" style="font-size:11px">{{ t.description || '' }}</div>
                </td>
                <td><span class="badge" :class="statusColor[t.status]">{{ statusLabel[t.status] }}</span></td>
                <td class="num">
                  <select class="input" style="padding:5px 8px;width:auto" :value="t.status"
                          @change="setStatus(t, ($event.target as HTMLSelectElement).value)">
                    <option v-for="s in STATUSES" :key="s" :value="s">{{ statusLabel[s] }}</option>
                  </select>
                </td>
              </tr>
              <tr v-if="!group.length && !loading"><td class="muted">تسک گروهی‌ای ثبت نشده.</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

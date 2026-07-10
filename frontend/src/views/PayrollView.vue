<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { http, apiError } from '../api/client';
import { faDate, money, faNum } from '../lib/format';
import { toast } from '../lib/toast';

const runs = ref<any[]>([]);
const loading = ref(true);
const busy = ref(false);
const detail = ref<any | null>(null);
const showForm = ref(false);
const form = ref({ periodCode: '', taxPct: 10, insurancePct: 7, notes: '' });

async function load() {
  loading.value = true;
  try { runs.value = (await http.get('/payroll/runs')).data; }
  catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
}

async function createRun() {
  if (!form.value.periodCode.trim()) { toast('کد دوره لازم است (مثلاً 1405-04)', 'err'); return; }
  busy.value = true;
  try {
    const r = (await http.post('/payroll/runs', {
      periodCode: form.value.periodCode.trim(),
      taxPct: Number(form.value.taxPct), insurancePct: Number(form.value.insurancePct),
      notes: form.value.notes || undefined,
    })).data;
    toast('دورهٔ حقوق ایجاد و فیش‌ها تولید شد', 'ok');
    showForm.value = false; detail.value = r; await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { busy.value = false; }
}

async function view(r: any) {
  try { detail.value = (await http.get(`/payroll/runs/${r.id}`)).data; }
  catch (e) { toast(apiError(e), 'err'); }
}

async function post(r: any) {
  if (!confirm(`ثبت سند حسابداری برای دورهٔ ${r.period_code}؟`)) return;
  busy.value = true;
  try {
    detail.value = (await http.post(`/payroll/runs/${r.id}/post`)).data;
    toast('سند حقوق ثبت و قطعی شد', 'ok'); await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { busy.value = false; }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Payroll</div><h1>حقوق و دستمزد</h1></div>
      <button class="btn red" @click="showForm = true; form = { periodCode:'', taxPct:10, insurancePct:7, notes:'' }">+ اجرای دورهٔ جدید</button>
    </div>

    <div class="grid grid-2" style="background:transparent;border:0;gap:24px">
      <div class="panel">
        <header><h3>دوره‌های حقوق</h3></header>
        <div class="body">
          <table class="tbl">
            <thead><tr><th>دوره</th><th>تاریخ</th><th class="num">نفرات</th><th class="num">خالص کل</th><th>وضعیت</th><th class="num"></th></tr></thead>
            <tbody>
              <tr v-for="r in runs" :key="r.id">
                <td class="mono">{{ r.period_code }}</td>
                <td>{{ faDate(r.run_date) }}</td>
                <td class="num">{{ faNum(r.headcount) }}</td>
                <td class="num">{{ money(r.total_net, { unit: false, toman: true }) }}</td>
                <td><span class="badge" :class="r.status==='POSTED' ? 'green' : 'yellow'">{{ r.status==='POSTED' ? 'ثبت‌شده' : 'پیش‌نویس' }}</span></td>
                <td class="num">
                  <div class="flex gap-s" style="justify-content:flex-end">
                    <button class="btn ghost" style="padding:5px 10px" @click="view(r)">فیش‌ها</button>
                    <button v-if="r.status !== 'POSTED'" class="btn ghost" style="padding:5px 10px;color:var(--pos)" :disabled="busy" @click="post(r)">ثبت سند</button>
                  </div>
                </td>
              </tr>
              <tr v-if="!runs.length && !loading"><td colspan="6" class="muted">دوره‌ای اجرا نشده.</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <header><h3>فیش‌های حقوقی {{ detail ? '· دورهٔ '+detail.period_code : '' }}</h3></header>
        <div class="body">
          <table class="tbl" v-if="detail">
            <thead><tr><th>پرسنل</th><th class="num">پایه</th><th class="num">مالیات</th><th class="num">بیمه</th><th class="num">خالص</th></tr></thead>
            <tbody>
              <tr v-for="s in detail.payslips" :key="s.id">
                <td>{{ s.personnel_name }}<div class="muted mono" style="font-size:11px">{{ s.employee_code }}</div></td>
                <td class="num">{{ money(s.base_salary, { unit: false, toman: true }) }}</td>
                <td class="num neg">{{ money(s.tax, { unit: false, toman: true }) }}</td>
                <td class="num neg">{{ money(s.insurance, { unit: false, toman: true }) }}</td>
                <td class="num"><b>{{ money(s.net, { unit: false, toman: true }) }}</b></td>
              </tr>
            </tbody>
            <tfoot><tr><td>جمع خالص</td><td colspan="3"></td><td class="num">{{ money(detail.total_net, { unit: false, toman: true }) }}</td></tr></tfoot>
          </table>
          <p v-else class="card muted">برای مشاهدهٔ فیش‌ها یک دوره را انتخاب کنید.</p>
        </div>
      </div>
    </div>

    <!-- new run modal -->
    <div v-if="showForm" class="modal-back" @click.self="showForm = false">
      <div class="modal" style="max-width:520px">
        <h2 class="mb">اجرای دورهٔ حقوق</h2>
        <p class="muted mb">فیش‌ها برای همهٔ پرسنل «شاغل» با حقوق پایه ثبت‌شده تولید می‌شوند. مالیات و بیمه به‌صورت درصدی از پایه کسر می‌شوند.</p>
        <div class="grid grid-3" style="background:transparent;border:0;gap:14px">
          <label class="fld"><span class="lab">کد دوره</span><input class="input mono" v-model="form.periodCode" placeholder="1405-04" /></label>
          <label class="fld"><span class="lab">مالیات (٪)</span><input class="input mono" type="number" v-model="form.taxPct" /></label>
          <label class="fld"><span class="lab">بیمه (٪)</span><input class="input mono" type="number" v-model="form.insurancePct" /></label>
        </div>
        <label class="fld"><span class="lab">توضیحات</span><input class="input" v-model="form.notes" /></label>
        <div class="flex gap">
          <button class="btn red" :disabled="busy" @click="createRun"><span v-if="busy" class="spinner"></span> تولید فیش‌ها</button>
          <button class="btn ghost" @click="showForm = false">انصراف</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-back { position: fixed; inset: 0; background: rgba(10,10,10,.55); display:flex; align-items:center; justify-content:center; z-index: 50; padding: 24px; }
.modal { background: var(--paper-2); border: 2px solid var(--line); padding: 24px; width: 100%; max-width: 680px; max-height: 90vh; overflow:auto; }
</style>

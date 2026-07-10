<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { money, faDate } from '../lib/format';
import { toast } from '../lib/toast';

const auth = useAuth();
const router = useRouter();
const rows = ref<any[]>([]);
const loading = ref(true);
const statusFilter = ref('');

const detail = ref<any | null>(null);
const reverseTarget = ref<any | null>(null);
const reverseMemo = ref('');
const deleteTarget = ref<any | null>(null);
const deleteReason = ref('');
const busy = ref(false);

const statusLabel: Record<string, string> = {
  DRAFT: 'پیش‌نویس', POSTED: 'قطعی', REVERSED: 'برگشت‌خورده', VOID: 'باطل',
};
const statusColor: Record<string, string> = {
  DRAFT: 'yellow', POSTED: 'green', REVERSED: 'gray', VOID: 'red',
};

async function load() {
  loading.value = true;
  try {
    rows.value = (await http.get('/journal', { params: { status: statusFilter.value || undefined, limit: 200 } })).data;
  } catch (e) { toast(apiError(e), 'err'); } finally { loading.value = false; }
}

async function view(r: any) {
  try { detail.value = (await http.get(`/journal/${r.id}`)).data; }
  catch (e) { toast(apiError(e), 'err'); }
}

async function postEntry(r: any) {
  busy.value = true;
  try { await http.post(`/journal/${r.id}/post`); toast('سند قطعی شد', 'ok'); await load(); }
  catch (e) { toast(apiError(e), 'err'); } finally { busy.value = false; }
}

async function doDelete() {
  if (!deleteReason.value.trim()) { toast('دلیل حذف الزامی است', 'err'); return; }
  busy.value = true;
  try {
    await http.delete(`/journal/${deleteTarget.value.id}`, { data: { reason: deleteReason.value.trim() } });
    toast('پیش‌نویس حذف شد (در «رکوردهای حذف‌شده» قابل مشاهده است)', 'ok');
    deleteTarget.value = null; deleteReason.value = '';
    await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { busy.value = false; }
}

async function doReverse() {
  if (!reverseTarget.value) return;
  busy.value = true;
  try {
    await http.post(`/journal/${reverseTarget.value.id}/reverse`, { memo: reverseMemo.value || undefined });
    toast('سند برگشت خورد (سند معکوس ثبت شد)', 'ok');
    reverseTarget.value = null; reverseMemo.value = '';
    await load();
  } catch (e) { toast(apiError(e), 'err'); } finally { busy.value = false; }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div><div class="eyebrow">Journal Entries</div><h1>اسناد حسابداری</h1></div>
      <div class="flex gap center">
        <select class="input" style="width:170px" v-model="statusFilter" @change="load">
          <option value="">همهٔ وضعیت‌ها</option>
          <option value="DRAFT">پیش‌نویس</option>
          <option value="POSTED">قطعی</option>
          <option value="REVERSED">برگشت‌خورده</option>
        </select>
        <RouterLink v-if="auth.can('ledger.create')" :to="{ name: 'journal-new' }" class="btn red">+ سند جدید</RouterLink>
      </div>
    </div>

    <div class="panel">
      <table class="tbl">
        <thead><tr><th>شماره</th><th>تاریخ</th><th>شرح</th><th>منبع</th><th>وضعیت</th>
          <th class="num">مبلغ</th><th class="num">عملیات</th></tr></thead>
        <tbody>
          <tr v-for="r in rows" :key="r.id">
            <td class="mono">#{{ r.entry_no }}</td>
            <td>{{ faDate(r.entry_date) }}</td>
            <td>{{ r.memo }}</td>
            <td><span class="badge gray">{{ r.source }}</span></td>
            <td><span class="badge" :class="statusColor[r.status]">{{ statusLabel[r.status] || r.status }}</span></td>
            <td class="num">{{ money(r.total_debit, { unit: false, toman: true }) }}</td>
            <td class="num">
              <div class="flex gap-s" style="justify-content:flex-end;flex-wrap:wrap">
                <button class="btn ghost" style="padding:5px 10px" @click="view(r)">مشاهده</button>
                <template v-if="r.status === 'DRAFT'">
                  <button v-if="auth.can('ledger.create')" class="btn ghost" style="padding:5px 10px"
                          @click="router.push({ name: 'journal-edit', params: { id: r.id } })">ویرایش</button>
                  <button v-if="auth.can('ledger.post')" class="btn ghost" style="padding:5px 10px;color:var(--pos)"
                          :disabled="busy" @click="postEntry(r)">قطعی‌سازی</button>
                  <button v-if="auth.can('ledger.create')" class="btn ghost" style="padding:5px 10px;color:var(--bau-red)"
                          @click="deleteTarget = r; deleteReason = ''">حذف</button>
                </template>
                <button v-else-if="r.status === 'POSTED' && auth.can('ledger.reverse')"
                        class="btn ghost" style="padding:5px 10px;color:var(--bau-red)"
                        @click="reverseTarget = r; reverseMemo = ''">برگشت سند</button>
              </div>
            </td>
          </tr>
          <tr v-if="!rows.length && !loading"><td colspan="7" class="muted">سندی یافت نشد.</td></tr>
        </tbody>
      </table>
      <p v-if="loading" class="card muted">در حال بارگذاری…</p>
    </div>

    <!-- detail modal -->
    <div v-if="detail" class="modal-back" @click.self="detail = null">
      <div class="modal">
        <div class="flex between center mb">
          <h2>سند #{{ detail.entry_no }}</h2>
          <button class="btn ghost" @click="detail = null">✕</button>
        </div>
        <div class="muted mb">{{ detail.memo }} · {{ faDate(detail.entry_date) }}</div>
        <table class="tbl">
          <thead><tr><th>حساب</th><th>شرح</th><th class="num">بدهکار</th><th class="num">بستانکار</th></tr></thead>
          <tbody>
            <tr v-for="l in detail.lines" :key="l.id">
              <td><b>{{ l.account_code }}</b> {{ l.account_name }}</td>
              <td class="muted">{{ l.memo || '—' }}</td>
              <td class="num">{{ l.debit !== '0' ? money(l.debit, { unit: false, toman: true }) : '—' }}</td>
              <td class="num">{{ l.credit !== '0' ? money(l.credit, { unit: false, toman: true }) : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- reverse modal -->
    <div v-if="reverseTarget" class="modal-back" @click.self="reverseTarget = null">
      <div class="modal" style="max-width:460px">
        <h2 class="mb">برگشت سند #{{ reverseTarget.entry_no }}</h2>
        <p class="muted mb">یک سند معکوس ثبت می‌شود که اثر مالی این سند را خنثی می‌کند. سند اصلی حذف نمی‌شود (ردپا حفظ می‌گردد).</p>
        <label class="fld"><span class="lab">شرح سند برگشت (اختیاری)</span>
          <input class="input" v-model="reverseMemo" placeholder="دلیل برگشت…" /></label>
        <div class="flex gap">
          <button class="btn red" :disabled="busy" @click="doReverse"><span v-if="busy" class="spinner"></span> تأیید برگشت</button>
          <button class="btn ghost" @click="reverseTarget = null">انصراف</button>
        </div>
      </div>
    </div>

    <!-- delete (with mandatory reason) modal -->
    <div v-if="deleteTarget" class="modal-back" @click.self="deleteTarget = null">
      <div class="modal" style="max-width:460px">
        <h2 class="mb">حذف پیش‌نویس #{{ deleteTarget.entry_no }}</h2>
        <p class="muted mb">حذف دائمی نیست؛ رکورد با نام شما، تاریخ و دلیل در «رکوردهای حذف‌شده» ثبت و قابل بازگردانی است.</p>
        <label class="fld"><span class="lab">دلیل حذف (الزامی)</span>
          <textarea class="input" rows="2" v-model="deleteReason" placeholder="چرا این سند حذف می‌شود؟"></textarea></label>
        <div class="flex gap">
          <button class="btn red" :disabled="busy || !deleteReason.trim()" @click="doDelete"><span v-if="busy" class="spinner"></span> حذف</button>
          <button class="btn ghost" @click="deleteTarget = null">انصراف</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-back { position: fixed; inset: 0; background: rgba(10,10,10,.55); display:flex; align-items:center; justify-content:center; z-index: 50; padding: 24px; }
.modal { background: var(--paper-2); border: 2px solid var(--line); padding: 24px; width: 100%; max-width: 640px; max-height: 86vh; overflow:auto; }
</style>

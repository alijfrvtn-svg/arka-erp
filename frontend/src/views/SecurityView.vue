<script setup lang="ts">
import { ref } from 'vue';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { toast } from '../lib/toast';

const auth = useAuth();
const enroll = ref<{ qr: string; otpauthUrl: string } | null>(null);
const activateCode = ref('');
const stepUpCode = ref('');
const busy = ref(false);

async function startEnroll() {
  busy.value = true;
  try { enroll.value = (await http.post('/auth/mfa/enroll')).data; }
  catch (e) { toast(apiError(e), 'err'); } finally { busy.value = false; }
}
async function activate() {
  try {
    await http.post('/auth/mfa/activate', { token: activateCode.value });
    toast('احراز هویت دومرحله‌ای فعال شد. برای اعمال کامل، دوباره وارد شوید.', 'ok');
    enroll.value = null; activateCode.value = '';
  } catch (e) { toast(apiError(e), 'err'); }
}
async function doStepUp() {
  try {
    await auth.stepUp(stepUpCode.value);
    toast('تأیید امنیتی انجام شد؛ اکنون می‌توانید عملیات حساس را اجرا کنید.', 'ok');
    stepUpCode.value = '';
  } catch (e) { toast(apiError(e), 'err'); }
}
</script>

<template>
  <div>
    <div class="page-head"><div><div class="eyebrow">Security</div><h1>امنیت و احراز هویت دومرحله‌ای</h1></div></div>

    <div class="grid grid-2" style="background:transparent;border:0;gap:24px">
      <div class="panel">
        <header><h3>راه‌اندازی MFA (TOTP)</h3>
          <span class="badge" :class="auth.user?.mfaEnabled ? 'green' : 'gray'">
            {{ auth.user?.mfaEnabled ? 'فعال' : 'غیرفعال' }}</span>
        </header>
        <div class="card">
          <p class="muted mb">
            احراز هویت دومرحله‌ای فقط برای <b>عملیات حساس</b> (انتقال وجه، برگشت سند، بستن دوره) لازم می‌شود.
          </p>
          <button v-if="!enroll" class="btn blue" :disabled="busy" @click="startEnroll">
            <span v-if="busy" class="spinner"></span> دریافت QR فعال‌سازی
          </button>

          <div v-if="enroll">
            <img :src="enroll.qr" alt="QR" style="width:180px;height:180px;border:1px solid var(--line)" />
            <p class="muted mono" style="font-size:11px;word-break:break-all;margin-top:8px">{{ enroll.otpauthUrl }}</p>
            <label class="fld mt"><span class="lab">کد ۶ رقمی برنامهٔ Authenticator</span>
              <input class="input mono" v-model="activateCode" maxlength="6" placeholder="123456" /></label>
            <button class="btn red" @click="activate">فعال‌سازی</button>
          </div>
        </div>
      </div>

      <div class="panel">
        <header><h3>تأیید امنیتی (Step-up)</h3></header>
        <div class="card">
          <p class="muted mb">پیش از اجرای یک عملیات حساس، کد فعلی Authenticator را وارد کنید تا توکن کوتاه‌عمر صادر شود.</p>
          <label class="fld"><span class="lab">کد ۶ رقمی</span>
            <input class="input mono" v-model="stepUpCode" maxlength="6" placeholder="123456" /></label>
          <button class="btn" @click="doStepUp">تأیید</button>
        </div>
      </div>
    </div>
  </div>
</template>

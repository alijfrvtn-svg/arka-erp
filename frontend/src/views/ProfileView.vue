<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { http, apiError } from '../api/client';
import { useAuth } from '../stores/auth';
import { toast } from '../lib/toast';

const auth = useAuth();
const router = useRouter();

const fullName = ref(auth.user?.fullName || '');
const email = ref(auth.user?.email || '');
const savingProfile = ref(false);

const curPass = ref(''); const newPass = ref(''); const confirmPass = ref('');

const enroll = ref<{ qr: string; otpauthUrl: string } | null>(null);
const mfaCode = ref('');

async function saveProfile() {
  const oldEmail = (auth.user?.email || '').trim().toLowerCase();
  const newEmail = email.value.trim().toLowerCase();
  const emailChanged = !!newEmail && newEmail !== oldEmail;
  if (emailChanged && !confirm(
    `ایمیل (نام کاربری) شما از «${auth.user?.email}» به «${email.value}» تغییر می‌کند.\n` +
    `پس از ذخیره، از حساب خارج می‌شوید و باید با ایمیل جدید دوباره وارد شوید. ادامه می‌دهید؟`)) {
    return;
  }
  savingProfile.value = true;
  try {
    await auth.updateProfile({ fullName: fullName.value, email: email.value });
    if (emailChanged) {
      toast(`نام کاربری به «${email.value}» تغییر کرد. با همین ایمیل دوباره وارد شوید.`, 'ok');
      await auth.logout();
      router.push({ name: 'login' });
    } else {
      toast('پروفایل به‌روزرسانی شد', 'ok');
    }
  } catch (e) { toast(apiError(e), 'err'); } finally { savingProfile.value = false; }
}

async function changePassword() {
  if (newPass.value !== confirmPass.value) { toast('تکرار گذرواژه مطابقت ندارد', 'err'); return; }
  if (newPass.value.length < 8) { toast('گذرواژهٔ جدید باید حداقل ۸ نویسه باشد', 'err'); return; }
  const loginEmail = auth.user?.email;
  try {
    await auth.changePassword(curPass.value, newPass.value);
    toast(`گذرواژه تغییر کرد. با ایمیل «${loginEmail}» و گذرواژهٔ جدید وارد شوید.`, 'ok');
    await auth.logout();
    router.push({ name: 'login' });
  } catch (e) { toast(apiError(e), 'err'); }
}

async function startEnroll() {
  try { enroll.value = (await http.post('/auth/mfa/enroll')).data; }
  catch (e) { toast(apiError(e), 'err'); }
}
async function activate() {
  try {
    await http.post('/auth/mfa/activate', { token: mfaCode.value });
    await auth.fetchMe();
    enroll.value = null; mfaCode.value = '';
    toast('احراز دومرحله‌ای فعال شد. از این پس هنگام ورود لازم می‌شود.', 'ok');
  } catch (e) { toast(apiError(e), 'err'); }
}
async function disable() {
  try { await auth.disableMfa(mfaCode.value); mfaCode.value = ''; toast('احراز دومرحله‌ای غیرفعال شد', 'ok'); }
  catch (e) { toast(apiError(e), 'err'); }
}
</script>

<template>
  <div>
    <div class="page-head"><div><div class="eyebrow">My Account</div><h1>پروفایل من</h1></div></div>

    <div class="grid grid-2" style="background:transparent;border:0;gap:24px">
      <!-- profile -->
      <div class="panel">
        <header><h3>اطلاعات حساب</h3></header>
        <div class="card">
          <label class="fld"><span class="lab">نام و نام خانوادگی</span>
            <input class="input" v-model="fullName" /></label>
          <label class="fld"><span class="lab">پست الکترونیک (نام کاربری)</span>
            <input class="input" v-model="email" type="email" /></label>
          <div class="muted mb" style="font-size:12px">نقش: <b>{{ auth.user?.role }}</b> (تعیین نقش با مدیر سیستم است)</div>
          <button class="btn" :disabled="savingProfile" @click="saveProfile">ذخیرهٔ تغییرات</button>
        </div>
      </div>

      <!-- password -->
      <div class="panel">
        <header><h3>تغییر گذرواژه</h3></header>
        <div class="card">
          <label class="fld"><span class="lab">گذرواژهٔ فعلی</span>
            <input class="input" type="password" v-model="curPass" autocomplete="current-password" /></label>
          <label class="fld"><span class="lab">گذرواژهٔ جدید</span>
            <input class="input" type="password" v-model="newPass" autocomplete="new-password" /></label>
          <label class="fld"><span class="lab">تکرار گذرواژهٔ جدید</span>
            <input class="input" type="password" v-model="confirmPass" autocomplete="new-password" /></label>
          <button class="btn red" @click="changePassword">تغییر گذرواژه</button>
          <p class="muted" style="font-size:11px;margin-top:8px">پس از تغییر، همهٔ نشست‌ها بسته و باید دوباره وارد شوید.</p>
        </div>
      </div>
    </div>

    <!-- MFA -->
    <div class="panel mt">
      <header><h3>احراز هویت دومرحله‌ای (MFA)</h3>
        <span class="badge" :class="auth.user?.mfaEnabled ? 'green' : 'gray'">
          {{ auth.user?.mfaEnabled ? 'فعال' : 'غیرفعال' }}</span>
      </header>
      <div class="card">
        <template v-if="auth.user?.mfaEnabled">
          <p class="muted mb">MFA فعال است و هنگام ورود از شما کد خواسته می‌شود. برای غیرفعال‌سازی، کد فعلی را وارد کنید:</p>
          <div class="flex gap center">
            <input class="input mono" style="max-width:160px" v-model="mfaCode" maxlength="6" placeholder="۱۲۳۴۵۶" />
            <button class="btn ghost" @click="disable">غیرفعال‌سازی MFA</button>
          </div>
        </template>

        <template v-else>
          <button v-if="!enroll" class="btn blue" @click="startEnroll">راه‌اندازی MFA</button>
          <div v-else class="flex gap wrap" style="align-items:flex-start">
            <img :src="enroll.qr" alt="QR" style="width:170px;height:170px;border:1px solid var(--line)" />
            <div style="flex:1;min-width:220px">
              <p class="muted mb">QR را با Google Authenticator / Authy اسکن کنید، سپس کد ۶ رقمی را وارد کنید:</p>
              <div class="flex gap center">
                <input class="input mono" style="max-width:160px" v-model="mfaCode" maxlength="6" placeholder="۱۲۳۴۵۶" />
                <button class="btn red" @click="activate">فعال‌سازی</button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

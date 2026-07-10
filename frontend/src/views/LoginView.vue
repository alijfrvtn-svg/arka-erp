<script setup lang="ts">
import { ref } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuth } from '../stores/auth';
import ArkaLogo from '../components/ArkaLogo.vue';

const auth = useAuth();
const router = useRouter();
const route = useRoute();

const email = ref('');
const password = ref('');
const totp = ref('');
const mfaStep = ref(false);
const error = ref('');
const loading = ref(false);

async function submit() {
  error.value = '';
  loading.value = true;
  try {
    const res = await auth.login(email.value.trim(), password.value, mfaStep.value ? totp.value : undefined);
    if (res.mfaRequired) { mfaStep.value = true; return; }
    router.push((route.query.redirect as string) || '/');
  } catch (e: any) {
    error.value = e.message || 'ورود ناموفق بود';
  } finally {
    loading.value = false;
  }
}
function back() { mfaStep.value = false; totp.value = ''; error.value = ''; }
</script>

<template>
  <div class="login-wrap">
    <div class="login-art">
      <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
      <div class="cap">
        <ArkaLogo :size="64" wordmark light />
        <h1 style="color:#fff;font-size:38px;line-height:1.15;margin-top:26px;font-weight:800">
          سامانهٔ مالی و مدیریت<br />منابع سازمانی
        </h1>
        <p style="color:#c7d6fb;margin-top:14px;max-width:360px;line-height:1.9">
          حسابداری دوطرفه، مدیریت پروژه، منابع انسانی، وظایف تیمی و حقوق‌ودستمزد — یکپارچه، نرم و امن.
        </p>
        <p style="color:#8fa6e0;margin-top:26px;font-size:12px">صادرکنندهٔ اسناد رسمی: علی جعفری</p>
      </div>
    </div>

    <div class="login-form-wrap">
      <div class="login-card">
        <div style="margin-bottom:26px">
          <ArkaLogo :size="52" />
          <h1 style="margin-top:20px">{{ mfaStep ? 'تأیید دومرحله‌ای' : 'ورود به سامانه' }}</h1>
          <p class="muted" style="margin-top:6px">
            {{ mfaStep ? 'کد ۶ رقمی برنامهٔ Authenticator را وارد کنید' : 'با حساب سازمانی خود وارد شوید' }}
          </p>
        </div>

        <form @submit.prevent="submit">
          <template v-if="!mfaStep">
            <label class="fld"><span class="lab">پست الکترونیک</span>
              <input class="input" type="email" v-model="email" autocomplete="username" placeholder="you@example.com" required /></label>
            <label class="fld"><span class="lab">گذرواژه</span>
              <input class="input" type="password" v-model="password" autocomplete="current-password" placeholder="••••••••" required /></label>
          </template>
          <template v-else>
            <label class="fld"><span class="lab">کد تأیید</span>
              <input class="input mono" style="letter-spacing:.5em;text-align:center;font-size:22px"
                     v-model="totp" maxlength="6" inputmode="numeric" placeholder="۱۲۳۴۵۶" autofocus /></label>
          </template>

          <div v-if="error" class="badge red" style="display:block;padding:11px 14px;margin-bottom:14px;text-transform:none;border-radius:var(--r)">{{ error }}</div>

          <button class="btn red" style="width:100%" :disabled="loading">
            <span v-if="loading" class="spinner"></span>
            <span>{{ loading ? 'در حال بررسی…' : (mfaStep ? 'تأیید و ورود' : 'ورود') }}</span>
          </button>
          <button v-if="mfaStep" type="button" class="btn ghost" style="width:100%;margin-top:10px" @click="back">بازگشت</button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { RouterView, RouterLink, useRoute, useRouter } from 'vue-router';
import { useAuth } from '../stores/auth';
import { toastState } from '../lib/toast';
import ArkaLogo from './ArkaLogo.vue';

const auth = useAuth();
const route = useRoute();
const router = useRouter();
const navOpen = ref(false);

interface NavItem { name: string; label: string; perm?: string; color: string; }
interface NavGroup { label: string; items: NavItem[]; }

const groups: NavGroup[] = [
  { label: 'میز کار', items: [
    { name: 'workspace', label: 'میز کار من', color: 'var(--b-200)' },
  ]},
  { label: 'نمای کلی', items: [
    { name: 'dashboard', label: 'داشبورد مدیریت', perm: 'report.ceo', color: 'var(--b-400)' },
  ]},
  { label: 'مالی و حسابداری', items: [
    { name: 'journal-entries', label: 'اسناد حسابداری', perm: 'ledger.view', color: 'var(--b-400)' },
    { name: 'ledger', label: 'دفتر روزنامه', perm: 'ledger.view', color: 'var(--b-400)' },
    { name: 'journal-new', label: 'ثبت سند جدید', perm: 'ledger.create', color: 'var(--b-400)' },
    { name: 'accounts', label: 'سرفصل حساب‌ها', perm: 'ledger.view', color: 'var(--b-400)' },
    { name: 'trial-balance', label: 'تراز آزمایشی', perm: 'report.financial', color: 'var(--b-200)' },
    { name: 'profit-loss', label: 'سود و زیان', perm: 'report.financial', color: 'var(--b-200)' },
    { name: 'balance-sheet', label: 'ترازنامه', perm: 'report.financial', color: 'var(--b-200)' },
  ]},
  { label: 'عملیات', items: [
    { name: 'projects', label: 'پروژه‌ها', perm: 'project.view', color: 'var(--b-100)' },
    { name: 'customers', label: 'مشتریان', perm: 'customer.view', color: 'var(--b-100)' },
  ]},
  { label: 'تیم و منابع انسانی', items: [
    { name: 'task-mgmt', label: 'مدیریت وظایف', perm: 'task.manage', color: 'var(--b-200)' },
    { name: 'personnel', label: 'پرسنل', perm: 'hr.view', color: 'var(--b-200)' },
    { name: 'payroll', label: 'حقوق و دستمزد', perm: 'payroll.run', color: 'var(--b-200)' },
  ]},
  { label: 'بایگانی', items: [
    { name: 'trash', label: 'رکوردهای حذف‌شده', color: 'var(--ink-3)' },
  ]},
  { label: 'سامانه', items: [
    { name: 'users', label: 'مدیریت کاربران', perm: 'user.manage', color: 'var(--b-400)' },
    { name: 'profile', label: 'پروفایل من', color: 'var(--ink-3)' },
    { name: 'system', label: 'سلامت سیستم', perm: 'system.admin', color: 'var(--ink-3)' },
  ]},
];

const visibleGroups = computed(() =>
  groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || auth.can(i.perm)) }))
    .filter((g) => g.items.length > 0),
);

const roleLabel: Record<string, string> = {
  CEO: 'مدیرعامل', ACCOUNTANT: 'حسابدار', SALES: 'فروش', DESIGNER: 'طراح',
  DEVELOPER: 'برنامه‌نویس', PHOTOGRAPHER: 'عکاس', CUSTOMER: 'مشتری', GUEST: 'مهمان',
};

watch(() => route.fullPath, () => { navOpen.value = false; });

async function doLogout() {
  await auth.logout();
  router.push({ name: 'login' });
}
</script>

<template>
  <div class="app-shell" :class="{ 'nav-open': navOpen }">
    <div class="drawer-scrim" @click="navOpen = false"></div>

    <aside class="sidebar">
      <div class="brand">
        <ArkaLogo :size="42" wordmark light />
      </div>
      <nav class="nav">
        <template v-for="g in visibleGroups" :key="g.label">
          <div class="group-label">{{ g.label }}</div>
          <RouterLink
            v-for="i in g.items" :key="i.name"
            :to="{ name: i.name }"
            :class="{ active: route.name === i.name }"
          >
            <span class="dot" :style="{ background: i.color }"></span>
            {{ i.label }}
          </RouterLink>
        </template>
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="flex center gap">
          <button class="hamburger" @click="navOpen = !navOpen" aria-label="menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M4 7h16M4 12h16M4 17h16"/>
            </svg>
          </button>
          <div style="font-size:11px;letter-spacing:.14em;color:var(--ink-3);text-transform:uppercase;font-weight:700">
            {{ (route.meta.title as string) || '' }}
          </div>
        </div>
        <div class="flex center gap">
          <RouterLink :to="{ name: 'profile' }" class="who" style="cursor:pointer">
            <div class="name">{{ auth.user?.fullName }}</div>
            <div class="role">{{ roleLabel[auth.user?.role || ''] || auth.user?.role }}</div>
          </RouterLink>
          <button class="btn ghost" @click="doLogout">خروج</button>
        </div>
      </header>

      <main class="content">
        <RouterView v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </RouterView>
      </main>
    </div>

    <transition name="fade-slide">
      <div v-if="toastState.show" class="toast" :class="toastState.kind">{{ toastState.msg }}</div>
    </transition>
  </div>
</template>

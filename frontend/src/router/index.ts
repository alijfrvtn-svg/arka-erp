import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { useAuth } from '../stores/auth';

const routes: RouteRecordRaw[] = [
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  {
    path: '/',
    component: () => import('../components/AppLayout.vue'),
    meta: { requiresAuth: true },
    children: [
      { path: '', redirect: '/workspace' },
      { path: 'workspace', name: 'workspace', component: () => import('../views/WorkspaceView.vue'), meta: { title: 'میز کار من' } },
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue'), meta: { perm: 'report.ceo', title: 'داشبورد مدیریت' } },
      { path: 'accounts', name: 'accounts', component: () => import('../views/AccountsView.vue'), meta: { perm: 'ledger.view', title: 'سرفصل حساب‌ها' } },
      { path: 'ledger', name: 'ledger', component: () => import('../views/LedgerView.vue'), meta: { perm: 'ledger.view', title: 'دفتر روزنامه' } },
      { path: 'journal', name: 'journal-entries', component: () => import('../views/JournalEntriesView.vue'), meta: { perm: 'ledger.view', title: 'اسناد حسابداری' } },
      { path: 'journal/new', name: 'journal-new', component: () => import('../views/JournalNewView.vue'), meta: { perm: 'ledger.create', title: 'سند جدید' } },
      { path: 'journal/:id/edit', name: 'journal-edit', component: () => import('../views/JournalNewView.vue'), meta: { perm: 'ledger.create', title: 'ویرایش سند' } },
      { path: 'reports/trial-balance', name: 'trial-balance', component: () => import('../views/TrialBalanceView.vue'), meta: { perm: 'report.financial', title: 'تراز آزمایشی' } },
      { path: 'reports/profit-loss', name: 'profit-loss', component: () => import('../views/ProfitLossView.vue'), meta: { perm: 'report.financial', title: 'صورت سود و زیان' } },
      { path: 'reports/balance-sheet', name: 'balance-sheet', component: () => import('../views/BalanceSheetView.vue'), meta: { perm: 'report.financial', title: 'ترازنامه' } },
      { path: 'projects', name: 'projects', component: () => import('../views/ProjectsView.vue'), meta: { perm: 'project.view', title: 'پروژه‌ها' } },
      { path: 'customers', name: 'customers', component: () => import('../views/CustomersView.vue'), meta: { perm: 'customer.view', title: 'مشتریان' } },
      { path: 'personnel', name: 'personnel', component: () => import('../views/PersonnelView.vue'), meta: { perm: 'hr.view', title: 'پرسنل' } },
      { path: 'tasks', name: 'task-mgmt', component: () => import('../views/TaskManagementView.vue'), meta: { perm: 'task.manage', title: 'مدیریت وظایف' } },
      { path: 'payroll', name: 'payroll', component: () => import('../views/PayrollView.vue'), meta: { perm: 'payroll.run', title: 'حقوق و دستمزد' } },
      { path: 'trash', name: 'trash', component: () => import('../views/DeletedRecordsView.vue'), meta: { title: 'رکوردهای حذف‌شده' } },
      { path: 'users', name: 'users', component: () => import('../views/UsersView.vue'), meta: { perm: 'user.manage', title: 'مدیریت کاربران' } },
      { path: 'profile', name: 'profile', component: () => import('../views/ProfileView.vue'), meta: { title: 'پروفایل من' } },
      { path: 'system', name: 'system', component: () => import('../views/SystemView.vue'), meta: { perm: 'system.admin', title: 'سلامت سیستم' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({ history: createWebHistory(), routes });

// First route the user is allowed to open (used as a smart landing page).
const LANDING_ORDER = ['workspace', 'dashboard', 'ledger', 'projects', 'profile'];

router.beforeEach(async (to) => {
  const auth = useAuth();
  if (!auth.booted) await auth.restore();

  if (to.meta.public) {
    return auth.isAuthed ? { name: 'dashboard' } : true;
  }
  if (!auth.isAuthed) {
    return { name: 'login', query: { redirect: to.fullPath } };
  }
  const perm = to.meta.perm as string | undefined;
  if (perm && !auth.can(perm)) {
    // Send the user to their first accessible page instead of a dead end.
    for (const name of LANDING_ORDER) {
      const r = router.getRoutes().find((x) => x.name === name);
      const p = r?.meta?.perm as string | undefined;
      if (!p || auth.can(p)) return { name };
    }
    return { name: 'security' };
  }
  return true;
});

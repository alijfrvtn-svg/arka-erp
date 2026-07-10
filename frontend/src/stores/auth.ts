import { defineStore } from 'pinia';
import { http, setAccessToken, setStepUpToken, apiError } from '../api/client';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  permissions: string[];
  mfaEnabled: boolean;
}

export const useAuth = defineStore('auth', {
  state: () => ({
    user: null as SessionUser | null,
    booted: false,
    loading: false,
  }),
  getters: {
    isAuthed: (s) => !!s.user,
    can: (s) => (perm: string) => !!s.user?.permissions?.includes(perm),
  },
  actions: {
    /** Returns { mfaRequired } — when true, prompt for TOTP and call again. */
    async login(email: string, password: string, totp?: string): Promise<{ mfaRequired: boolean }> {
      this.loading = true;
      try {
        const { data } = await http.post('/auth/login', { email, password, totp: totp || undefined });
        if (data.mfaRequired) return { mfaRequired: true };
        setAccessToken(data.accessToken);
        await this.fetchMe();
        return { mfaRequired: false };
      } catch (e) {
        throw new Error(apiError(e));
      } finally {
        this.loading = false;
      }
    },

    async fetchMe() {
      const { data } = await http.get('/auth/me');
      this.user = data;
    },

    async restore() {
      try {
        const { data } = await http.post('/auth/refresh', {});
        setAccessToken(data.accessToken);
        await this.fetchMe();
      } catch {
        this.user = null;
      } finally {
        this.booted = true;
      }
    },

    async logout() {
      try { await http.post('/auth/logout', {}); } catch { /* ignore */ }
      setAccessToken(null);
      setStepUpToken(null);
      this.user = null;
    },

    async stepUp(token: string) {
      const { data } = await http.post('/auth/step-up', { token });
      setStepUpToken(data.stepUpToken);
      return data;
    },

    async updateProfile(payload: { fullName?: string; email?: string }) {
      await http.patch('/auth/profile', payload);
      await this.fetchMe();
    },

    async changePassword(currentPassword: string, newPassword: string) {
      await http.post('/auth/change-password', { currentPassword, newPassword });
    },

    async disableMfa(token: string) {
      await http.post('/auth/mfa/disable', { token });
      await this.fetchMe();
    },
  },
});

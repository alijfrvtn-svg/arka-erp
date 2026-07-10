import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { router } from './router';
import { registerUnauthorizedHandler } from './api/client';
import { useAuth } from './stores/auth';
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
import './styles/main.css';
import App from './App.vue';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);
app.use(router);

// On hard 401 (refresh failed), drop the session and bounce to login.
registerUnauthorizedHandler(() => {
  const auth = useAuth();
  auth.user = null;
  if (router.currentRoute.value.name !== 'login') {
    router.push({ name: 'login' });
  }
});

app.mount('#app');

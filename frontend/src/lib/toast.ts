import { reactive } from 'vue';

export const toastState = reactive<{ msg: string; kind: 'ok' | 'err' | 'info'; show: boolean }>({
  msg: '',
  kind: 'info',
  show: false,
});

let timer: ReturnType<typeof setTimeout> | null = null;

export function toast(msg: string, kind: 'ok' | 'err' | 'info' = 'info') {
  toastState.msg = msg;
  toastState.kind = kind;
  toastState.show = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => (toastState.show = false), 3800);
}

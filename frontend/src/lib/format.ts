// Amounts arrive as integer strings in Rial (smallest unit). Format for humans.

/** Group a (possibly negative) big-integer string with thousands separators. */
export function groupInt(value: string | number | bigint): string {
  let s = String(value ?? '0');
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  s = s.replace(/^0+(?=\d)/, '');
  const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, '٬');
  return (neg ? '−' : '') + grouped;
}

/** Rial → display. Optionally show in Toman (÷10) with unit label. */
export function money(value: string | number | bigint, opts: { unit?: boolean; toman?: boolean } = {}): string {
  let v = BigInt(value ?? 0);
  let unit = 'ریال';
  if (opts.toman) {
    v = v / 10n;
    unit = 'تومان';
  }
  const txt = groupInt(v.toString());
  return opts.unit === false ? txt : `${txt} ${unit}`;
}

/** Compact form for KPIs: ۱٫۲ میلیارد تومان */
export function moneyCompact(value: string | number | bigint, toman = true): string {
  let v = BigInt(value ?? 0);
  if (toman) v = v / 10n;
  const neg = v < 0n;
  let n = Number(neg ? -v : v);
  const unit = toman ? 'تومان' : 'ریال';
  let out: string;
  if (n >= 1e9) out = (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + ' میلیارد';
  else if (n >= 1e6) out = (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + ' میلیون';
  else if (n >= 1e3) out = (n / 1e3).toFixed(1).replace(/\.?0+$/, '') + ' هزار';
  else out = String(n);
  return `${neg ? '−' : ''}${out} ${unit}`;
}

export function faDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function faNum(n: number | string): string {
  return String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
}

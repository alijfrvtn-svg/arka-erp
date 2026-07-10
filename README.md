# Arka Ads Studio — ERP & Financial System

سامانهٔ یکپارچهٔ مالی، حسابداری دوطرفه و مدیریت منابع سازمانی برای آژانس خلاق **آرکا ادز استودیو** (عکاسی، UI/UX، موشن‌گرافیک، تولید تبلیغات).

> صادرکنندهٔ رسمی همهٔ اسناد، قراردادها و فاکتورها: **علی جعفری (Ali Jafari)**.

---

## ⚡️ اجرا با یک دستور

پیش‌نیاز: فقط **Docker Desktop**.

```bash
cd arka-erp
docker compose up --build
```

سپس:

| سرویس | آدرس |
|------|------|
| 🖥️ اپلیکیشن (Vue 3 / nginx) | http://localhost:8080 |
| 🔌 API (NestJS) | http://localhost:3000/api/v1 |
| ❤️ Health | http://localhost:3000/api/v1/health |

**ورود پیش‌فرض (مدیرعامل):**
`ali.jafari@arka.studio` / `Arka@2026!`
پس از نخستین ورود، گذرواژه را تغییر دهید و از منوی «امنیت و MFA» احراز هویت دومرحله‌ای را فعال کنید.

توقف: `docker compose down` — و برای پاک‌سازی کامل داده‌ها: `docker compose down -v`.

---

## 🏛️ معماری

```
┌────────────┐   HTTPS   ┌──────────────┐   /api → :3000   ┌──────────────┐
│  Vue 3 SPA │◀────────▶│ nginx (front) │─────────────────▶│  NestJS API  │
│ (Electron- │           └──────────────┘                  │  CQRS · RBAC │
│  ready)    │                                              └──────┬───────┘
└────────────┘                                                     │ pg pool (arka_app)
                                        ┌────────────┐             ▼
                                        │   Redis 7  │◀───────┌──────────────┐
                                        └────────────┘        │ PostgreSQL 16│
                                                               │ schema: arka │
                                                               └──────────────┘
```

- **Backend** — NestJS 11 (الگوی CQRS)، TypeORM/pg، احراز هویت Hybrid JWT + Refresh Cookie، RBAC با ۸ نقش، تفکیک وظایف (SoD)، MFA/TOTP برای عملیات حساس، رمزنگاری Envelope (AES-256-GCM) برای PII.
- **Database** — PostgreSQL 16، ایزولاسیون schema-per-tenant، دقت مالی مطلق `NUMERIC(78,0)`، حسابداری دوطرفه با اجرای قید در سطح دیتابیس، audit جعل‌ناپذیر با hash-chaining، حذف نرم (soft-delete)، viewهای بازگشتی (`WITH RECURSIVE`).
- **Frontend** — Vue 3 + Vite + Pinia، طراحی Swiss/Bauhaus، RTL فارسی، رندر دفاتر سنگین با `vue-virtual-scroller` (۶۰fps).

---

## 🗄️ لایهٔ پایگاه‌داده (قلب سیستم)

اسکریپت‌های `database/init/` هنگام نخستین بالا آمدن Postgres به‌ترتیب اجرا می‌شوند:

| فایل | محتوا |
|------|-------|
| `01_extensions_and_schema.sql` | افزونه‌ها، schema، نقش کم‌دسترسی `arka_app`، Enumها، تریگرهای پایه |
| `02_audit_hashchain.sql` | جدول audit، تریگر عمومی JSONB، **زنجیرهٔ هش SHA-256** جعل‌ناپذیر، تابع راستی‌آزمایی |
| `03_identity_and_crm.sql` | کاربران، RBAC، تفکیک وظایف (SoD)، Refresh Tokenها، مشتریان، CRM |
| `04_accounting_core.sql` | دوره‌های مالی، سرفصل حساب‌ها، پروژه‌ها، اسناد و ردیف‌ها + قیود دوطرفه |
| `05_posting_functions.sql` | تابع Post با **قفل‌گذاری قطعی (deadlock-free)**، Reversal، بستن دوره با Advisory Lock |
| `06_reporting_views.sql` | تراز آزمایشی، درخت حساب، roll-up بازگشتی، سود و زیان، ترازنامه، جریان نقدی، سنی‌سازی مطالبات |
| `07_rbac_seed.sql` | کاتالوگ مجوزها، اعطای نقش‌ها (maker/checker)، قیود SoD |
| `08_seed_data.sql` | سرفصل کامل حساب‌ها، دوره‌های ۱۴۰۵، مشتریان/پروژه‌ها و اسناد نمونهٔ Post شده |

### قیود تضمین‌شده در سطح دیتابیس
- **توازن دوطرفه:** جمع بدهکار هر سند Post شده = جمع بستانکار (تریگر Constraint با Defer).
- هر ردیف یا بدهکار است یا بستانکار، هرگز هر دو، هرگز منفی.
- فقط حساب‌های قابل‌ثبت (برگ) در اسناد قابل استفاده‌اند.
- Post فقط در دورهٔ مالی **باز** مجاز است.
- **بدون حذف سخت** روی audit؛ زنجیرهٔ هش با هر دستکاری می‌شکند.
- تخطی از SoD در زمان اعطای مجوز رد می‌شود.

---

## 🔐 امنیت (Zero-Trust)

- **گذرواژه:** Argon2id (`@node-rs/argon2`) با پارامترهای OWASP.
- **توکن‌ها:** Access کوتاه‌عمر (۱۵ دقیقه) + Refresh در کوکی `HttpOnly/Secure` با **چرخش و تشخیص reuse** (نشت توکن → کل خانوادهٔ نشست باطل می‌شود).
- **MFA/Step-up:** TOTP فقط برای عملیات حساس (انتقال وجه، برگشت سند) — از طریق هدر `X-StepUp-Token`.
- **RBAC + SoD:** ۸ نقش (CEO, Accountant, Sales, Designer, Developer, Photographer, Customer, Guest)؛ مجوزها داخل توکن جای می‌گیرند.
- **رمزنگاری Envelope:** IBAN، شناسه ملی و مخفی MFA با AES-256-GCM رمز می‌شوند؛ فقط ۴ رقم آخر برای نمایش ذخیره می‌شود.
- **Audit با actor:** هر نوشتن، کاربر/نقش/IP را از طریق `SET LOCAL` در تریگر ثبت می‌کند (انتشار کانتکست با AsyncLocalStorage).

---

## 🌐 نگاشت مهم API (نسخهٔ v1)

| متد | مسیر | مجوز | توضیح |
|-----|------|------|-------|
| POST | `/auth/login` | عمومی | ورود، صدور توکن + کوکی |
| POST | `/auth/refresh` | عمومی | چرخش refresh |
| POST | `/auth/step-up` | کاربر | تأیید TOTP → توکن step-up |
| GET | `/accounts` | `ledger.view` | درخت سرفصل حساب‌ها |
| POST | `/journal` | `ledger.create` | ثبت پیش‌نویس سند |
| POST | `/journal/:id/post` | `ledger.post` | قطعی‌سازی سند |
| POST | `/journal/:id/reverse` | `ledger.reverse` + **step-up** | برگشت سند |
| POST | `/journal/transfer` | `fund.transfer` + **step-up** | انتقال وجه |
| GET | `/reports/trial-balance` | `report.financial` | تراز آزمایشی |
| GET | `/reports/profit-and-loss` | `report.financial` | سود و زیان |
| GET | `/reports/balance-sheet` | `report.financial` | ترازنامه |
| GET | `/dashboard/ceo` | `report.ceo` | داشبورد مدیریت |
| GET | `/health` · `/health/ready` · `/health/system` | مختلف | پایش سلامت |

---

## 🧑‍💻 توسعهٔ محلی (بدون Docker برای اپ)

```bash
# پایگاه‌داده و Redis با Docker
docker compose up -d postgres redis

# Backend
cd backend && npm install && npm run start:dev      # http://localhost:3000

# Frontend
cd frontend && npm install && npm run dev            # http://localhost:5173 (proxy → :3000)
```

مقادیر پیکربندی از `.env` خوانده می‌شوند؛ از `.env.example` کپی بگیرید.
> نکته: گذرواژهٔ نقش `arka_app` در `01_extensions_and_schema.sql` تعریف شده و باید با `DB_PASSWORD` در `.env` یکسان باشد.

---

## ✅ راستی‌آزمایی انجام‌شده

این استک به‌صورت end-to-end آزمایش و تأیید شده است:

- اجرای کامل DDL روی PostgreSQL ۱۶ بدون خطا؛ تراز آزمایشی و ترازنامه **متوازن**، زنجیرهٔ هش audit **سالم**.
- تست‌های منفی: سند نامتوازن، نقض SoD، ثبت روی حساب کنترلی، و UPDATE روی audit — همگی درست **رد** شدند.
- ورود، RBAC، الزام step-up برای عملیات حساس، و ثبت سند از طریق HTTP با درج صحیح actor در audit.

---

## 📦 نقشهٔ فازها

پیاده‌سازی‌شده و اجراپذیر: امنیت/audit، موتور حسابداری دوطرفه، CRM/پروژه، گزارش‌ها، داشبورد، RBAC/SoD، MFA، سلامت سیستم.
آمادهٔ توسعه (اسکلت و اتصال‌ها موجود): منابع انسانی/حقوق، دارایی/استهلاک با BullMQ، موتور هوش مصنوعی و NLP-to-SQL، Webhookها، و اپ موبایل Flutter.

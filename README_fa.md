<div dir="rtl">

# Aether-GUI

[![License: AGPL v3](https://img.shields.io/github/license/Nishef1/Aether-GUI)](LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)

[English](README.md) · **فارسی**

Aether-GUI یک کنترل‌پنل دسکتاپ سبک روی هسته واقعی [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) است. در صورت فعال‌کردن حالت سراسری، یک لایه TUN مدیریت‌شده با [sing-box](https://github.com/SagerNet/sing-box) روی SOCKS5 محلی Aether قرار می‌گیرد.

نسخه GUI، نسخه Aether core و نسخه sing-box core مستقل از یکدیگر مدیریت می‌شوند.

## مدیریت نسخه هسته‌ها

از مسیر **Advanced → Core management** می‌توان نسخه‌های هسته را مدیریت کرد.

برای Aether و sing-box می‌توان:

- releaseهای موجود GitHub را دید؛
- چند نسخه را هم‌زمان و کنار هم نصب کرد؛
- بین نسخه‌های نصب‌شده جابه‌جا شد؛
- در حالت Disconnect نسخه را upgrade یا downgrade کرد؛
- نسخه‌های managed غیرفعال را حذف کرد؛
- در حالت آفلاین نیز بین نسخه‌هایی که قبلاً نصب شده‌اند جابه‌جا شد.

نصب نسخه جدید فایل نسخه قبلی را overwrite نمی‌کند. انتخاب نسخه فقط pointer کوچک نسخه فعال را تغییر می‌دهد.

یک نسخه bundled نیز به‌عنوان recovery ایمن همراه برنامه قابل نگهداری است. این مسیر برای پشتیبانی از API قدیمی نیست؛ فقط fallback در برابر خراب‌شدن یا ناسازگاری یک release جدید است.

## مدل اتصال

بدون TUN:

```text
برنامه‌ای که SOCKS5 برایش تنظیم شده
        ↓
Aether SOCKS5 فقط روی loopback
        ↓
تونل Aether
        ↓
اینترنت
```

با TUN سراسری:

```text
ترافیک سیستم‌عامل
      ↓
sing-box TUN
      ↓
Aether SOCKS5 روی loopback
      ↓
تونل Aether
      ↓
اینترنت
```

## ایمنی TUN و جلوگیری از leak

پیش از اینکه برنامه وضعیت system-wide protected را اعلام کند:

- نسخه انتخاب‌شده sing-box باید `sing-box check` را برای config فعلی پاس کند؛
- مسیر دقیق executable نسخه‌دار Aether از TUN bypass می‌شود تا routing loop ایجاد نشود؛
- خود sing-box نیز از TUN خودش bypass می‌شود؛
- auto route و تشخیص interface اصلی فعال هستند؛
- strict routing فعال است؛
- TUN به‌صورت dual-stack برای IPv4 و IPv6 ساخته می‌شود؛
- هر خانواده IP که روی سیستم واقعاً egress دارد با خروجی SOCKS خود Aether مقایسه می‌شود؛
- چند failure پیاپی dataplane باعث teardown زنجیره خراب می‌شود و UI در حالت Connected جعلی باقی نمی‌ماند.

IP عمومی فقط در حافظه برای مقایسه health-check استفاده می‌شود و داخل diagnostics دائمی ذخیره نمی‌شود.

SOCKS عمداً فقط روی loopback باز می‌شود.

## Process، Memory و Diagnostics

- Aether و sing-box فقط به‌عنوان child processهای متعلق به خود برنامه مدیریت می‌شوند.
- kill سراسری بر اساس نام process استفاده نمی‌شود.
- خروجی PTY و stdout/stderr به‌صورت پیوسته خوانده می‌شوند تا pipe پر نشود.
- childهای force-kill شده reap می‌شوند.
- retryهای reconnect محدود هستند.
- UI فقط ۵۰۰ خط آخر live log را نگه می‌دارد.
- buffer ناقص PTY سقف ۱۶KB دارد.
- orphan cleanup هم PID و هم هویت executable را بررسی می‌کند.
- diagnostics دائمی JSONL حدود ۵MiB rotate می‌شود.
- credentialهای واضح و مسیر home کاربر قبل از ذخیره redact می‌شوند.

## دسترسی Administrator

حالت proxy-only بدون Administrator/root اجرا می‌شود.

برای TUN، ابتدا coreهای verified با دسترسی عادی آماده می‌شوند؛ سپس UAC درخواست می‌شود و نسخه elevated فقط binaryهای از قبل نصب‌شده را اجرا می‌کند. نصب یا تغییر نسخه core در حالت elevated مجاز نیست.

## معماری

مستندات اصلی:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — معماری Core Registry، مرز engineها، امنیت TUN و مسیر آینده Xray.
- [`docs/UPSTREAM.md`](docs/UPSTREAM.md) — روش استفاده از تغییرات آینده `MatinSenPai/Aether-GUI` بدون خراب‌کردن معماری فورک.
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — راهنمای اجرای پروژه و تست برای Windows.

اصل معماری:

```text
Core Registry = مدیریت binary و version
Aether adapter = lifecycle و اتصال Aether
sing-box adapter = lifecycle مربوط به TUN سراسری
Xray adapter در آینده = lifecycle و config مخصوص Xray
```

برای اضافه‌کردن Xray نباید منطق آن داخل فایل‌های Aether با تعداد زیادی `if/else` پخش شود. Xray باید adapter خودش را داشته باشد و فقط مدیریت نسخه binary آن از Core Registry مشترک استفاده کند.

## اجرای پروژه در Windows

پیش‌نیازها:

- Rust از طریق rustup
- Node.js
- pnpm
- Microsoft C++ Build Tools با گزینه **Desktop development with C++**
- WebView2 Runtime در صورتی که از قبل روی Windows نصب نباشد

نصب dependencyها:

```powershell
pnpm install
```

آماده‌کردن coreهای bundled برای fallback آفلاین:

```powershell
pnpm prepare:cores:windows
```

بررسی کدها:

```powershell
pnpm typecheck
pnpm lint
pnpm check:rust
pnpm test:rust
pnpm clippy:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

اجرای نسخه توسعه:

```powershell
pnpm tauri dev
```

ساخت installer:

```powershell
pnpm tauri build
```

## پروژه‌های upstream

- هسته شبکه: [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether)
- GUI اصلی upstream: [MatinSenPai/Aether-GUI](https://github.com/MatinSenPai/Aether-GUI)
- موتور TUN: [SagerNet/sing-box](https://github.com/SagerNet/sing-box)

تغییرات GUI upstream از طریق Git و پس از review وارد فورک می‌شوند. نسخه‌های Aether و sing-box مستقل از نسخه GUI توسط Core Registry مدیریت می‌شوند.

## مجوز

[GNU Affero General Public License v3.0](LICENSE)

</div>

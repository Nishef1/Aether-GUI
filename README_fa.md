<div dir="rtl">

# Aether-GUI

[![License: AGPL v3](https://img.shields.io/github/license/Nishef1/Aether-GUI)](LICENSE)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)

[English](README.md) · **فارسی**

Aether-GUI یک کنترل‌پنل دسکتاپ سبک روی هسته واقعی [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) است. برای مسیریابی سراسری، به‌صورت پیش‌فرض از TUN بومی [Xray-core](https://github.com/XTLS/Xray-core) استفاده می‌کند و [sing-box](https://github.com/SagerNet/sing-box) را به‌عنوان fallback سازگاری نگه می‌دارد. هر دو موتور، ترافیک سیستم را به SOCKS5 محلی و محافظت‌شده Aether تحویل می‌دهند.

نسخه GUI و نسخه‌های Aether، Xray و sing-box مستقل از یکدیگر مدیریت می‌شوند.

## مدیریت نسخه هسته‌ها

از مسیر **Settings → Core management** می‌توان نسخه‌های هر سه هسته را مدیریت کرد:

- مشاهده releaseهای GitHub؛
- نصب چند نسخه در کنار هم؛
- جابه‌جایی بین نسخه‌های نصب‌شده؛
- upgrade یا downgrade فقط در حالت Disconnect؛
- حذف نسخه‌های managed غیرفعال؛
- ادامه استفاده از نسخه‌های نصب‌شده در حالت آفلاین.

نصب نسخه جدید فایل قبلی را overwrite نمی‌کند. انتخاب نسخه فقط pointer کوچک نسخه فعال را تغییر می‌دهد. نسخه bundled نیز recovery مستقل و تست‌شده است، نه مسیر پشتیبانی از APIهای قدیمی.

## مدل اتصال

بدون TUN:

```text
برنامه‌ای که SOCKS5 برایش تنظیم شده
        ↓
Aether SOCKS5 فقط روی loopback
        ↓
MASQUE / WireGuard / gool در Aether
        ↓
اینترنت
```

با TUN سراسری:

```text
ترافیک سیستم‌عامل
       ↓
Xray TUN بومی (پیش‌فرض) یا sing-box TUN (fallback)
       ↓
Aether SOCKS5 روی loopback
       ↓
MASQUE / WireGuard / gool در Aether
       ↓
اینترنت
```

Xray و sing-box فقط لایه system routing هستند. خود پروتکل WireGuard داخل Aether اجرا می‌شود و ارتباطی با قابلیت WireGuard موتور TUN ندارد.

## دلیل پیش‌فرض‌شدن Xray در Windows

در مسیر sing-box 1.13، route و hijack داخلی DNS ساخته می‌شوند، اما DNS interface ویندوز در بعضی سیستم‌ها به TUN منتقل نمی‌شود. وقتی strict routing فعال است، درخواست DNS ویندوز به resolver قبلی می‌رود و مسدود می‌شود؛ نتیجه همان خطای `Resolving timed out` است، در حالی که Aether و SOCKS سالم هستند.

Xray TUN فیلدهای بومی `gateway`، `dns`، `autoSystemRoutingTable` و `autoOutboundsInterface` را به‌صورت یک config اعتبارسنجی‌شده روی Wintun اعمال می‌کند. به همین دلیل Xray گزینه توصیه‌شده است و sing-box فقط fallback باقی می‌ماند.

## ایمنی TUN و جلوگیری از leak

پیش از اعلام وضعیت system-wide protected:

- binary انتخاب‌شده باید config خود را با فرمان رسمی همان موتور validate کند؛
- مسیر دقیق executable نسخه‌دار Aether از TUN bypass می‌شود تا outer tunnel وارد loop نشود؛
- خود موتور TUN نیز از interface خودش bypass می‌شود؛
- auto route و تشخیص interface خروجی فعال هستند؛
- TUN برای IPv4 و IPv6 ساخته می‌شود؛
- DNS در مسیر Xray روی interface ویندوز تنظیم می‌شود؛
- خروجی مستقیم سیستم با خروجی SOCKS Aether مقایسه می‌شود؛
- failureهای پیاپی data plane باعث teardown می‌شوند و UI در Connected جعلی باقی نمی‌ماند.

IP عمومی فقط در حافظه برای health-check استفاده می‌شود و در diagnostics دائمی ذخیره نمی‌شود. SOCKS نیز عمداً فقط روی loopback باز می‌شود.

## Process، Memory و Diagnostics

- Aether و فقط یک موتور TUN انتخاب‌شده child process متعلق به برنامه هستند؛
- Xray و sing-box هم‌زمان اجرا نمی‌شوند؛
- kill سراسری بر اساس نام process وجود ندارد؛
- PTY و stdout/stderr پیوسته drain می‌شوند؛
- childهای force-kill شده reap می‌شوند؛
- retryها و live logها bounded هستند؛
- orphan cleanup هم PID و هم هویت executable را بررسی می‌کند؛
- credentialهای واضح و مسیر home کاربر پیش از ذخیره redact می‌شوند.

## دسترسی Administrator

حالت proxy-only بدون Administrator/root اجرا می‌شود.

برای TUN، ابتدا Aether و موتور انتخاب‌شده با دسترسی عادی resolve و verify می‌شوند؛ سپس UAC درخواست می‌شود و نسخه elevated دقیقاً همان profile یک‌بارمصرف را ادامه می‌دهد. دانلود، نصب یا تغییر نسخه core در حالت elevated ممنوع است.

## نسخه‌های bundled تست‌شده

- Aether v1.4.0
- Xray-core v26.5.9
- sing-box v1.13.14
- Wintun 0.14.1

## معماری

مستندات اصلی:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Core Registry، مرز adapterها، lifecycle تک‌مالک TUN و ایمنی route/DNS؛
- [`docs/UPSTREAM.md`](docs/UPSTREAM.md) — روش ادغام تغییرات آینده GUI upstream؛
- [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) — راهنمای اجرا، تست و build در Windows؛
- [`docs/RELEASING.md`](docs/RELEASING.md) — مدل release و bundled coreها.

اصل معماری:

```text
Core Registry = مدیریت binary و version
Aether adapter = پروتکل‌ها و SOCKS محافظت‌شده
System TUN manager = مالک دقیقاً یک child
Xray adapter = TUN بومی پیش‌فرض
sing-box adapter = fallback سازگاری
```

منطق Xray یا sing-box نباید داخل lifecycle مربوط به Aether پخش شود. انتخاب engine فقط در مرز System TUN انجام می‌شود.

## اجرای پروژه در Windows

پیش‌نیازها:

- Rust از طریق rustup
- Node.js 24 LTS
- pnpm
- Microsoft C++ Build Tools با گزینه **Desktop development with C++**
- WebView2 Runtime

نصب dependencyها:

```powershell
pnpm install
```

آماده‌کردن coreهای bundled:

```powershell
pnpm prepare:cores:windows
```

بررسی کامل کد:

```powershell
pnpm validate
```

اجرای توسعه:

```powershell
pnpm tauri dev
```

ساخت setup ویندوز:

```powershell
pnpm build:windows:setup
```

## پروژه‌های upstream

- هسته شبکه: [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether)
- موتور TUN پیش‌فرض: [XTLS/Xray-core](https://github.com/XTLS/Xray-core)
- موتور TUN fallback: [SagerNet/sing-box](https://github.com/SagerNet/sing-box)
- GUI اصلی upstream: [MatinSenPai/Aether-GUI](https://github.com/MatinSenPai/Aether-GUI)

نسخه‌های Aether، Xray و sing-box مستقل از نسخه GUI توسط Core Registry مدیریت می‌شوند.

## مجوز

[GNU Affero General Public License v3.0](LICENSE)

</div>

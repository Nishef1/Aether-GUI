<div dir="rtl">

# Aether-GUI

[![Release](https://img.shields.io/github/v/release/MatinSenPai/Aether-GUI?sort=semver)](https://github.com/MatinSenPai/Aether-GUI/releases)
[![License: AGPL v3](https://img.shields.io/github/license/MatinSenPai/Aether-GUI)](LICENSE)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)

[English](README.md) · **فارسی**

Aether-GUI یک رابط دسکتاپ برای [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) است؛ هسته‌ای که برای عبور از محدودیت‌های شدید شبکه طراحی شده، مسیر قابل‌استفاده را پیدا می‌کند، تونل رمزنگاری‌شده را برقرار می‌کند و یک پراکسی SOCKS5 محلی در اختیار برنامه‌ها می‌گذارد.

این GUI منطق اصلی تونل Aether را از نو پیاده‌سازی نمی‌کند. فایل واقعی Aether را داخل یک شبه‌ترمینال اجرا و کنترل می‌کند و در صورت فعال‌کردن **System-wide TUN**، یک لایه‌ی مدیریت‌شده‌ی [sing-box](https://github.com/SagerNet/sing-box) روی پراکسی Aether قرار می‌دهد تا ترافیک کل سیستم از تونل عبور کند.

**نسخه‌ی GUI و نسخه‌ی هسته‌ی Aether از هم مستقل هستند.** انتشار یک نسخه‌ی جدید از GUI به این معنی نیست که هسته برای همیشه روی همان نسخه قفل بماند.

## امکانات اصلی

- **اتصال تک‌کلیکی** — با آخرین پروفایل موفق یا تنظیمات پیش‌فرض مناسب.
- **تنظیمات پیشرفته** — پروتکل، حالت اسکن، نسخه IP، ترنسپورت MASQUE، مبهم‌سازی، Quick reconnect و پورت SOCKS محلی.
- **حالت System-wide TUN** — مسیر کلی سیستم به شکل `sing-box -> Aether SOCKS` هدایت می‌شود. دسترسی Administrator/root فقط وقتی درخواست می‌شود که TUN را روشن کرده باشید.
- **بررسی واقعی سلامت TUN** — زنده‌بودن processِ sing-box به‌تنهایی به معنی سالم‌بودن تونل نیست. برنامه در شروع و سپس دوره‌ای مسیر واقعی داده را بررسی می‌کند و در صورت خرابی مداوم، زنجیره‌ی خراب را جمع می‌کند و recovery انجام می‌دهد؛ بنابراین UI نباید در حالی که اینترنت سیستم عملاً قطع است همچنان Connected باقی بماند.
- **آپدیت مستقل هسته Aether** — برنامه جدا از نسخه GUI، آخرین ریلیز stable هسته را بررسی می‌کند. دانلود با `SHA256SUMS.txt` رسمی Aether تأیید می‌شود و نسخه‌ی سالم قبلی/نسخه bundled به‌عنوان fallback باقی می‌ماند.
- **تشخیص قابلیت‌های نسخه فعال هسته** — قبل از اجرا، GUI خروجی `aether --help` همان binary فعال را می‌خواند و flagهایی را که نسخه جدید دیگر معرفی نمی‌کند کورکورانه ارسال نمی‌کند.
- **وابستگی TUN تأییدشده** — فایل release مربوط به sing-box باید digest معتبر SHA-256 داشته باشد. در ویندوز، Wintun یا از archive تأییدشده sing-box گرفته می‌شود یا از منبع رسمی Wintun و سپس هم SHA-256 و هم امضای Authenticode آن بررسی می‌شود.
- **سیستم لاگ دقیق و دائمی** — خروجی Aether، خروجی sing-box، تغییر state، رویدادهای updater، خطاهای health-check، تلاش‌های recovery و panicهای Rust داخل فایل JSONL چرخشی ذخیره می‌شوند.
- **پاک‌سازی امن processهای باقی‌مانده** — قبل از force-kill فقط PID بررسی نمی‌شود؛ هویت process نیز بررسی می‌شود تا PID بازیافت‌شده متعلق به برنامه‌ای دیگر اشتباهاً کشته نشود.
- **SOCKS فقط روی سیستم خود کاربر** — GUI اجازه نمی‌دهد SOCKS بدون احراز هویت Aether روی `0.0.0.0` و LAN باز شود. پروفایل‌های قدیمی ناامن نیز خودکار به `127.0.0.1` برگردانده می‌شوند و فقط پورتشان حفظ می‌شود.

## مدل اتصال

بدون TUN:

```text
Aether core -> SOCKS5 محلی روی 127.0.0.1:1819 -> برنامه‌هایی که SOCKS را تنظیم کرده‌اند
```

با TUN:

```text
ترافیک سیستم -> sing-box TUN -> Aether SOCKS5 -> تونل رمزنگاری‌شده Aether -> اینترنت
```

فلو کلی state:

```text
Idle -> Launching -> Connecting -> Connected
                                  -> Tunneling   (وقتی TUN روشن و مسیر واقعی تأیید شده باشد)
```

`Connected` یعنی پراکسی محلی Aether آماده شده است. `Tunneling` یعنی مسیر کامل system-wide واقعاً با درخواست شبکه بررسی و تأیید شده است.

## آپدیت مستقل هسته Aether

Aether-GUI هنگام اجرا به‌صورت best-effort آخرین ریلیز **stable** هسته را بررسی می‌کند. نسخه مدیریت‌شده داخل app-data ذخیره می‌شود و در اجرا نسبت به fallback bundled اولویت دارد.

قواعد ایمنی updater:

1. هیچ core دانلودشده‌ی تأییدنشده‌ای فعال نمی‌شود.
2. archive هسته با `SHA256SUMS.txt` رسمی همان release مقایسه می‌شود.
3. هر نسخه‌ی تأییدشده با نام immutable و نسخه‌دار مثل `aether-vX.Y.Z.exe` کنار نسخه‌های قبلی نصب می‌شود و فقط یک pointer کوچک به‌صورت atomic برای اتصال‌های بعدی تغییر می‌کند؛ بنابراین آپدیت پس‌زمینه binary مورد استفاده‌ی تونل در حال اجرا را دستکاری نمی‌کند.
4. نسخه‌های قبلی versioned حذف نمی‌شوند و یک core تست‌شده‌ی bundled با خود GUI نیز به‌عنوان مسیر recovery باقی می‌ماند.
5. اگر GitHub یا سرویس آپدیت در دسترس نباشد، نسخه سالم فعلی یا bundled همچنان قابل استفاده است.
6. در اولین اجرای واقعی، اگر هیچ core قابل‌استفاده‌ای وجود نداشته باشد، خود Connect ابتدا دانلود تأییدشده را کامل می‌کند و با updater پس‌زمینه race نمی‌کند.
7. چون هسته مستقل آپدیت می‌شود، GUI قبل از launch قابلیت‌های CLI نسخه فعال را از `--help` همان نسخه تشخیص می‌دهد.

## TUN و دسترسی Administrator

حالت TUN از sing-box با routing خودکار و تشخیص interface استفاده می‌کند. در ویندوز `strict_route` نیز فعال است تا احتمال DNS leak ناشی از رفتار multi-homed DNS ویندوز کاهش پیدا کند. این حالت ممکن است با بعضی adapterهای مجازی یا نرم‌افزارهای شبکه مجازی تداخل داشته باشد؛ در چنین شرایطی diagnostics را بررسی کنید.

حالت عادی proxy-only با دسترسی Administrator اجرا نمی‌شود. وقتی TUN را روشن می‌کنید و Connect را می‌زنید، برنامه همان لحظه elevation می‌خواهد و پس از relaunch نسخه elevated، اتصال pending را خودکار ادامه می‌دهد؛ بنابراین برای TUN همچنان یک فلو تک‌کلیکی دارید.

برای جلوگیری از مشکل PR اولیه، خروجی `stdout` و `stderr` مربوط به sing-box در تمام طول عمر process خوانده می‌شود تا پرشدن pipe باعث freeze مخفی process نشود. همچنین قبل از اجرای sing-box، کانفیگ با `sing-box check` اعتبارسنجی می‌شود.

پس از شروع، مسیر واقعی سیستم به‌صورت دوره‌ای بررسی می‌شود. بعد از سه خطای متوالی dataplane، TUN و Aether به‌صورت هماهنگ teardown می‌شوند و recovery محدود انجام می‌شود.

## Diagnostics و لاگ‌گیری

لاگ‌های دائمی داخل app-data برنامه ذخیره می‌شوند:

```text
logs/aether-gui.jsonl
logs/aether-gui.jsonl.1
```

فایل اصلی تقریباً در ۵ مگابایت rotate می‌شود. هر خط یک JSON مستقل شامل timestamp، component، level و message است.

موارد ثبت‌شده شامل این‌ها هستند:

- نسخه GUI، سیستم‌عامل و معماری
- نسخه و مسیر هسته فعال Aether
- نتیجه و خطاهای core updater
- خروجی Aether
- خروجی sing-box
- تغییرات state اتصال
- health-checkهای TUN و علت failure
- تلاش‌های reconnect/recovery
- panicهای Rust
- خروج برنامه

برای اینکه گزارش باگ خودش تبدیل به نشت اطلاعات حساس نشود، خطوطی که نشانه‌های واضح credential مثل `Authorization`، `Bearer`، `access_token`، `private_key`، password و secret داشته باشند قبل از ذخیره روی دیسک redact می‌شوند.

## نصب نسخه آماده

برای استفاده عادی، نسخه نهایی را از بخش Releases پروژه upstream دریافت کنید. هدف اصلی بسته‌بندی فعلی Windows x64 است.

## ساخت از روی سورس

### ۱. پیش‌نیازها

- [Node.js](https://nodejs.org/) و npm
- [Rust stable با rustup](https://rustup.rs/)
- [پیش‌نیازهای Tauri v2](https://v2.tauri.app/start/prerequisites/)
  - ویندوز: Microsoft C++ Build Tools / Windows SDK و WebView2 Runtime
  - macOS: Xcode Command Line Tools
  - لینوکس: بسته‌های WebKitGTK و وابستگی‌های سیستمی Tauri

بررسی نصب Rust:

```sh
rustc --version
cargo --version
```

### ۲. نصب وابستگی‌های فرانت‌اند

```sh
npm install
```

### ۳. گرفتن fallbackهای تأییدشده قبل از build

داشتن binaryهای fallback داخل build باعث می‌شود برنامه حتی در صورت در دسترس نبودن سرویس آپدیت، یک نسخه سالم اولیه داشته باشد.

ویندوز:

```powershell
npm run fetch:binaries:windows
```

لینوکس/macOS:

```sh
npm run fetch:binaries:unix
```

اسکریپت Aether آخرین stable را به‌صورت پویا پیدا و checksum رسمی را بررسی می‌کند. اسکریپت sing-box نیز آخرین stable را پیدا و digest release asset را تأیید می‌کند.

### ۴. اجرای توسعه

```sh
npm run tauri dev
```

### ۵. ساخت نسخه نهایی

```sh
npm run tauri build
```

خروجی‌ها زیر این مسیر ساخته می‌شوند:

```text
src-tauri/target/release/bundle/
```

## تست و اعتبارسنجی محلی

قبل از ارسال تغییرات این موارد را اجرا کنید:

```sh
npm run typecheck
npm run lint
npm run check:rust
npm run test:rust
npm run clippy:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

برای audit آسیب‌پذیری dependencyهای Rust:

```sh
cargo install cargo-audit
cargo audit --file src-tauri/Cargo.lock
```

برای تست end-to-end حالت TUN در ویندوز:

1. برنامه را عادی و بدون Run as Administrator باز کنید.
2. در Advanced گزینه **System-wide TUN** را روشن کنید.
3. Connect را بزنید و UAC را تأیید کنید.
4. منتظر **Protected system-wide** بمانید؛ این وضعیت فقط پس از موفق‌شدن dataplane probe نمایش داده می‌شود.
5. اتصال را برای مدتی باز نگه دارید تا health-checkهای دوره‌ای اجرا شوند.
6. هم در حالت عادی و هم وسط بالا آمدن TUN، Disconnect را تست کنید تا cancellation و cleanup بررسی شوند.
7. فایل `aether-gui.jsonl` را برای دیدن ترتیب کامل state/process/health بررسی کنید.

## نکات امنیتی

- SOCKS در این GUI عمداً فقط روی loopback باز می‌شود، چون SOCKS خود Aether احراز هویت proxy ندارد.
- دانلود موفق به‌تنهایی معیار اعتماد به binary خارجی نیست؛ مسیرهای fetch قبل از نصب، integrity/signature را بررسی می‌کنند.
- elevation فقط برای TUN درخواست می‌شود؛ اجرای معمولی برنامه elevated نیست.
- CSP مربوط به WebView علاوه بر محدودیت same-origin، object، frame، تغییر base URL و form submission را مسدود می‌کند.
- برنامه فقط processهایی را مدیریت می‌کند که متعلق به خودش هستند و از kill سراسری بر اساس نام process استفاده نمی‌کند.

## معماری

- **Frontend:** React 19، TypeScript، Tailwind CSS v4، Zustand و Motion.
- **Desktop/backend:** Tauri 2 و Rust.
- **Aether:** داخل PTY واقعی با `portable-pty` اجرا می‌شود تا هم CLI فعلی و هم fallback تعاملی قابل مدیریت باشد.
- **TUN:** sing-box به‌عنوان child process مستقل و تحت supervisor اجرا می‌شود؛ خروجی‌هایش دائماً drain می‌شوند و config قبل از launch بررسی می‌شود.
- **Ground truth:** بازشدن SOCKS فقط یک milestone اتصال است؛ برای TUN حتماً باید مسیر کامل داده به‌صورت جداگانه تأیید شود.

## درباره Aether

منطق اصلی MASQUE، WireGuard، gool/WARP-in-WARP، کشف endpoint، obfuscation، data-plane validation و رفتار خود تونل متعلق به [CluvexStudio/Aether](https://github.com/CluvexStudio/Aether) است. Aether-GUI نقش رابط، مدیریت lifecycle، TUN system-wide و diagnostics را دارد.

## مجوز

[GNU Affero General Public License v3.0](LICENSE).

</div>

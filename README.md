# OSINT Radar — Avtomatlashtirilgan ochiq manbalar razvedkasi

Talabalar uchun o'quv loyihasi: birorta "maqsad"ni (username, email, telefon raqami, ism-familiya, domen yoki IP manzil) kiritasiz — tizim **to'liq avtomatik** ravishda ochiq internet bo'ylab (OSINT — Open Source Intelligence) parallel qidiruv o'tkazadi, topilmalarni solishtiradi va AI xulosa tayyorlaydi.

> ⚠️ **Eslatma:** Tizim faqat **PASSIVE OSINT** rejimida ishlaydi — faqat ochiq (public) manbalardan qidiradi. Hech qanday tizimga ruxsatsiz kirish, parol buzish yoki yashirin ma'lumot olish amalga oshirmaydi. Faqat o'quv va tadqiqot maqsadida foydalaning.

## Imkoniyatlar

### Asosiy skaner
- **8 ta avtomatik modul** — maqsad kiritilgach hammasi bir vaqtda ishlaydi:
  - 🔍 Qidiruv tizimlari (umumiy ochiq qidiruv)
  - 👥 Ijtimoiy tarmoqlar (Instagram, Facebook, X/Twitter, LinkedIn, TikTok, VK, Telegram)
  - 🎬 Video va media (YouTube, Vimeo, Dailymotion)
  - 💬 Forum va jamoalar (Reddit, Quora va boshqalar)
  - 📄 Hujjatlar va fayllar (PDF, pastebin, Google Docs, SlideShare)
  - 📰 Yangiliklar va ensiklopediya (Vikipediya, so'nggi 1 yil yangiliklari)
  - 🖥 Texnik izlar (WHOIS, DNS, Shodan, crt.sh — domen/IP uchun)
  - 🔗 Profil havolalari (12 platforma uchun to'g'ridan-to'g'ri tekshirish havolalari — username uchun)
- **Jonli terminal jurnali** — har bir so'rov real vaqtda ko'rinadi, progress bar bilan
- **AI tahlilchi** — topilmalar asosida o'zbek tilida to'liq xulosa + qo'shimcha savol-javob
- **Saqlanganlar** — istalgan topilmani bookmark qilish va boshqarish (Prisma + SQLite)
- **6 xil maqsad turi** — Username, Email, Telefon, Ism-familiya, Domen, IP manzil

### v2.0 — Adaptiv chuqur taramok
- **1-BOSQICH — Global qidiruv:** barcha tarmoqlar/modullar bo'ylab to'liq qamrov
- **2-BOSQICH — Fokus:** qaysi manbalar ko'proq natija berganini tahlil qiladi va eng unumli top-3 manbaga chuqur (deep) so'rovlar bilan qisqartiradi
- **3-BOSQICH — AI solishtirish (korrelyatsiya):** har bir topilma maqsad va bir-biri bilan taqqoslanadi; shubhali (boshqacha) topilmalar panelga tushadi — **"Tekshirdim — mos"** yoki **"O'tkazib yuborish"** ni tanlaysiz
- **4-BOSQICH — Rekursiv pivot:** topilgan ma'lumotdan yangi izlar (email, username, telefon, domen) ajratib olinadi va ular bo'yicha yana qidiriladi — topilganidan yana qidirish, chuqurlik/son limiti bilan
- **"+" tugmasi:** har bir natija kartasida — o'sha topilma bo'yicha kengaytirilgan chuqur qidiruvni qo'lda ishga tushiradi
- **Tez rejim** — bitta bosqichda oddiy skaner (vaqt tejash uchun)

## Texnologiyalar

| Qatlam | Texnologiya |
|--------|-------------|
| Framework | Next.js 16 (App Router), TypeScript |
| UI | Tailwind CSS 4, shadcn/ui, Lucide icons |
| Ma'lumotlar bazasi | Prisma ORM + SQLite |
| Qidiruv va AI | z-ai-web-dev-sdk (`web_search`, `chat.completions`) |
| Streaming | NDJSON (skaner) + SSE (AI) |

## Talablar

- **Node.js 20.9 yoki undan yangisi** ([nodejs.org](https://nodejs.org)) — tekshirish: `node -v`
- npm (Node bilan birga keladi) yoki bun

## O'rnatish va ishga tushirish

```bash
# 1. Reponi yuklab olish
git clone https://github.com/xojaahrorA/OSINT.git
cd OSINT

# 2. Paketlarni o'rnatish (prisma client avtomatik generatsiya bo'ladi)
npm install

# 3. Muhim: .env fayl yaratish
cp .env.example .env        # Windows'da: copy .env.example .env

# 4. Ma'lumotlar bazasini yaratish
npm run db:setup

# 5. Development serverni ishga tushirish
npm run dev
```

Sayt `http://localhost:3000` manzilida ochiladi.

**Bun foydalanuvchilari uchun:** `npm` o'rniga `bun install`, `bun run db:setup`, `bun run dev` deb yozing.

**Production uchun:** `npm run build` keyin `npm run start`.

## Muammolar (Troubleshooting)

| Xato | Sabab va yechim |
|------|-----------------|
| `Environment variable not found: DATABASE_URL` | `.env` fayl yaratilmagan. `cp .env.example .env` bajarilganini tekshiring (3-qadam) |
| `@prisma/client did not initialize yet. Please run "prisma generate"` | `npm run db:generate` yoki qayta `npm install` bajaring |
| `Cannot find module '@prisma/client'` | Paketlar to'liq o'rnatilmagan — `npm install` qayta bajaring |
| `'next' is not recognized` (Windows) | `node_modules/.bin` yo'q — `npm install` bajaring; Node 20.9+ o'rnatilganini tekshiring |
| `Port 3000 is already in use` | Boshqa jarayon band: Windows: `netstat -ano \| findstr :3000`, mac/linux: `lsof -i :3000` — keyin jarayonni o'chirish yoki `npm run dev -- -p 3001` |
| `Warning: Next.js inferred your workspace root` (multiple lockfiles) | Yuqori papkada boshqa `package-lock.json` bor. Xavfsiz — loyiha `turbopack.root` bilan ildizni aniq belgilaydi. Yo'qotish uchun yuqoridagi ortiqcha lockfile'ni o'chiring |
| Skaner 0 natija qaytaryapti | 1) Yuqoridagi **«Diagnostika»** tugmasini bosing (yoki terminalda `npm run doctor`) — har bir dvigatel alohida tekshiriladi va sababi ko'rsatiladi. 2) Server/datacenter IP'larni qidiruv dvigatellari bloklaydi — uy tarmog'ida ishlatib ko'ring |
| AI xulosa chiqmayapti | Z.ai AI xizmati faqat Z.ai muhitida ishlaydi. Lokal mashinada AI o'rniga avtomatik **lokal statistik xulosa** ko'rsatiladi (modullar, topilmalar, faol manbalar) |
| `npm install` sekin yoki xato | Node/npm versiyasini yangilang: `node -v` (20.9+ bo'lsin) |

### Qidiruv dvigatellari haqida

Tizim ko'p qatlamli dvigatel zanjiridan foydalanadi:

1. **Z.ai web_search** (Z.ai muhitida) — tez va aniq
2. **9 ta ochiq dvigatel** (API kalitsiz, istalgan mashinada): DuckDuckGo → DuckDuckGo Lite → Mojeek → Brave → Qwant → Bing → Google Yangiliklar RSS → Bing Yangiliklar RSS → SearXNG

Har bir natija ikki qatlamli filtdan o'tadi:
- **Operator filtri** — `site:` yoki `"aniq ibora"` so'rovlariga dvigatel mos bo'lmagan (soxta) natija qaytarsa, ular olib tashlanadi
- **Maqsad mosligi filtri** — sarlavha/snippet/havolada maqsad so'zlari umuman uchramasa (ba'zi dvigatellar botga butunlay boshqa so'rov natijasini qaytaradi), natija soxta deb filtrlanadi

Agar operatorli so'rov bo'yicha hammasi bo'sh bo'lsa, tizim so'rovni avtomatik soddalashtirib qayta qidiradi (masalan `site:linkedin.com/in "Tukhtayev"` → `Tukhtayev linkedin profile`) va bunday natijalar `*` belgisi bilan ajratiladi.

Majburiy rejim: `.env` faylga `SEARCH_ENGINE=open` yozsangiz, Z.ai umuman ishlatilmaydi (lokal mashina uchun tavsiya etiladi).

### Premium manbalar (OSINT Framework'dagi pullik/bepul xizmatlar)

HTML dvigatellar ba'zan bloklanadi (403/429/captcha) — bu ularning bot-himoyasi. Bunga doimiy yechim: **API kalitli manbalar**. Kalitni `.env` faylga yozasiz — shu zahoti modul sifatida skanerga qo'shiladi; kalit yo'q bo'lsa manba jimgina o'tkaziladi, skaner to'xtamaydi.

| Kalit (`.env`) | Servis | Nima beradi | Bepul limit |
|---|---|---|---|
| `SERPER_API_KEY` | [serper.dev](https://serper.dev) | **Google natijalari** + Knowledge Graph — eng aniq, bloklanmaydi | 2500 so'rov |
| `BRAVE_API_KEY` | [Brave Search API](https://api-dashboard.search.brave.com/register) | Brave rasmiy API — HTML 429 yo'q | oyiga 2 000 |
| `GOOGLE_CSE_KEY` + `GOOGLE_CSE_CX` | [Google Programmable Search](https://programmablesearchengine.google.com) | Google rasmiy CSE | kuniga 100 |
| `TAVILY_API_KEY` | [app.tavily.com](https://app.tavily.com) | AI-optimallashtirilgan qidiruv | oyiga 1 000 |
| `HIBP_API_KEY` | [haveibeenpwned.com](https://haveibeenpwned.com/API/Key) | Email oqishlari — eng aniq breach baza (≈$3.50/oy) | pullik |
| `HUNTER_API_KEY` | [hunter.io](https://hunter.io/api-keys) | Email tasdiqlash + domen bo'yicha xodim email/ism-familiyalari | oyiga 25 |
| `SHODAN_API_KEY` | [account.shodan.io](https://account.shodan.io/register) | Ochiq portlar, servis bannerlari, tarix | bepul hisob |
| `NUMLOOKUP_API_KEY` | [numlookupapi.com](https://app.numlookupapi.com/register) | Telefon holati, operator, liniya turi | kuniga 100 |
| `IPINFO_TOKEN` | [ipinfo.io](https://ipinfo.io/signup) | Aniq IP geo/ASN, VPN/proxy aniqlash | oyiga 50 000 |
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) | Telegram rasmiy API: chat id, turi, bio, obunachilar soni — **mutlaqo bepul** | cheklanmagan |

Kalitli dvigatellarning katta afzalligi: **403/429/captcha umuman bo'lmaydi** — shuning uchun ochiq dvigatellar doim bloklanib turadigan tarmoqlarda aynan ular asosiy kuch bo'ladi. Diagnostika tugmasi qaysi kalitlar faol ekanini ko'rsatadi.

### Telegram qidiruvi (api kaliti shart emas)

Oddiy qidiruv tizimlari t.me ichidagi kontentni deyarli indekslamaydi — shuning uchun Telegram'dan TO'G'RIDAN-TO'G'RI o'qiydigan 4 ta modul bor:

| Modul | Nima qiladi | Qanday ishlaydi |
|---|---|---|
| **Telegram profili** | Profil/kanal/bot mavjudligi, turi (kanal/guruh/bot/shaxs), ism, tavsif, avatar, obunachilar soni | `t.me/<username>` ochiq sahifasi — bepul, kalit yo'q |
| **Telegram posti (ochiq kanal)** | Ochiq kanalning so'nggi 10 posti: sana, ko'rishlar, matn; post ichidagi email/telefon intel paneliga tushadi | `t.me/s/<kanal>` web preview — bepul |
| **Telegram Bot API** | Rasmiy API'dan ANIQ javob: chat id, turi, bio, aynan obunachilar raqami | `TELEGRAM_BOT_TOKEN` kerak — [@BotFather](https://t.me/BotFather)'da /newbot (mutlaqo bepul) |
| **Telegram izlari** (barcha maqsad turlari) | `site:t.me`, telegra.ph, tgstat/telemetr domeni bo'yicha maxsus so'rovlar | Qidiruv dvigatellari zanjiri |

Telefon raqam bo'yicha Telegram'ni passiv tekshirish imkoni yo'q (Telegram shaxsiy raqamlarni yashiradi) — telefon uchun «Telegram izlari» va «Telefon izlari» modullari ishlaydi.

### Telefon va ism qidiruvini yaxshilash

- **«Telefon izlari» moduli** — raqamning barcha formatlari (E.164 `+998901234567`, milliy `90 123 45 67`, uzluksiz) bo'yicha parallel qidiruv: oddiy qidiruv ko'rmaydigan e'lon, ijtimoiy tarmoq va oqish izlarini topadi.
- **Google Knowledge Graph (Serper)** — ism-familiya bo'yicha rasmiy ma'lumotnoma javobini beradi.

### Diagnostika (npm run doctor)

Lokal mashinada qidiruv ishlamasa:

```bash
npm run doctor
```

Skript quyidagilarni tekshiradi va o'zbekcha xulosada ko'rsatadi:

- Node.js versiyasi (18+ bo'lishi shart, 20+ tavsiya)
- Kod versiyasi (repo yangilanganini — `git pull` kerakligini)
- DNS tarjimoni (3 ta doman)
- Har bir 9 ta qidiruv dvigatelini real so'rov bilan alohida

Ilovada ham yuqori panelda **«Diagnostika»** tugmasi bor — shu tekshiruvni brauzerdan bajaradi.

**Muhim:** sandbox/server (datacenter) IP'larda ko'pchilik dvigatellar bloklaydi — bu normal. Uy internetidan (residential IP) foydalansangiz 4-6 ta dvigatel ochiq bo'ladi.

## Loyiha tuzilishi

```
src/
├── app/
│   ├── api/
│   │   ├── scan/        # Avtomatik OSINT skaner (NDJSON streaming)
│   │   ├── relevance/   # AI natijalarni solishtirish (korrelyatsiya)
│   │   ├── analyze/     # AI tahlilchi (SSE streaming)
│   │   └── bookmarks/   # Saqlanganlar CRUD
│   ├── page.tsx         # Asosiy sahifa (4 bosqichli dvigatel)
│   └── layout.tsx
├── components/osint/
│   ├── terminal-log.tsx     # Jonli skaner jurnali
│   ├── result-card.tsx      # Topilma kartasi ("+" chuqur qidiruv bilan)
│   ├── deep-panel.tsx       # Bosqichlar, manbalar statistikasi, pivotlar
│   ├── review-panel.tsx     # Shubhali topilmalar (tekshirish/o'tkazib yuborish)
│   ├── ai-panel.tsx         # AI tahlil paneli
│   └── bookmarks-sheet.tsx  # Saqlanganlar oynasi
└── lib/
    ├── osint.ts         # Modul ta'riflari, so'rov generatorlari, pivot ajratish
    └── db.ts            # Prisma klient
```

## Qanday ishlaydi

1. Foydalanuvchi maqsad turini tanlaydi va qiymat kiritadi
2. `/api/scan` har bir modul uchun qidiruv so'rovlarini generatsiya qiladi (masalan: `site:instagram.com "maqsad"`, `"maqsad" filetype:pdf`)
3. So'rovlar navbat bilan (parallellik = 2, 429 bo'lsa avtomatik retry) `web_search` orqali yuboriladi, natijalar URL bo'yicha tozalanadi
4. Har bir modul natijasi NDJSON streaming orqali jonli uzatiladi
5. Eng unumli manbalar topiladi → ularga chuqur so'rovlar (fokus bosqichi)
6. `/api/relevance` AI natijalarni maqsad va bir-biri bilan solishtiradi — shubhali topilmalar foydalanuvchi tasdig'iga tushadi
7. Topilmalardan yangi izlar (pivot) ajratiladi — rekursiv qidiruv davom etadi (limit: 8 skaner, 3 chuqurlik)
8. `/api/analyze` barcha topilmalarni AI'ga uzatadi — o'zbek tilida xulosa yozadi
9. Foydalanuvchi topilmalarni saqlashi mumkin (Prisma + SQLite)

## Muallif

- GitHub: [xojaahrorA](https://github.com/xojaahrorA)

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
| `OTX_API_KEY` | [otx.alienvault.com](https://otx.alienvault.com) | **Maltego uslubi**: passiv DNS, tarixiy hostlar, URL arxivi, bog'liq infratuzilma | bepul hisob |

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

### Maltego uslubidagi transformlar

Maltego — link-analiz va transformlar orqali bog'liq obyektlarni ochadigan pullik platforma. OSINT Radar aynan shu transformlarni **bepul manbalar bilan** amalga oshiradi: bir topilmadan boshqa bog'liq obyektlar avtomatik ochiladi.

| Transform | Nima qiladi | Manba |
|---|---|---|
| **Ega bo'yicha domenlar** | Shu email/ism bilan ro'yxatga olingan BARCHA domenlar — bir shaxsning butun domen portfelini ochadi (Maltego «Domains by Registrant») | ViewDNS Reverse WHOIS — bepul, kalit yo'q |
| **AlienVault OTX** | Domen/IP'ning passiv DNS tarixi, eski hostlari, URL arxivi — infratuzilma grafigi (Maltego «resolved to») | OTX API — bepul kalit bilan |
| **Qo'shni domenlar** | Bir serverdagi boshqa saytlar — xuddi shu eganing boshqa loyihalari bo'lishi mumkin | HackerTarget reverse IP — bepul |

Bu transformlar **avtomatik zanjir** hosil qiladi: email → ega domenlari → domeni infratuzilmasi → qo'shni domeni — xuddi Maltego grafigidagi kabi bog'lanish zanjiri. Har bir topilma «Topilgan qo'shimcha ma'lumotlar» paneliga tushadi va u yerdan chuqurroq qidirish mumkin.

#### BotFather'dan token olish — 5 daqiqa, mutlaqo bepul

1. Telegram'da [@BotFather](https://t.me/BotFather) ni oching (rasmiy bot, tekshiring: verified belgisi bor).
2. `/newbot` yozib yuboring.
3. Botga ism bering (masalan `OSINT Radar`) — bu faqat ko'rinish uchun.
4. Botga username bering (masalan `mening_osint_radar_bot` — `_bot` bilan tugashi shart).
5. BotFather `1234567890:AAH...` ko'rinishida **token** beradi — nusxalang.
6. Loyiha papkasidagi `.env` faylni ochib shu qatorni yozing (token shu yerda qoladi, GitHub'ga chiqmaydi):
   ```
   TELEGRAM_BOT_TOKEN=1234567890:AAH...
   ```
7. Skanerni qayta ishga tushiring (`npm run dev`) — «Telegram Bot API» moduli endi ANIQ javob beradi: chat id, turi, bio va aynan obunachilar raqami.

Token noto'g'ri yozilsa skaner to'xtamaydi — «Telegram Bot API» moduli o'zi xatoni tushuntirib beradi (eskirgan token / chat topilmadi va h.k.). Diagnostika tugmasida ham token holati ko'rinadi.

### Bog'lanish grafigi (Maltego grafigi)

Skaner topgan har bir narsa **bir-biriga ulangan interaktiv tarmoqda** ko'rinadi — Maltego'ning mashhur grafigiga o'xshab. Natijalar ustidagi «Graf / Ro'yxat» almashtirgichi orqali ochiladi:

- **Maqsad markazda** — atrofida topilgan sahifalar, ularning atrofida ajratib olingan entitetlar (email, telefon, username, domen, IP, ism) — uch qatlamli bog'lanish tarmog'i
- **Jonli force-directed graf** — skaner davom etar ekan yangi tugunlar paydo bo'ladi va tarmoq o'z-o'zidan tabiiy joylashadi (fizik simulatsiya: itarish + prujinalar). Render to'liq imperativ: pozitsiyalar har kadrda to'g'ridan-to'g'ri DOM'ga yoziladi — React qayta renderi yo'q, shuning uchun zoom va pan **silliq 60fps**, tugunlar muvozanatga kelganda to'liq tinchaydi (qaltirash yo'q)
- **Ranglar bilan ajratilgan turlar** — har bir tur o'z rangida (username — ko'k, email — sariq, telefon — binafsha, domen — firuza, IP — to'q sariq, ism — pushti); legenda chiplarini bosib filtrlash mumkin
- **Tugunni bosing** — tafsilot paneli: qaysi modul topgan, necha marta uchragan, «Havolani ochish» (sahifa uchun) yoki «Shu bo'yicha qidirish» (entitet uchun — pivot qidiruv) tugmalari
- **Tanlangan tugun ta'kidlanadi** — qolgan graf xiralashadi, faqat bevosita qo'shnilari yorqin ko'rinadi
- **To'liq boshqaruv** — sudrash (drag), g'ildirak bilan zoom, pan, «Joylashtirish» (avtomatik sig'dirish) va «Qayta joylash» (qayta tartiblash)

### Telefon va ism qidiruvini yaxshilash

- **«Telefon izlari» moduli** — raqamning barcha formatlari (E.164 `+998901234567`, milliy `90 123 45 67`, uzluksiz) bo'yicha parallel qidiruv: oddiy qidiruv ko'rmaydigan e'lon, ijtimoiy tarmoq va oqish izlarini topadi.
- **«Telefon eslatmalari» moduli** — raqam QAYERLARDA qoldirilganini sayt bo'yicha aniq qidiradi: `site:t.me` postlari, Instagram/Facebook/VK/OK profillari, OLX e'lonlari, biznes kataloglar, PDF/XLSX/CSV hujjat va kontakt bazalari, forum izohlari.
- **«Username joylari» moduli** — shu username boshqa QAYERLARDA ishlatilganini platforma bo'yicha topadi: Instagram/TikTok, X/Twitter, GitHub/GitLab, VK/OK/Pinterest/Medium/Steam, bio-havola sahifalari (linktr.ee, bio.link), Reddit/forumlar, npm/PyPI/pastebin oqishlari.
- **Google Knowledge Graph (Serper)** — ism-familiya bo'yicha rasmiy ma'lumotnoma javobini beradi.

### Ko'p maqsadli rejim — chuqur va aniq

Ko'p maqsadli kiritishda (har qator bitta maqsad) har bir maqsad avtomatik to'g'ri turda va TO'LIQ chuqurlikda tekshiriladi:

- **Turi avtomatik aniqlanadi** — `@durov` va `t.me/durov` → username, `998 90 123 45 67` (+ siz ham) → telefon, `https://instagram.com/durov` → username, `https://example.uz` → domen, «Pavel Durov» → ism. Avvalgi xato: `@` belgili username va `+`siz telefon «ism» deb aniqlanib, noto'g'ri modullar ishga tushardi.
- **Kengaytirilgan (extended) so'rovlar** — ko'p maqsadli sessiyada har bir maqsad core + deep so'rovlar bilan to'liq tekshiriladi (targetiga qarab ~40-50 so'rov, avval faqat ~15 qisqa edi).
- **Qiymat tozalanadi** — `@durov` / `t.me/durov` kiritilsa skaner `durov` bilan qidiradi — `@` belgisi qidiruv sifatini pasaytirardi.
- **Barchasi parallel** — har maqsad o'z to'plami bilan parallel ishchilarda bajariladi, natijalar bitta graf va intel panelga yig'iladi.

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

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
| Qidiruv/AI javob bermaydi | `z-ai-web-dev-sdk` Z.ai muhitida ishlaydi; o'z kompyuterda Z.ai kredensiallari sozlangan bo'lishi kerak |
| `npm install` sekin yoki xato | Node/npm versiyasini yangilang: `node -v` (20.9+ bo'lsin) |

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

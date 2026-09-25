# OSINT Radar — Avtomatlashtirilgan ochiq manbalar razvedkasi

Talabalar uchun o'quv loyihasi: birorta "maqsad"ni (username, email, telefon raqami, ism-familiya, domen yoki IP manzil) kiritasiz — tizim **to'liq avtomatik** ravishda ochiq internet bo'ylab (OSINT — Open Source Intelligence) parallel qidiruv o'tkazadi va topilgan ma'lumotlar asosida AI xulosa tayyorlaydi.

> ⚠️ **Eslatma:** Tizim faqat **PASSIVE OSINT** rejimida ishlaydi — faqat ochiq (public) manbalardan qidiradi. Hech qanday tizimga ruxsatsiz kirish, parol buzish yoki yashirin ma'lumot olish amalga oshirilmaydi. Faqat o'quv va tadqiqot maqsadida foydalaning.

## Imkoniyatlar

- **8 ta avtomatik modul** — maqsad kiritilgach hammasi bir vaqtda ishga tushadi:
  - 🔍 Qidiruv tizimlari (umumiy ochiq qidiruv)
  - 👥 Ijtimoiy tarmoqlar (Instagram, Facebook, X/Twitter, LinkedIn, TikTok, VK, Telegram)
  - 🎬 Video va media (YouTube, Vimeo, Dailymotion)
  - 💬 Forum va jamoalar (Reddit, Quora va boshqalar)
  - 📄 Hujjatlar va fayllar (PDF, pastebin, Google Docs, SlideShare)
  - 📰 Yangiliklar va ensiklopediya (Vikipediya, so'nggi 1 yil yangiliklari)
  - 🖥 Texnik izlar (WHOIS, DNS, Shodan, crt.sh — domen/IP uchun)
  - 🔗 Profil havolalari (12 platforma uchun to'g'ridan-to'g'ri tekshirish havolalari — username uchun)
- **Jonli terminal jurnali** — har bir so'rov real vaqtda ko'rinadi, progress bar bilan
- **AI tahlilchi** — topilma natijalari asosida o'zbek tilida to'liq OSINT xulosa (asosiy topilmalar, ochiqlik darajasi, tavsiyalar) + qo'shimcha savol-javob
- **Saqlanganlar** — istalgan topilmani bookmark qilish va boshqarish
- **6 xil maqsad turi** — Username, Email, Telefon, Ism-familiya, Domen, IP manzil
- **Rate-limit himoyasi** — so'rovlar navbat bilan yuboriladi, 429 xatolarida avtomatik qayta uriniladi

## Texnologiyalar

| Qatlam | Texnologiya |
|--------|-------------|
| Framework | Next.js 16 (App Router), TypeScript |
| UI | Tailwind CSS 4, shadcn/ui, Lucide icons |
| Ma'lumotlar bazasi | Prisma ORM + SQLite |
| Qidiruv va AI | z-ai-web-dev-sdk (`web_search`, `chat.completions`) |
| Streaming | NDJSON (skaner) + text stream (AI) |

## Ishga tushirish

```bash
# 1. Paketlarni o'rnatish
bun install

# 2. Ma'lumotlar bazasini yaratish
bun run db:push

# 3. Development serverni ishga tushirish
bun run dev
```

Sayt `http://localhost:3000` manzilida ochiladi.

## Loyiha tuzilishi

```
src/
├── app/
│   ├── api/
│   │   ├── scan/        # Avtomatik OSINT skaner (NDJSON streaming)
│   │   ├── analyze/     # AI tahlilchi (streaming)
│   │   └── bookmarks/   # Saqlanganlar CRUD
│   ├── page.tsx         # Asosiy sahifa
│   └── layout.tsx
├── components/osint/
│   ├── terminal-log.tsx     # Jonli skaner jurnali
│   ├── result-card.tsx      # Topilma kartasi
│   ├── ai-panel.tsx         # AI tahlil paneli
│   └── bookmarks-sheet.tsx  # Saqlanganlar oynasi
└── lib/
    ├── osint.ts         # Modul ta'riflari va tiplar
    └── db.ts            # Prisma klient
```

## Qanday ishlaydi

1. Foydalanuvchi maqsad turini tanlaydi va qiymat kiritadi
2. `/api/scan` har bir modul uchun qidiruv so'rovlarini generatsiya qiladi (masalan: `site:instagram.com "maqsad"`, `"maqsad" filetype:pdf`)
3. So'rovlar navbat bilan (parallellik = 2) `web_search` orqali yuboriladi, natijalar URL bo'yicha takrorlardan tozalanadi
4. Har bir modul natijasi NDJSON streaming orqali jonli uzatiladi
5. `/api/analyze` barcha topilmalarni AI'ga uzatadi — AI o'zbek tilida xulosa yozadi
6. Foydalanuvchi topilmalarni saqlashi mumkin (Prisma + SQLite)

## Muallif

- GitHub: [xojaahrorA](https://github.com/xojaahrorA)

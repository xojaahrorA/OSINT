"use client";

import { useState } from "react";
import {
  CircleHelp,
  Fingerprint,
  Phone,
  Users,
  Layers,
  PenLine,
  Zap,
  BadgeCheck,
  Sparkles,
  ListChecks,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface GuideItem {
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
}

const GUIDE: GuideItem[] = [
  {
    Icon: Fingerprint,
    title: "1. Username — eng aniq iz",
    body: "Ism-familiyadan farqli ravishda username deyarli takrorlanmaydi. Agar biror foydalanuvchi nomini bilsangiz — doim SHU bilan boshlang (ko'p maqsadli rejimda birinchi qatorga yozing). WhatsMyName moduli uni 700+ saytda aniq HTTP imzolari bilan tekshiradi va mavjud bo'lmagan saytlar natijadan olib tashlanadi.",
  },
  {
    Icon: Layers,
    title: "2. Barcha ma'lumotlarni BIRGA bering",
    body: "«Ko'p maqsadli» rejimda username, telefon va ism-familiyani har qatorga bitta yozib kiriting. Tizim har birini parallel chuqur skanerlaydi va 2+ belgi bitta topilmada uchragan joylarini «Tasdiqlangan» deb belgilaydi — bu shu shaxsga tegishliligining eng kuchli dalili.",
  },
  {
    Icon: BadgeCheck,
    title: "3. «Faqat tasdiqlangan» filtri",
    body: "2+ identifikator bilan skaner qilganda natijalar ustida shu tugma chiqadi. Bosilsa — faqat bir nechta belgisi bir vaqtda mos kelgan topilmalar qoladi, boshqa shaxslarga tegishli «shovqin» yashiriladi.",
  },
  {
    Icon: Phone,
    title: "4. Telefon bo'yicha nimani kutish",
    body: "Ochiq tarmoqda raqam ko'pincha e'lonlar (OLX), biznes kataloglar, WhatsApp havolalari (wa.me), Telegram postlari va hujjatlarda uchraydi — tizim shu joylarni alohida dork so'rovlar bilan qidiradi. Lekin raqam → ism xaritasi ko'p hollarda YOPIQ bazalarda bo'ladi (operatorlar) — ochiq manbalardan bunday ma'lumot har doim chiqavermaydi. Shuning uchun raqam bilan birga ism/username ham bering.",
  },
  {
    Icon: Users,
    title: "5. Ism-familiya yolg'iz yetarli emas",
    body: "Bir xil ismda minglab odam bor — qidiruv tizimi ularni ajrata olmaydi. Ism bo'yicha qidirganda natijalar «ehtimol» darajasida bo'ladi: shahar, kasb, maktab kabi qo'shimcha belgilar 6-banddagi qo'lda qidiruv orqali qo'shilsa, aniqlik keskin oshadi.",
  },
  {
    Icon: PenLine,
    title: "6. Qo'lda qidiruv maydoni",
    body: "Sessiya davomida yana biror narsani bilsangiz (email, ikkinchi username, shahar, ish joyi) — «Qo'shimcha qidiruv» maydoniga yozing: turi avtomatik aniqlanadi va navbatga qo'shiladi. Topilgan izlar «Topilgan qo'shimcha ma'lumotlar» panelida yig'iladi — «Barchasini qidirish» bilan birga tekshirsa bo'ladi.",
  },
  {
    Icon: Zap,
    title: "7. CHUQUR rejim + AI solishtirish",
    body: "«Chuqur taramok» rejimida AI har bir topilmani maqsad bilan solishtiradi: mos / aniq emas / mos emas — degan belgi chiqadi. Shubhali topilmalar alohida panelda — o'zingiz tasdiqlaysiz yoki o'tkazib yuborasiz. Tez rejimda bu bosqich yo'q.",
  },
  {
    Icon: Sparkles,
    title: "8. Realistic bo'ling",
    body: "OSINT faqat OCHIQ manbalar bilan ishlaydi: kimdir bir joyda ma'lumot qoldirgan bo'lsa — topiladi, umuman qoldirmagan bo'lsa — hech bir vosita topolmaydi (parol/ginglik buzish yo'q). Topilma KO'P emas, TO'G'RI bo'lishi muhim: shubhali belgilanganlarni ishonch bilan tashlab qo'ying.",
  },
];

export function SearchGuideDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mx-auto flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors mt-3"
          aria-label="Qidiruv bo'yicha qo'llanma"
        >
          <CircleHelp className="w-4 h-4" />
          Qanday to&apos;g&apos;ri qidirish kerak? — qidiruv qo&apos;llanmasi
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ListChecks className="w-4 h-4 text-primary" />
            Aniq qidiruv bo&apos;yicha qo&apos;llanma
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Nega ba&apos;zan noaniq natijalar chiqadi va qanday qilib aniqroq topish
            mumkin — 8 ta qoida.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 mt-1">
          {GUIDE.map(({ Icon, title, body }) => (
            <div key={title} className="flex gap-3 rounded-lg border bg-secondary/30 p-3">
              <div className="mt-0.5 flex w-8 h-8 rounded-md bg-primary/10 border border-primary/25 items-center justify-center shrink-0">
                <Icon className="w-4 h-4 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{title}</p>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1">{body}</p>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

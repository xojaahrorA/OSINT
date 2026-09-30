// Ism-familiya variantlari — bitta odam turli yozilishlarda qidirilishi uchun
//
// Foydalanuvchi talabi: «odamning ismi familiyasi bir birga o'xshashi mumkin —
// shunda ham o'xshashlarini oladigan qilish kerak». Bir xil odam internetda
// ko'pincha TURU YOZILADI:
//
//   Kamron Karimov  ←→  Karimov Kamron       (tartib almashgan)
//   Kamron Karimov  ←→  Камрон Каримов        (kirillcha)
//   Qahramon        ←→  Kahramon / Ğafur...   (oʻ/gʻ apostrof farqlari)
//   Kamron Karimov  ←→  K. Karimov / Karimov K. (bosh harf qisqartma)
//
// Shu barcha ko'rinishlar generator orqali chiqariladi va qidiruv moduli
// har biriga alohida so'rov yuboradi — hech qanday "o'ylab topilgan" ism
// yo'q, faqat foydalanuvchi kiritgan ismning grammatik variantlari.

/** Kirillcha → lotincha (oʻzbek alifbosi) — kattalar birinchi (multi-char) */
const CYR_TO_LAT: [string, string][] = [
  ["Ў", "Oʻ"], ["ў", "oʻ"],
  ["Ғ", "Gʻ"], ["ғ", "gʻ"],
  ["Ё", "Yo"], ["ё", "yo"],
  ["Ж", "J"], ["ж", "j"],
  ["Щ", "Sh"], ["щ", "sh"],
  ["Ч", "Ch"], ["ч", "ch"],
  ["Ш", "Sh"], ["ш", "sh"],
  ["Ц", "Ts"], ["ц", "ts"],
  ["Я", "Ya"], ["я", "ya"],
  ["Ю", "Yu"], ["ю", "yu"],
  ["Х", "X"], ["х", "x"],
  ["Ъ", "'"], ["ъ", "'"],
  ["Ь", ""], ["ь", ""],
  ["Ў", "Oʻ"], ["Ң", "Ng"], ["ң", "ng"],
  ["Ҳ", "H"], ["ҳ", "h"],
  ["Қ", "Q"], ["қ", "q"],
  ["Э", "E"], ["э", "e"],
  ["А", "A"], ["а", "a"], ["Б", "B"], ["б", "b"], ["В", "V"], ["в", "v"],
  ["Г", "G"], ["г", "g"], ["Д", "D"], ["д", "d"], ["Е", "E"], ["е", "e"],
  ["З", "Z"], ["з", "z"], ["И", "I"], ["и", "i"], ["Й", "Y"], ["й", "y"],
  ["К", "K"], ["к", "k"], ["Л", "L"], ["л", "l"], ["М", "M"], ["м", "m"],
  ["Н", "N"], ["н", "n"], ["О", "O"], ["о", "o"], ["П", "P"], ["п", "p"],
  ["Р", "R"], ["р", "r"], ["С", "S"], ["с", "s"], ["Т", "T"], ["т", "t"],
  ["У", "U"], ["у", "u"], ["Ф", "F"], ["ф", "f"],
];

/** Lotincha → kirillcha — ko'p harflilar birinchi (yo/sh/ch/ts/oʻ/gʻ...) */
const LAT_TO_CYR: [RegExp, string][] = [
  [/o[ʻʼ'`’ʽ]/gi, "ў"],
  [/g[ʻʼ'`’ʽ]/gi, "ғ"],
  [/yo/gi, "ё"],
  [/ya/gi, "я"],
  [/yu/gi, "ю"],
  [/sh/gi, "ш"],
  [/ch/gi, "ч"],
  [/ts/gi, "ц"],
  [/j/gi, "ж"],
  [/x/gi, "х"],
  [/h/gi, "ҳ"],
  [/q/gi, "қ"],
  [/a/gi, "а"], [/b/gi, "б"], [/d/gi, "д"], [/e/gi, "е"], [/f/gi, "ф"],
  [/g/gi, "г"], [/i/gi, "и"], [/k/gi, "к"], [/l/gi, "л"], [/m/gi, "м"],
  [/n/gi, "н"], [/o/gi, "о"], [/p/gi, "п"], [/r/gi, "р"], [/s/gi, "с"],
  [/t/gi, "т"], [/u/gi, "у"], [/v/gi, "в"], [/y/gi, "й"], [/z/gi, "з"],
];

function hasCyrillic(s: string): boolean {
  return /[а-яёўғҳқА-ЯЁЎҒҲҚ]/.test(s);
}

export function cyrToLat(s: string): string {
  let out = "";
  for (const ch of s) {
    const hit = CYR_TO_LAT.find(([c]) => c === ch);
    out += hit ? hit[1] : ch;
  }
  return out;
}

export function latToCyr(s: string): string {
  let out = s;
  for (const [re, rep] of LAT_TO_CYR) {
    // har so'z boshida katta harf saqlanadi — Yo → Ё kabi
    out = out.replace(re, (m) => {
      const isUpper = /^[A-ZА-ЯЁЎҒҲҚ]/.test(m);
      if (isUpper && rep.length > 1) return rep.charAt(0).toUpperCase() + rep.slice(1);
      if (isUpper) return rep.toUpperCase();
      return rep;
    });
  }
  return out;
}

/**
 * Apostrof variantlari: oʻzbek tilida "oʻ"/"gʻ" turlicha yoziladi —
 * oʻ (U+02BB), o' (ASCII), o` (backtick), oʼ. Dvigatellarda hammasi
 * alohida indekslangan, shuning uchun eng ko'p ishlatiladigan 3 formaga
 * almashtiramiz.
 */
const APOSTROPHES = ["ʻ", "'", "`"];

function apostropheVariants(s: string): string[] {
  if (!/[oOgG][ʻʼ'`’ʽ]/.test(s)) return [];
  const out: string[] = [];
  for (const ap of APOSTROPHES) {
    const v = s.replace(/[ʻʼ'`’ʽ]/g, ap);
    if (v !== s) out.push(v);
  }
  return out;
}

/** Sarlavha uslubi: har so'z birinchi harfi katta */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * Ism-familiyaning barcha qiziqarli variantlari.
 * Natijada ASL yozuv ham bor (birinchi element) — qidiruvda "asl" so'rov
 * qoladi, qolganlari QO'SHIMCHA imkoniyatlar.
 * Unikal (kichik harfda solishtirilgan), ko'pi bilan 12 ta.
 */
export function nameVariants(raw: string): string[] {
  const base = raw.trim().replace(/\s+/g, " ");
  if (!base) return [];
  const words = base.split(" ").filter((w) => w.length >= 2);
  if (words.length < 2) return [base];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: string) => {
    const t = v.trim().replace(/\s+/g, " ");
    if (!t || t.length < 3) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };

  const [first, ...rest] = words;
  const last = rest.join(" ");
  const tcFirst = titleCase(first);
  const tcLast = titleCase(last);

  // 1) Asl + tartib almashgan
  push(base);
  push(`${tcLast} ${tcFirst}`);

  // 2) Transliteratsiya (kirill ↔ lotin) va uning almashgan tartibi
  if (hasCyrillic(base)) {
    const lat = titleCase(cyrToLat(base));
    const latRev = titleCase(`${cyrToLat(tcLast)} ${cyrToLat(tcFirst)}`);
    push(lat);
    push(latRev);
  } else {
    const cyr = titleCase(latToCyr(base));
    const cyrRev = titleCase(`${latToCyr(tcLast)} ${latToCyr(tcFirst)}`);
    push(cyr);
    push(cyrRev);
  }

  // 3) Bosh harf qisqartma: "K. Karimov" va "Karimov K."
  const ini = `${tcFirst.charAt(0).toUpperCase()}.`;
  push(`${ini} ${tcLast}`);
  push(`${tcLast} ${ini}`);

  // 4) Apostrof variantlari — asl va almashgan tartib uchun
  for (const v of apostropheVariants(base)) push(v);
  for (const v of apostropheVariants(`${tcLast} ${tcFirst}`)) push(v);

  // Kirillchaga o'tganda apostroflar yo'qoladi — qayta tekshirish shart emas

  return out.slice(0, 12);
}

/**
 * Ism variantlari bo'yicha qidiruv so'rovlari.
 * CORE: eng muhim 4 variant (asl, almashgan, kirillcha, qisqartma) —
 *        har biri profil/ijtimoiy tarmoq atamalari bilan.
 * DEEP: qolgan apostrof variantlari — platforma site: operatorlari bilan.
 */
export function nameVariantCoreQueries(raw: string): string[] {
  const vs = nameVariants(raw);
  const pick = vs.slice(0, 4);
  return pick.map(
    (v) => `"${v}" (profil OR bio OR instagram OR telegram OR linkedin OR facebook)`
  );
}

export function nameVariantDeepQueries(raw: string): string[] {
  const vs = nameVariants(raw);
  const rest = vs.slice(4, 9);
  const out = rest.map(
    (v) => `"${v}" (site:instagram.com OR site:facebook.com OR site:vk.com OR site:t.me)`
  );
  // Bosh harfli qisqartma bilan LinkedIn — ishbilarmonlik profillari
  const ini = vs.find((v) => /^[A-ZА-ЯЁЎҒҲҚ]\.\s/.test(v));
  if (ini) out.push(`"${ini}" site:linkedin.com`);
  return out.slice(0, 5);
}

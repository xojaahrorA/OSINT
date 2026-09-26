import { runDiagnostics } from "@/lib/doctor";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Diagnostika: tarmoq, DNS va har bir ochiq qidiruv dvigatelini real
 * so'rov bilan tekshiradi. Natijalar UI'dagi "Diagnostika" oynasida
 * ko'rsatiladi — lokal mashinada qidiruv ishlamasa bir qarashda sababi
 * ko'rinadi.
 */
export async function GET() {
  try {
    const report = await runDiagnostics();
    return Response.json(report);
  } catch (e) {
    return Response.json(
      { error: String(e).slice(0, 200) },
      { status: 500 }
    );
  }
}

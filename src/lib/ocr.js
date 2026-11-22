/**
 * قراءة النص المكتوب على عبوة المنتج (عربي + إنجليزي) داخل المتصفح — بلا خادم ولا مفتاح.
 * المكتبة وملفات اللغة (~10MB) تُحمَّل عند أول استعمال فقط، فلا تثقل المتجر ولا لوحة التحكم.
 * النتيجة تذهب إلى «وصف» المنتج ليظهر المنتج عند البحث بما كُتب على صورته.
 */
const MIN_CONFIDENCE = 70

export async function readImageText(file) {
  const mod = await import('tesseract.js')
  const worker = await (mod.createWorker ?? mod.default.createWorker)('ara+eng')
  try {
    const { data } = await worker.recognize(file, {}, { blocks: true })
    // نُبقي الكلمات الواثق منها فقط: ضجيج الزخارف يُفسد البحث أكثر مما يفيده
    const words = (data.blocks ?? [])
      .flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)))
      .filter((w) => w.confidence >= MIN_CONFIDENCE)
      .map((w) => w.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
      .filter((t) => t.length >= 2)
    return [...new Set(words)].join(' ').slice(0, 600)
  } finally {
    await worker.terminate()
  }
}

/** بحث غير حسّاس لحالة الأحرف اللاتينية — النص على العبوات غالباً إنجليزي */
export const hasText = (value, q) => (value ?? '').toLowerCase().includes(q.toLowerCase())

import { useEffect, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X, CameraOff } from 'lucide-react'

const REGION_ID = 'barcode-region'

/**
 * ماسح باركود بكاميرا المتصفح. يعمل على HTTPS أو localhost فقط.
 * عند نجاح القراءة يُستدعى onScan ويُغلق الماسح فوراً (توفيراً للبطارية).
 */
export default function BarcodeScanner({ onScan, onClose }) {
  const [error, setError] = useState('')

  useEffect(() => {
    const scanner = new Html5Qrcode(REGION_ID)
    let stopped = false

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 150 } },
        (text) => {
          if (stopped) return
          stopped = true
          onScan(text.trim())
        },
        () => {}, // تجاهل إخفاقات القراءة المتكررة — طبيعية أثناء التصويب
      )
      .catch((e) => {
        setError(
          e?.name === 'NotAllowedError'
            ? 'رُفض إذن الكاميرا. اسمح للموقع باستعمال الكاميرا ثم أعد المحاولة.'
            : 'تعذّر تشغيل الكاميرا. تأكد أن الموقع يعمل عبر HTTPS واستعمل الإدخال اليدوي.',
        )
      })

    return () => {
      stopped = true
      scanner.stop().catch(() => {}).finally(() => scanner.clear().catch(() => {}))
    }
  }, [onScan])

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold">مسح الباركود</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-ink-100" aria-label="إغلاق">
            <X className="size-5" />
          </button>
        </div>

        <div id={REGION_ID} className="overflow-hidden rounded-xl bg-ink-900 min-h-52" />

        {error && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-danger-700">
            <CameraOff className="size-5 shrink-0" />
            {error}
          </p>
        )}
        <p className="mt-3 text-center text-xs text-ink-600">
          صوّب الكاميرا على الباركود — تُقرأ تلقائياً
        </p>
      </div>
    </div>
  )
}

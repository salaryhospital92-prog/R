// ---------------------------------------------------------------------
// قراءة الباركود من صورة على الخادم.
// jpeg-js يفكّ ضغط صورة تيليغرام، وZXing (JS خالص، بلا wasm) يقرأ الرمز.
//
// الدقة ليست 100٪: صورة مهزوزة أو إضاءة ضعيفة أو باركود منحنٍ قد تفشل،
// ولذلك يبقى الإدخال اليدوي متاحاً دائماً كبديل فوري.
// ---------------------------------------------------------------------
import jpeg from 'npm:jpeg-js@0.4.4'
import {
  MultiFormatReader, BarcodeFormat, DecodeHintType,
  RGBLuminanceSource, BinaryBitmap, HybridBinarizer,
} from 'npm:@zxing/library@0.21.3'

const FORMATS = [
  BarcodeFormat.EAN_13, BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A, BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128, BarcodeFormat.CODE_39, BarcodeFormat.CODE_93,
  BarcodeFormat.ITF, BarcodeFormat.CODABAR, BarcodeFormat.QR_CODE,
]

function reader() {
  const r = new MultiFormatReader()
  const hints = new Map()
  hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS)
  hints.set(DecodeHintType.TRY_HARDER, true)
  r.setHints(hints)
  return r
}

/** RGBA → تدرّج رمادي بأوزان الإضاءة المعتادة */
function gray(data: Uint8Array | Uint8ClampedArray, w: number, h: number) {
  const out = new Uint8ClampedArray(w * h)
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (data[p] * 306 + data[p + 1] * 601 + data[p + 2] * 117) >> 10
  }
  return out
}

function rotate90(src: Uint8ClampedArray, w: number, h: number) {
  const out = new Uint8ClampedArray(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[x * h + (h - 1 - y)] = src[y * w + x]
  }
  return out
}

const invert = (src: Uint8ClampedArray) => {
  const out = new Uint8ClampedArray(src.length)
  for (let i = 0; i < src.length; i++) out[i] = 255 - src[i]
  return out
}

function tryDecode(lum: Uint8ClampedArray, w: number, h: number): string | null {
  try {
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, w, h)))
    const res = reader().decode(bitmap)
    const text = res?.getText?.()?.trim()
    return text || null
  } catch {
    return null
  }
}

/**
 * يحاول قراءة الباركود بأربع محاولات: كما هي، مقلوبة الألوان،
 * مُدارة 90°، ومُدارة ومقلوبة — لأن الباركود غالباً يُصوَّر عمودياً.
 */
export function decodeBarcode(bytes: Uint8Array): string | null {
  let raw: { width: number; height: number; data: Uint8Array }
  try {
    raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true })
  } catch {
    return null
  }

  const { width: w, height: h } = raw
  const lum = gray(raw.data, w, h)

  return tryDecode(lum, w, h)
    ?? tryDecode(invert(lum), w, h)
    ?? tryDecode(rotate90(lum, w, h), h, w)
    ?? tryDecode(invert(rotate90(lum, w, h)), h, w)
}

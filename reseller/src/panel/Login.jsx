import { useEffect, useRef, useState } from 'react'
import { Send, Store } from 'lucide-react'
import { errText } from '../lib/config'
import { Notice } from '../ui'
import { login, sb } from './sb'

const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('')

/** الدخول عبر تيليغرام: زر واحد يفتح البوت، ثم يضغط الرقم الظاهر هنا. الرمز يُجهَّز عند فتح الصفحة لتكون الضغطة الأولى مباشرة. */
export default function Login() {
  const [s, setS] = useState({ phase: 'starting' })     // starting | waiting | error
  const [note, setNote] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const begin = async (why) => {
    setNote(why ?? null); setS({ phase: 'starting' })
    const secret = hex(32)
    try {
      const r = await login('start', { secret })
      if (!alive.current) return
      setS({ phase: 'waiting', ...r, secret })
    } catch (e) { setS({ phase: 'error', text: errText(e) }) }
  }
  useEffect(() => { begin() }, [])

  // استعلام كل ثانيتين حتى التأكيد أو الانتهاء
  useEffect(() => {
    if (s.phase !== 'waiting') return
    let stop = false, t
    const tick = async () => {
      try {
        const r = await login('poll', { nonce: s.nonce, secret: s.secret })
        if (stop) return
        if (r.status === 'ok') {
          const { error } = r.session ? await sb.auth.setSession(r.session) : await sb.auth.verifyOtp({ token_hash: r.token_hash, type: 'magiclink' })
          if (error) throw error
          return                                          // onAuthStateChange يُكمل
        }
        if (r.status === 'failed') return begin('الرقم الذي اخترته غير صحيح. حاول مرة أخرى.')
        if (r.status === 'expired') return begin('انتهت المهلة. حاول مرة أخرى.')
      } catch (e) { if (!stop) return setS({ phase: 'error', text: errText(e) }) }
      t = setTimeout(tick, 2000)
    }
    t = setTimeout(tick, 2000)
    return () => { stop = true; clearTimeout(t) }
  }, [s.phase, s.nonce])

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-10">
      <div className="mx-auto mb-6 grid size-16 place-items-center rounded-3xl bg-brand-soft text-brand-deep"><Store className="size-8" aria-hidden="true" /></div>
      <h1 className="text-center text-2xl font-extrabold">افتح متجرك الإلكتروني</h1>
      <p className="mt-2 text-center leading-7 text-stone-600">بيع منتجات جاهزة باسمك وشعارك، ونحن نجهّز الطلب ونوصّله.</p>

      <div className="mt-8 space-y-3">
        {note && <Notice>{note}</Notice>}
        {s.phase === 'error' && <Notice title="تعذّر الاتصال">{s.text}</Notice>}
      </div>

      {s.phase === 'waiting' ? (
        <div className="mt-6 text-center">
          <p className="text-[15px] font-bold text-stone-700">تذكّر هذا الرقم</p>
          <p className="mx-auto mt-2 grid size-24 place-items-center rounded-3xl bg-stone-100 text-5xl font-extrabold tabular-nums" aria-label={`الرقم ${s.number}`}>{s.number}</p>
          <a href={s.bot} target="_blank" rel="noopener noreferrer"
            className="mt-5 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#229ed9] px-5 text-lg font-bold text-white active:scale-[.98]">
            <Send className="size-5" aria-hidden="true" />الدخول عبر تيليغرام
          </a>
          <ol className="mt-5 space-y-1 text-start text-[15px] leading-7 text-stone-700">
            <li>١. افتح تيليغرام واضغط «Start».</li>
            <li>٢. سيظهر ثلاثة أرقام: اضغط الرقم الذي تذكّرته ({s.number}).</li>
          </ol>
          <p className="mt-3 text-sm text-stone-500">بعدها تدخل هذه الصفحة وحدها.</p>
        </div>
      ) : (
        <button type="button" disabled={s.phase === 'starting'} onClick={() => begin()}
          className="mt-6 flex min-h-14 w-full items-center justify-center rounded-2xl bg-brand px-5 text-lg font-bold text-brand-ink disabled:bg-stone-200 disabled:text-stone-500">
          {s.phase === 'starting' ? 'لحظة…' : 'إعادة المحاولة'}
        </button>
      )}
    </div>
  )
}

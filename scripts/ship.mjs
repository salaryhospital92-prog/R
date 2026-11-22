// نشر كامل بأمر واحد: ترحيلات القاعدة ← فحص البناء ← رفع إلى GitHub (فيبدأ النشر تلقائياً).
//   npm run ship
// لا يلتزم (commit) عنك: ما يُرفع هو ما التزمتَ به. يتوقف عند أول فشل.
import { spawnSync } from 'node:child_process'

const run = (label, cmd, args, env = {}) => {
  console.log(`\n▶ ${label}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } })
  if (r.status !== 0) { console.error(`\n✘ توقّف عند: ${label}`); process.exit(r.status ?? 1) }
}

run('ترحيلات قاعدة البيانات', 'node', ['scripts/db.mjs'])
run('فحص البناء', 'npm', ['run', 'build'])
run('الرفع إلى GitHub', 'git', ['push', 'origin', 'main'], { GIT_TERMINAL_PROMPT: '0' })
console.log('\n✔ رُفع. يبدأ النشر على alrifai.shop الآن (دقيقة أو دقيقتان).')

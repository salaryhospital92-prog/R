import { readFileSync } from 'node:fs'
import pg from 'pg'

const [, , file, host, port, user] = process.argv
const sql = readFileSync(file, 'utf8')

const client = new pg.Client({
  host,
  port: Number(port),
  user,
  password: process.env.PGPASS,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
})

client.on('notice', (n) => console.log('NOTICE:', n.message))

try {
  await client.connect()
  console.log('connected:', host)
  await client.query(sql)
  console.log('OK')
} catch (e) {
  console.error('ERROR:', e.message)
  if (e.position) console.error('position:', e.position)
  process.exitCode = 1
} finally {
  await client.end().catch(() => {})
}

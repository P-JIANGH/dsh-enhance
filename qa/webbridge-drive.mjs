// Browser e2e for dsh-enhance via kimi-webbridge (drives the user's real Chrome).
//   node qa/webbridge-drive.mjs [--snapshot] [--navigate <url>] [--action <json>]
// Requires the webbridge daemon on 127.0.0.1:10086 with a connected Chrome extension.
import { request } from 'node:http'

const PORT = 10086
const HOST = '127.0.0.1'
const SESSION = 'dsh-enhance-e2e-browser'

function cmd(action, args = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ action, args, session: SESSION })
    const req = request(
      { host: HOST, port: PORT, path: '/command', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (r) => {
        let d = ''
        r.on('data', (c) => (d += c))
        r.on('end', () => resolve({ status: r.statusCode, body: d }))
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function main() {
  const args = process.argv.slice(2)
  // explicitly named actions routed from CLI for scripted runs
  if (args.includes('--action')) {
    const i = args.indexOf('--action')
    try {
      const spec = JSON.parse(args[i + 1])
      const r = await cmd(spec.action, spec.args || {})
      console.log(JSON.stringify({ action: spec.action, status: r.status, body: safe(r.body) }, null, 2))
    } catch (e) {
      console.error('ERR', e.message)
      process.exit(1)
    }
    return
  }
  if (args.includes('--navigate')) {
    const url = args[args.indexOf('--navigate') + 1]
    const r = await cmd('navigate', { url, newTab: true, group_title: 'dsh-web' })
    console.log(JSON.stringify({ action: 'navigate', status: r.status, body: safe(r.body) }, null, 2))
    return
  }
  if (args.includes('--snapshot')) {
    const r = await cmd('snapshot', {})
    console.log(JSON.stringify({ action: 'snapshot', status: r.status, body: safe(r.body, 20000) }, null, 2))
    return
  }
  // default: status
  const r = await cmd('get_bridge_status', {})
  console.log(JSON.stringify({ action: 'status', status: r.status, body: safe(r.body) }, null, 2))
}

function safe(s, max = 8000) {
  if (typeof s !== 'string') return s
  return s.length > max ? s.slice(0, max) + `\n...[truncated ${s.length - max} chars]` : s
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })

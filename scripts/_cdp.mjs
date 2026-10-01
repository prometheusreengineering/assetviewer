// Dev helper: open a URL in headless Chrome, wait for a JS condition, print a value or save a screenshot.
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
const [url, waitExpr, outExpr, shotPath, w = '1400', h = '900', timeout = '240'] = process.argv.slice(2)
const port = 9300 + Math.floor(Math.random() * 500)
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [
  '--headless=new', `--remote-debugging-port=${port}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  `--window-size=${w},${h}`, `--user-data-dir=${process.env.TEMP}/cdp-${port}`, 'about:blank',
], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.length) break } catch {} await sleep(200) }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.consoleAPICalled' && process.env.LOGS) console.log('[console]', d.params.args.map((a) => a.value ?? a.description).join(' ')); if (d.id && pending.has(d.id)) pending.get(d.id)(d) }
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Runtime.enable'); await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: +w, height: +h, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
const end = Date.now() + +timeout * 1000
while (Date.now() < end) { if (await evalJs(waitExpr)) break; await sleep(500) }
if (outExpr) console.log(await evalJs(outExpr))
if (shotPath) { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(shotPath, Buffer.from(r.result.data, 'base64')) }
ws.close(); chrome.kill()
process.exit(0)

// Does parsing clipboard HTML without a browsing context fetch resources?
// MDN: a DOMParser document "can download resources specified in <iframe> and <img> elements".
import { chromium } from 'playwright';
import http from 'node:http';

const hits = [];
const server = http.createServer((req, res) => { hits.push(req.url); res.end(''); }).listen(0);
await new Promise(resolve => server.on('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const html = tag => `<table data-html-office="{}"><tr><td>
  <img src="${base}/${tag}-img.png"><img srcset="${base}/${tag}-srcset.png 2x">
  <iframe src="${base}/${tag}-iframe"></iframe><link rel="stylesheet" href="${base}/${tag}-css">
  <video poster="${base}/${tag}-poster"></video><object data="${base}/${tag}-object"></object>
  <style>@import "${base}/${tag}-import";td{background:url(${base}/${tag}-bg)}</style>
</td></tr></table>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
// Keep references alive so nothing is collected before a fetch could start.
await page.evaluate(h => { window.k1 = new DOMParser().parseFromString(h, 'text/html'); }, html('domparser'));
await page.evaluate(h => { const d = document.implementation.createHTMLDocument(''); d.body.innerHTML = h; window.k2 = d; }, html('createhtmldoc'));
await page.evaluate(h => { const t = document.createElement('template'); t.innerHTML = h; window.k3 = t; }, html('template'));
await page.waitForTimeout(1500);
console.log(browser.browserType().name(), browser.version(), 'requests:', hits.length ? hits : 'none');
await browser.close();
server.close();

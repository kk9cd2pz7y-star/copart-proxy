const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', (req, res) => { res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization'); res.sendStatus(204); });
app.use(express.json({ limit: '1mb' }));

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/json',
  'Referer': 'https://www.copart.com/lotSearchResults/',
  'Origin': 'https://www.copart.com',
  'DNT': '1',
};

let sessionCookies = '';
let lastCookieRefresh = 0;

async function refreshCookies() {
  const now = Date.now();
  if (sessionCookies && (now - lastCookieRefresh) < 600000) return;
  try {
    console.log('[cookie] Refreshing session...');
    const resp = await axios.get('https://www.copart.com/', {
      headers: { 'User-Agent': BASE_HEADERS['User-Agent'], 'Accept': 'text/html' },
      maxRedirects: 5, timeout: 10000,
    });
    const sc = resp.headers['set-cookie'];
    if (sc) {
      sessionCookies = sc.map(c => c.split(';')[0]).join('; ');
      lastCookieRefresh = now;
      console.log('[cookie] OK:', sessionCookies.substring(0, 60));
    }
  } catch (e) { console.error('[cookie] Failed:', e.message); }
}

function getHeaders() {
  const h = { ...BASE_HEADERS };
  if (sessionCookies) h['Cookie'] = sessionCookies;
  return h;
}

app.get('/', (req, res) => res.json({ status: 'ok', service: 'copart-proxy', version: '2.0.0' }));

app.post('/search', async (req, res) => {
  try {
    await refreshCookies();
    console.log('[search] Query:', JSON.stringify(req.body).substring(0, 150));
    const r = await axios.post('https://www.copart.com/public/lots/search-results', req.body, { headers: getHeaders(), timeout: 15000 });
    const total = r.data?.data?.results?.totalElements || 0;
    console.log('[search] Found:', total);
    res.json(r.data);
  } catch (e) {
    const st = e.response?.status || 500;
    console.error('[search] Error:', st, e.message);
    res.status(st).json({ error: true, status: st, message: e.message });
  }
});

app.get('/lot/:n', async (req, res) => {
  try {
    await refreshCookies();
    const r = await axios.get('https://www.copart.com/public/data/lot/details/' + req.params.n, { headers: getHeaders(), timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 500).json({ error: e.message }); }
});

app.get('/test', async (req, res) => {
  try {
    await refreshCookies();
    const payload = { query: ['*'], filter: { MAKE: ['BMW'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: true };
    const r = await axios.post('https://www.copart.com/public/lots/search-results', payload, { headers: getHeaders(), timeout: 15000 });
    const total = r.data?.data?.results?.totalElements || 0;
    const lots = (r.data?.data?.results?.content || []).slice(0, 3).map(l => ({ lot: l.ln, year: l.lcy, make: l.mkn, model: l.mmod, bid: l.hb, damage: l.dd }));
    res.json({ ok: true, total, lots, hasCookies: !!sessionCookies });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message, status: e.response?.status, body: String(e.response?.data || '').substring(0, 300) });
  }
});

app.listen(PORT, () => { console.log('Copart proxy v2.0.0 on port ' + PORT); refreshCookies(); });

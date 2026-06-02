const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*', methods: ['GET','POST','OPTIONS'], allowedHeaders: ['Content-Type','Authorization'] }));
app.options('*', (req, res) => { res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization'); res.sendStatus(204); });
app.use(express.json({ limit: '1mb' }));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
let cookies = '';
let cookieTs = 0;

async function refreshCookies(force) {
  if (!force && cookies && (Date.now() - cookieTs) < 300000) return;
  try {
    const r = await axios.get('https://www.copart.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      maxRedirects: 5, timeout: 10000,
    });
    const sc = r.headers['set-cookie'];
    if (sc) {
      cookies = sc.map(c => c.split(';')[0]).join('; ');
      cookieTs = Date.now();
      console.log('[cookie] refreshed:', cookies.length, 'chars');
    }
  } catch (e) {
    console.error('[cookie] error:', e.message);
  }
}

function H() {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'Referer': 'https://www.copart.com/lotSearchResults/',
    'Origin': 'https://www.copart.com',
    'DNT': '1',
    ...(cookies ? { Cookie: cookies } : {}),
  };
}

app.get('/', (req, res) => res.json({ status: 'ok', version: '5.0.0', cookies: !!cookies }));

app.post('/search', async (req, res) => {
  await refreshCookies();
  try {
    const r = await axios.post('https://www.copart.com/public/lots/search-results', req.body, {
      headers: H(),
      timeout: 15000,
    });
    const total = r.data?.data?.results?.totalElements || 0;
    console.log('[search]', JSON.stringify(req.body.query), 'total:', total);
    res.json(r.data);
  } catch (e) {
    console.error('[search] error:', e.response?.status, e.message);
    // If 403 or auth error, refresh cookies and retry once
    if (e.response?.status === 403 || e.response?.status === 401) {
      await refreshCookies(true);
      try {
        const r2 = await axios.post('https://www.copart.com/public/lots/search-results', req.body, {
          headers: H(),
          timeout: 15000,
        });
        return res.json(r2.data);
      } catch (e2) {
        return res.status(e2.response?.status || 500).json({ error: e2.message });
      }
    }
    res.status(e.response?.status || 500).json({ error: e.message });
  }
});

app.get('/lot/:n', async (req, res) => {
  await refreshCookies();
  try {
    const r = await axios.get('https://www.copart.com/public/data/lot/details/' + req.params.n, {
      headers: H(), timeout: 10000,
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message });
  }
});

app.get('/test', async (req, res) => {
  await refreshCookies();
  try {
    const p = { query: ['BMW'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: false };
    const r = await axios.post('https://www.copart.com/public/lots/search-results', p, { headers: H(), timeout: 10000 });
    const total = r.data?.data?.results?.totalElements || 0;
    const sample = (r.data?.data?.results?.content || []).slice(0, 2).map(l => `${l.lcy} ${l.mkn} ${l.mmod}`);
    res.json({ ok: true, total, sample, cookies: !!cookies });
  } catch (e) {
    res.json({ ok: false, error: e.message, status: e.response?.status });
  }
});

app.listen(PORT, () => {
  console.log('Copart proxy v5.0.0 on port ' + PORT);
  refreshCookies();
});

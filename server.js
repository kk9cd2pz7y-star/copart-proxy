const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.options('*', (req, res) => res.sendStatus(204));
app.use(express.json({ limit: '1mb' }));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
let cookies = '';
let cookieTs = 0;

async function getCookies() {
  if (cookies && (Date.now() - cookieTs) < 600000) return;
  try {
    const r = await axios.get('https://www.copart.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      maxRedirects: 5, timeout: 8000,
    });
    const sc = r.headers['set-cookie'];
    if (sc) { cookies = sc.map(c => c.split(';')[0]).join('; '); cookieTs = Date.now(); }
  } catch (e) { console.error('[cookie]', e.message); }
}

function H() {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'Referer': 'https://www.copart.com/lotSearchResults/',
    'Origin': 'https://www.copart.com',
    ...(cookies ? { Cookie: cookies } : {}),
  };
}

app.get('/', (req, res) => res.json({ status: 'ok', version: '4.0.0', cookies: !!cookies }));

app.post('/search', async (req, res) => {
  try {
    await getCookies();
    const r = await axios.post('https://www.copart.com/public/lots/search-results', req.body, { headers: H(), timeout: 12000 });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message, status: e.response?.status });
  }
});

// Test 1: original format
app.get('/test1', async (req, res) => {
  try {
    await getCookies();
    const p = { query: ['*'], filter: { MAKE: ['BMW'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: true };
    const r = await axios.post('https://www.copart.com/public/lots/search-results', p, { headers: H(), timeout: 8000 });
    const t = r.data?.data?.results?.totalElements || 0;
    const lots = (r.data?.data?.results?.content || []).slice(0, 2).map(l => ({ lot: l.ln, y: l.lcy, mk: l.mkn, md: l.mmod, bid: l.hb }));
    res.json({ format: 'original_filter', total: t, lots, cookies: !!cookies });
  } catch (e) { res.json({ format: 'original_filter', error: e.message, status: e.response?.status }); }
});

// Test 2: free text search
app.get('/test2', async (req, res) => {
  try {
    await getCookies();
    const p = { query: ['BMW'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: true };
    const r = await axios.post('https://www.copart.com/public/lots/search-results', p, { headers: H(), timeout: 8000 });
    const t = r.data?.data?.results?.totalElements || 0;
    const lots = (r.data?.data?.results?.content || []).slice(0, 2).map(l => ({ lot: l.ln, y: l.lcy, mk: l.mkn, md: l.mmod, bid: l.hb }));
    res.json({ format: 'freeform_text', total: t, lots, cookies: !!cookies });
  } catch (e) { res.json({ format: 'freeform_text', error: e.message, status: e.response?.status }); }
});

// Test 3: raw response dump (first 500 chars)
app.get('/test3', async (req, res) => {
  try {
    await getCookies();
    const p = { query: ['*'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 1, start: 0, watchListOnly: false, freeFormSearch: false, facets: false };
    const r = await axios.post('https://www.copart.com/public/lots/search-results', p, { headers: H(), timeout: 8000 });
    res.json({ raw: JSON.stringify(r.data).substring(0, 800), cookies: !!cookies });
  } catch (e) { res.json({ error: e.message, status: e.response?.status, body: String(e.response?.data || '').substring(0, 500) }); }
});

app.get('/lot/:n', async (req, res) => {
  try {
    await getCookies();
    const r = await axios.get('https://www.copart.com/public/data/lot/details/' + req.params.n, { headers: H(), timeout: 8000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 500).json({ error: e.message }); }
});

app.listen(PORT, () => { console.log('Copart proxy v4.0.0 on port ' + PORT); getCookies(); });

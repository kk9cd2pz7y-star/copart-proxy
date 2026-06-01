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

async function getCookies() {
  if (cookies && (Date.now() - cookieTs) < 600000) return;
  try {
    const r = await axios.get('https://www.copart.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      maxRedirects: 5, timeout: 10000,
    });
    const sc = r.headers['set-cookie'];
    if (sc) { cookies = sc.map(c => c.split(';')[0]).join('; '); cookieTs = Date.now(); }
    console.log('[cookie]', cookies ? 'OK' : 'EMPTY');
  } catch (e) { console.error('[cookie] fail:', e.message); }
}

function hdrs(extra) {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'Referer': 'https://www.copart.com/lotSearchResults/',
    'Origin': 'https://www.copart.com',
    'DNT': '1',
    ...(cookies ? { 'Cookie': cookies } : {}),
    ...extra,
  };
}

app.get('/', (req, res) => res.json({ status: 'ok', service: 'copart-proxy', version: '3.0.0' }));

// Main search - pass-through
app.post('/search', async (req, res) => {
  try {
    await getCookies();
    console.log('[search] payload:', JSON.stringify(req.body).substring(0, 200));
    const r = await axios.post('https://www.copart.com/public/lots/search-results', req.body, { headers: hdrs(), timeout: 15000 });
    console.log('[search] total:', r.data?.data?.results?.totalElements || 0);
    res.json(r.data);
  } catch (e) {
    console.error('[search] err:', e.response?.status, e.message);
    res.status(e.response?.status || 500).json({ error: true, message: e.message });
  }
});

// V2 search - alternative endpoint
app.post('/v2/search', async (req, res) => {
  try {
    await getCookies();
    const r = await axios.post('https://www.copart.com/public/lots/v2/search-results', req.body, { headers: hdrs(), timeout: 15000 });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: true, endpoint: 'v2', message: e.message, status: e.response?.status });
  }
});

// Lot details
app.get('/lot/:n', async (req, res) => {
  try {
    await getCookies();
    const r = await axios.get('https://www.copart.com/public/data/lot/details/' + req.params.n, { headers: hdrs(), timeout: 10000 });
    res.json(r.data);
  } catch (e) { res.status(e.response?.status || 500).json({ error: e.message }); }
});

// MEGA TEST - tries multiple payload formats and endpoints
app.get('/test', async (req, res) => {
  await getCookies();
  const results = {};

  // Format 1: Original
  const p1 = { query: ['*'], filter: { MAKE: ['BMW'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: true };

  // Format 2: With searchCriteria wrapper
  const p2 = { query: ['BMW'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: true };

  // Format 3: keyword search
  const p3 = { query: ['BMW X3'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: true };

  // Format 4: empty query with just MAKE filter
  const p4 = { query: [''], filter: { MAKE: ['BMW'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: true };

  // Format 5: with additional fields that might be required
  const p5 = { query: ['*'], filter: { MAKE: ['BMW'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: true, searchName: '', freeFormSearch: false, hideImages: false, defaultSort: false };

  const endpoints = [
    { name: 'v1_original', url: 'https://www.copart.com/public/lots/search-results', payload: p1 },
    { name: 'v1_freeform_bmw', url: 'https://www.copart.com/public/lots/search-results', payload: p2 },
    { name: 'v1_freeform_bmw_x3', url: 'https://www.copart.com/public/lots/search-results', payload: p3 },
    { name: 'v1_empty_query', url: 'https://www.copart.com/public/lots/search-results', payload: p4 },
    { name: 'v1_extended', url: 'https://www.copart.com/public/lots/search-results', payload: p5 },
  ];

  for (const ep of endpoints) {
    try {
      const r = await axios.post(ep.url, ep.payload, { headers: hdrs(), timeout: 12000 });
      const total = r.data?.data?.results?.totalElements || 0;
      const lots = (r.data?.data?.results?.content || []).slice(0, 2).map(l => `${l.lcy} ${l.mkn} ${l.mmod} bid:${l.hb}`);
      results[ep.name] = { ok: true, total, lots };
    } catch (e) {
      results[ep.name] = { ok: false, status: e.response?.status, error: e.message };
    }
  }

  // Also try mobile endpoint
  try {
    const mobilePayload = { filter: { MAKE: ['BMW'] }, page: 0, size: 3 };
    const r = await axios.post('https://www.copart.com/public/lots/search', JSON.stringify(mobilePayload), {
      headers: { ...hdrs(), 'Content-Type': 'application/json' },
      timeout: 12000,
    });
    results['mobile_search'] = { ok: true, data: JSON.stringify(r.data).substring(0, 300) };
  } catch (e) {
    results['mobile_search'] = { ok: false, status: e.response?.status, error: e.message };
  }

  // Try the graphQL-like endpoint
  try {
    const r = await axios.get('https://www.copart.com/public/data/lotdetails/solr/lotImages/all/67208262', {
      headers: hdrs(), timeout: 10000,
    });
    results['lot_details_test'] = { ok: true, data: JSON.stringify(r.data).substring(0, 300) };
  } catch (e) {
    results['lot_details_test'] = { ok: false, status: e.response?.status, error: e.message };
  }

  res.json({ cookies: cookies ? 'present (' + cookies.length + ' chars)' : 'none', results });
});

app.listen(PORT, () => { console.log('Copart proxy v3.0.0 on port ' + PORT); getCookies(); });      console.log('[cookie] OK:', sessionCookies.substring(0, 60));
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

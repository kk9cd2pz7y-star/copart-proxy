const express = require('express');
const axios = require('axios');
const cors = require('cors');
const tough = require('tough-cookie');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.options('*', (req, res) => res.sendStatus(204));
app.use(express.json({ limit: '1mb' }));

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
let cookieJar = new tough.CookieJar();
let cookieTs = 0;

function jarToHeader(url) {
  return new Promise(r => cookieJar.getCookieString(url, (e, s) => r(e ? '' : s)));
}
function setCookies(url, headers) {
  return new Promise(r => {
    if (!headers) return r();
    let n = headers.length;
    if (!n) return r();
    headers.forEach(c => cookieJar.setCookie(c, url, () => { if (--n === 0) r(); }));
  });
}

async function establishSession(force) {
  if (!force && (Date.now() - cookieTs) < 300000) return;
  try {
    cookieJar = new tough.CookieJar();
    const r1 = await axios.get('https://www.copart.com/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' },
      maxRedirects: 5, timeout: 15000,
    });
    await setCookies('https://www.copart.com/', r1.headers['set-cookie']);
    const c1 = await jarToHeader('https://www.copart.com/');
    const r2 = await axios.get('https://www.copart.com/lotSearchResults/?free=BMW', {
      headers: { 'User-Agent': UA, 'Cookie': c1, 'Referer': 'https://www.copart.com/' },
      maxRedirects: 5, timeout: 15000,
    });
    await setCookies('https://www.copart.com/', r2.headers['set-cookie']);
    cookieTs = Date.now();
    console.log('[session] OK');
  } catch (e) {
    console.error('[session] err:', e.message);
  }
}

async function getCookieHeader() {
  await establishSession();
  return await jarToHeader('https://www.copart.com/');
}

function H(c) {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'Referer': 'https://www.copart.com/lotSearchResults/?free=BMW',
    'Origin': 'https://www.copart.com',
    'X-Requested-With': 'XMLHttpRequest',
    ...(c ? { Cookie: c } : {}),
  };
}

app.get('/', (req, res) => res.json({ status: 'ok', version: '8.0.0' }));

app.post('/search', async (req, res) => {
  try {
    const c = await getCookieHeader();
    const r = await axios.post('https://www.copart.com/public/lots/search-results', req.body, { headers: H(c), timeout: 20000 });
    const total = r.data?.data?.results?.totalElements || 0;
    console.log('[search]', JSON.stringify(req.body.query || req.body.filter), '→', total);
    if (total === 0 && req.body.facets !== false) {
      await establishSession(true);
      const c2 = await jarToHeader('https://www.copart.com/');
      const r2 = await axios.post('https://www.copart.com/public/lots/search-results', req.body, { headers: H(c2), timeout: 20000 });
      return res.json(r2.data);
    }
    res.json(r.data);
  } catch (e) {
    console.error('[search] err:', e.response?.status, e.message);
    res.status(e.response?.status || 500).json({ error: e.message });
  }
});

app.get('/lot/:n', async (req, res) => {
  try {
    const c = await getCookieHeader();
    const r = await axios.get('https://www.copart.com/public/data/lotdetails/solr/' + req.params.n, { headers: H(c), timeout: 10000 });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message });
  }
});

// MEGA TEST — tries 10 different formats
app.get('/test-all', async (req, res) => {
  const c = await getCookieHeader();
  const out = {};

  const formats = [
    { name: 'A_freeform_BMW', payload: { query: ['BMW'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: false } },
    { name: 'B_freeform_BMW_X3', payload: { query: ['BMW X3'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: false } },
    { name: 'C_filter_MAKE', payload: { query: ['*'], filter: { MAKE: ['BMW'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: false } },
    { name: 'D_filter_MAKE_MODL', payload: { query: ['*'], filter: { MAKE: ['BMW'], MODL: ['X3'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: false } },
    { name: 'E_filter_full', payload: { query: ['*'], filter: { MAKE: ['BMW'], MODL: ['X3'], YEAR: ['2020','2021','2022'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: false } },
    { name: 'F_filter_with_query', payload: { query: ['BMW X3'], filter: { MAKE: ['BMW'], MODL: ['X3'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: false } },
    { name: 'G_freeform_FORD_MUSTANG', payload: { query: ['FORD MUSTANG'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: false } },
    { name: 'H_filter_FORD_MUSTANG', payload: { query: ['*'], filter: { MAKE: ['FORD'], MODL: ['MUSTANG'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: false } },
    { name: 'I_filter_FORD_MUSTANG_year_odo', payload: { query: ['*'], filter: { MAKE: ['FORD'], MODL: ['MUSTANG'], YEAR: ['2015','2016','2017','2018','2019'], OD: ['0 TO 80000'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: false } },
    { name: 'J_filter_FORD_MUSTANG_lowercase', payload: { query: ['*'], filter: { make: ['FORD'], modl: ['MUSTANG'] }, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: false } },
  ];

  for (const f of formats) {
    try {
      const r = await axios.post('https://www.copart.com/public/lots/search-results', f.payload, { headers: H(c), timeout: 12000 });
      const total = r.data?.data?.results?.totalElements || 0;
      const sample = (r.data?.data?.results?.content || []).slice(0, 2).map(l => `${l.lcy} ${l.mkn} ${l.mmod}`);
      out[f.name] = { total, sample };
    } catch (e) {
      out[f.name] = { error: e.message, status: e.response?.status };
    }
  }

  res.json(out);
});

app.get('/test', async (req, res) => {
  try {
    const c = await getCookieHeader();
    const payload = { query: ['BMW'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: false };
    const r = await axios.post('https://www.copart.com/public/lots/search-results', payload, { headers: H(c), timeout: 12000 });
    const total = r.data?.data?.results?.totalElements || 0;
    const sample = (r.data?.data?.results?.content || []).slice(0, 3).map(l => `${l.lcy} ${l.mkn} ${l.mmod}`);
    res.json({ ok: true, total, sample });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});


// DIAGNOSTIC: test which structured-filter format Copart accepts (BMW X3 2020-2022, 0-80100 mi)
app.get('/teststructured', async (req, res) => {
  const c = await getCookieHeader();
  const out = {};
  const base = { sort: ['auction_date_utc desc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: false, facets: false, defaultSort: true };
  const variants = {
    bracket_ODM:   { ...base, query: ['*'], filter: { MAKE: ['BMW'], MODL: ['X3'], YEAR: ['[2020 TO 2022]'], ODM: ['[0 TO 80100]'] } },
    plain_ODM:     { ...base, query: ['*'], filter: { MAKE: ['BMW'], MODL: ['X3'], YEAR: ['2020 TO 2022'], ODM: ['0 TO 80100'] } },
    years_ODM:     { ...base, query: ['*'], filter: { MAKE: ['BMW'], MODL: ['X3'], YEAR: ['2020','2021','2022'], ODM: ['0 TO 80100'] } },
    makemodel:     { ...base, query: ['*'], filter: { MAKE: ['BMW'], MODL: ['X3'] } },
    makemodel_eq:  { ...base, query: [],    filter: { MAKE: ['BMW'], MODL: ['X3'] } },
    bracket_emptyq:{ ...base, query: [],    filter: { MAKE: ['BMW'], MODL: ['X3'], YEAR: ['[2020 TO 2022]'], ODM: ['[0 TO 80100]'] } },
    old_OD:        { ...base, query: ['*'], filter: { MAKE: ['BMW'], MODL: ['X3'], YEAR: ['2020 TO 2022'], OD: ['0 TO 80100'] } },
    freeform_ref:  { ...base, query: ['BMW X3'], freeFormSearch: true },
  };
  for (const [name, payload] of Object.entries(variants)) {
    try {
      const r = await axios.post('https://www.copart.com/public/lots/search-results', payload, { headers: H(c), timeout: 12000 });
      const total = r.data?.data?.results?.totalElements || 0;
      const sample = (r.data?.data?.results?.content || []).slice(0, 2).map(l => `${l.lcy} ${l.mkn} ${l.lm || l.mmod || '?'}`);
      out[name] = { total, sample };
    } catch (e) {
      out[name] = { error: e.message, status: e.response?.status };
    }
  }
  res.json(out);
});

app.listen(PORT, () => { console.log('proxy v8.0.0 port ' + PORT); establishSession(); });

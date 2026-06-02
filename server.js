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
  return new Promise((resolve) => {
    cookieJar.getCookieString(url, (err, str) => resolve(err ? '' : str));
  });
}

function setCookiesFromResp(url, setCookieHeaders) {
  return new Promise((resolve) => {
    if (!setCookieHeaders) return resolve();
    let pending = setCookieHeaders.length;
    if (pending === 0) return resolve();
    setCookieHeaders.forEach(c => {
      cookieJar.setCookie(c, url, () => { if (--pending === 0) resolve(); });
    });
  });
}

async function establishSession(force) {
  if (!force && (Date.now() - cookieTs) < 300000) return;
  try {
    console.log('[session] establishing...');
    cookieJar = new tough.CookieJar();

    const r1 = await axios.get('https://www.copart.com/', {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirects: 5, timeout: 15000,
    });
    await setCookiesFromResp('https://www.copart.com/', r1.headers['set-cookie']);

    const cookieStr1 = await jarToHeader('https://www.copart.com/');
    const r2 = await axios.get('https://www.copart.com/lotSearchResults/?free=BMW&searchKeyword=BMW', {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Referer': 'https://www.copart.com/',
        'Cookie': cookieStr1,
      },
      maxRedirects: 5, timeout: 15000,
    });
    await setCookiesFromResp('https://www.copart.com/', r2.headers['set-cookie']);

    cookieTs = Date.now();
    const finalCookies = await jarToHeader('https://www.copart.com/');
    console.log('[session] OK, cookies:', finalCookies.length, 'chars');
  } catch (e) {
    console.error('[session] error:', e.message);
  }
}

async function getCookieHeader() {
  await establishSession();
  return await jarToHeader('https://www.copart.com/');
}

function H(cookieStr) {
  return {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'Referer': 'https://www.copart.com/lotSearchResults/?free=BMW',
    'Origin': 'https://www.copart.com',
    'X-Requested-With': 'XMLHttpRequest',
    ...(cookieStr ? { Cookie: cookieStr } : {}),
  };
}

app.get('/', async (req, res) => {
  const ch = await jarToHeader('https://www.copart.com/');
  res.json({ status: 'ok', version: '6.0.0', cookies: ch.length });
});

app.post('/search', async (req, res) => {
  try {
    const cookieStr = await getCookieHeader();
    const r = await axios.post('https://www.copart.com/public/lots/search-results', req.body, {
      headers: H(cookieStr), timeout: 15000,
    });
    const total = r.data?.data?.results?.totalElements || 0;
    console.log('[search]', JSON.stringify(req.body.query), '→', total);

    if (total === 0) {
      console.log('[search] 0 results, retrying with fresh session');
      await establishSession(true);
      const cs2 = await jarToHeader('https://www.copart.com/');
      const r2 = await axios.post('https://www.copart.com/public/lots/search-results', req.body, {
        headers: H(cs2), timeout: 15000,
      });
      return res.json(r2.data);
    }

    res.json(r.data);
  } catch (e) {
    console.error('[search] error:', e.response?.status, e.message);
    res.status(e.response?.status || 500).json({ error: e.message });
  }
});

app.get('/lot/:n', async (req, res) => {
  try {
    const cs = await getCookieHeader();
    const r = await axios.get('https://www.copart.com/public/data/lot/details/' + req.params.n, {
      headers: H(cs), timeout: 10000,
    });
    res.json(r.data);
  } catch (e) {
    res.status(e.response?.status || 500).json({ error: e.message });
  }
});

app.get('/test', async (req, res) => {
  try {
    const cookieStr = await getCookieHeader();
    const payload = { query: ['BMW'], filter: {}, sort: ['auction_date_utc asc'], page: 0, size: 3, start: 0, watchListOnly: false, freeFormSearch: true, facets: false };
    const r = await axios.post('https://www.copart.com/public/lots/search-results', payload, {
      headers: H(cookieStr), timeout: 12000,
    });
    const total = r.data?.data?.results?.totalElements || 0;
    const sample = (r.data?.data?.results?.content || []).slice(0, 3).map(l => `${l.lcy} ${l.mkn} ${l.mmod}`);
    res.json({ ok: true, total, sample, cookieLength: cookieStr.length });
  } catch (e) {
    res.json({ ok: false, error: e.message, status: e.response?.status });
  }
});

app.listen(PORT, () => {
  console.log('Copart proxy v6.0.0 on port ' + PORT);
  establishSession();
});

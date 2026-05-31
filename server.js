const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Явно разрешаем все источники включая claude.ai
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Обрабатываем preflight OPTIONS вручную
app.options('*', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.sendStatus(204);
});

app.use(express.json({ limit: '1mb' }));

const COPART_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type': 'application/json',
  'Referer': 'https://www.copart.com/lotSearchResults/',
  'Origin': 'https://www.copart.com',
  'copart-country': 'US',
  'copart-env': 'production',
  'DNT': '1',
};

app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'copart-proxy', version: '1.1.0' });
});

app.post('/search', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
      return res.status(400).json({ error: 'Invalid payload' });
    }
    const response = await axios.post(
      'https://www.copart.com/public/lots/search-results',
      payload,
      { headers: COPART_HEADERS, timeout: 15000 }
    );
    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;
    console.error(`Copart error ${status}:`, message);
    res.status(status).json({ error: true, status, message: typeof message === 'string' ? message : JSON.stringify(message) });
  }
});

app.get('/lot/:lotNumber', async (req, res) => {
  try {
    const response = await axios.get(
      `https://www.copart.com/public/data/lot/details/${req.params.lotNumber}`,
      { headers: COPART_HEADERS, timeout: 10000 }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Copart proxy v1.1.0 running on port ${PORT}`));
    }

    const response = await axios.post(
      'https://www.copart.com/public/lots/search-results',
      payload,
      {
        headers: COPART_HEADERS,
        timeout: 15000,
      }
    );

    res.json(response.data);
  } catch (err) {
    const status = err.response?.status || 500;
    const message = err.response?.data || err.message;

    console.error(`Copart error ${status}:`, message);

    res.status(status).json({
      error: true,
      status,
      message: typeof message === 'string' ? message : JSON.stringify(message),
    });
  }
});

// Прокси для получения деталей лота
app.get('/lot/:lotNumber', async (req, res) => {
  try {
    const { lotNumber } = req.params;
    const response = await axios.get(
      `https://www.copart.com/public/data/lot/details/${lotNumber}`,
      { headers: COPART_HEADERS, timeout: 10000 }
    );
    res.json(response.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Copart proxy running on port ${PORT}`);
});

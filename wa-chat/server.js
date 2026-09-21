import express from 'express';
import QRCode from 'qrcode';
import pkg from 'whatsapp-web.js';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Client, LocalAuth } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = path.join(__dirname, 'data');
const RESULTS_FILE = path.join(DATA_DIR, 'chat-summary.json');
const AUTH_DIR = path.join(__dirname, '.wwebjs_auth');
const configuredFetchLimit = Number(process.env.WA_FETCH_LIMIT);
const FETCH_LIMIT = Number.isFinite(configuredFetchLimit) && configuredFetchLimit > 0
  ? configuredFetchLimit
  : Infinity;

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

const BROWSER_PATH = findBrowser();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function emptySummary() {
  return {
    numberCount: 0,
    startDate: null,
    endDate: null,
    scannedDirectChats: 0,
    directChatsWithErrors: 0,
    scannedAt: null,
  };
}

const state = {
  connection: 'starting',
  qr: null,
  lastError: null,
  summary: emptySummary(),
  lastScan: null,
  scan: {
    running: false,
    totalChats: 0,
    directChats: 0,
    processedChats: 0,
    errors: 0,
    startedAt: null,
    finishedAt: null,
  },
};

let client;
let scanPromise = null;
let shuttingDown = false;

function publicState() {
  return {
    connection: state.connection,
    qr: state.qr,
    lastError: state.lastError,
    summary: { ...state.summary },
    lastScan: state.lastScan,
    scan: { ...state.scan },
  };
}

function parseDateRange(startDate, endDate) {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(startDate || '') || !datePattern.test(endDate || '')) {
    throw new Error('Tanggal mulai dan tanggal akhir wajib diisi.');
  }

  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Format tanggal tidak valid.');
  }
  if (end < start) {
    throw new Error('Tanggal akhir tidak boleh lebih awal dari tanggal mulai.');
  }

  return {
    startDate,
    endDate,
    startTimestamp: Math.floor(start.getTime() / 1000),
    endTimestamp: Math.floor(end.getTime() / 1000),
  };
}

function isDirectPhoneChat(chat) {
  const serializedId = chat?.id?._serialized || '';
  const server = chat?.id?.server || '';

  if (chat?.isGroup) return false;
  if (server) return ['c.us', 'lid'].includes(server);
  return serializedId.endsWith('@c.us') || serializedId.endsWith('@lid');
}

function isLoggedInAccountChat(chat) {
  const ownId = client?.info?.wid?._serialized;
  return Boolean(ownId && chat?.id?._serialized === ownId);
}

async function saveSummary() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const payload = {
    generatedAt: new Date().toISOString(),
    lastScan: state.lastScan,
    summary: state.summary,
  };
  await fs.writeFile(RESULTS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

async function loadSummary() {
  try {
    const raw = await fs.readFile(RESULTS_FILE, 'utf8');
    const payload = JSON.parse(raw);
    if (payload.summary && typeof payload.summary === 'object') {
      state.summary = {
        ...emptySummary(),
        numberCount: Number(payload.summary.numberCount) || 0,
        startDate: payload.summary.startDate || null,
        endDate: payload.summary.endDate || null,
        scannedDirectChats: Number(payload.summary.scannedDirectChats) || 0,
        directChatsWithErrors: Number(payload.summary.directChatsWithErrors) || 0,
        scannedAt: payload.summary.scannedAt || null,
      };
      state.lastScan = payload.lastScan || state.summary.scannedAt || null;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Tidak dapat membaca ringkasan lama: ${error.message}`);
    }
  }
}

async function chatHasMessageInRange(chat, dateRange) {
  try {
    // Message objects exist only in memory during this function. Their content
    // is never written to disk or returned by the API.
    const messages = await chat.fetchMessages({ limit: FETCH_LIMIT });
    let matched = false;

    for (const message of messages) {
      const timestamp = Number(message?.timestamp);
      if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
      if (timestamp >= dateRange.startTimestamp && timestamp <= dateRange.endTimestamp) {
        matched = true;
        break;
      }
    }

    return {
      matched,
      error: null,
    };
  } catch (error) {
    return {
      matched: false,
      error: error?.message || 'Gagal membaca riwayat chat',
    };
  }
}

async function scanAllChats(dateRange) {
  if (scanPromise) return scanPromise;

  scanPromise = (async () => {
    state.scan = {
      running: true,
      totalChats: 0,
      directChats: 0,
      processedChats: 0,
      errors: 0,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    state.summary = {
      ...emptySummary(),
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    };
    state.lastScan = null;
    state.lastError = null;

    try {
      const chats = await client.getChats();
      const directChats = chats.filter((chat) => isDirectPhoneChat(chat) && !isLoggedInAccountChat(chat));
      state.scan.totalChats = chats.length;
      state.scan.directChats = directChats.length;

      let numberCount = 0;
      let errors = 0;

      for (const chat of directChats) {
        const result = await chatHasMessageInRange(chat, dateRange);
        state.scan.processedChats += 1;

        if (result.error) errors += 1;
        if (result.matched) numberCount += 1;

        state.scan.errors = errors;
        state.summary = {
          numberCount,
          startDate: dateRange.startDate,
          endDate: dateRange.endDate,
          scannedDirectChats: state.scan.processedChats,
          directChatsWithErrors: errors,
          scannedAt: null,
        };
        await saveSummary();
      }

      state.lastScan = new Date().toISOString();
      state.summary.scannedAt = state.lastScan;
      await saveSummary();
    } catch (error) {
      state.lastError = error?.message || 'Pemindaian gagal';
      throw error;
    } finally {
      state.scan.running = false;
      state.scan.finishedAt = new Date().toISOString();
      scanPromise = null;
    }
  })();

  // The HTTP request returns immediately while the scan continues.
  scanPromise.catch((error) => console.error(`Pemindaian gagal: ${error.message}`));
  return scanPromise;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function summaryAsCsv() {
  const header = [
    'Jumlah nomor unik',
    'Tanggal mulai',
    'Tanggal akhir',
    'Chat pribadi dipindai',
    'Chat gagal dibaca',
    'Dipindai (UTC)',
  ];
  const row = [
    state.summary.numberCount,
    state.summary.startDate,
    state.summary.endDate,
    state.summary.scannedDirectChats,
    state.summary.directChatsWithErrors,
    state.summary.scannedAt,
  ];
  return `${header.map(csvCell).join(',')}\r\n${row.map(csvCell).join(',')}\r\n`;
}

app.get('/api/status', (_request, response) => {
  response.json(publicState());
});

app.get('/api/results', (_request, response) => {
  response.json({ summary: state.summary, lastScan: state.lastScan });
});

app.post('/api/scan', (request, response) => {
  let dateRange;
  try {
    dateRange = parseDateRange(request.body?.startDate, request.body?.endDate);
  } catch (error) {
    response.status(400).json({ error: error.message });
    return;
  }

  if (state.connection !== 'ready') {
    response.status(409).json({ error: 'WhatsApp belum siap. Scan QR dan tunggu status siap.' });
    return;
  }
  if (state.scan.running) {
    response.status(409).json({ error: 'Pemindaian sedang berjalan.' });
    return;
  }

  void scanAllChats(dateRange);
  response.status(202).json({ message: 'Pemindaian dimulai.' });
});

app.get('/api/export', (request, response) => {
  const format = request.query.format === 'json' ? 'json' : 'csv';
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    response
      .type('application/json')
      .set('Content-Disposition', `attachment; filename="wa-summary-${stamp}.json"`)
      .send(JSON.stringify({ generatedAt: new Date().toISOString(), summary: state.summary }, null, 2));
    return;
  }

  response
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="wa-summary-${stamp}.csv"`)
    .send(`\uFEFF${summaryAsCsv()}`);
});

app.get('*', (_request, response) => {
  response.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startWhatsApp() {
  await loadSummary();

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: AUTH_DIR }),
    // Let the installed Chrome report its current user-agent. The library's
    // old default user-agent can make WhatsApp Web reload during injection.
    userAgent: false,
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      ...(BROWSER_PATH ? { executablePath: BROWSER_PATH } : {}),
    },
  });

  client.on('qr', async (qr) => {
    state.connection = 'qr';
    state.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
    state.lastError = null;
  });

  client.on('loading_screen', (percent, message) => {
    state.connection = 'loading';
    state.lastError = `${message} (${percent}%)`;
  });

  client.on('authenticated', () => {
    state.connection = 'authenticated';
    state.qr = null;
    state.lastError = null;
  });

  client.on('ready', () => {
    state.connection = 'ready';
    state.qr = null;
    state.lastError = null;
  });

  client.on('auth_failure', (message) => {
    state.connection = 'auth_failure';
    state.lastError = message || 'Autentikasi WhatsApp gagal.';
  });

  client.on('disconnected', (reason) => {
    state.connection = 'disconnected';
    state.lastError = reason || 'Sesi WhatsApp terputus.';
  });

  client.on('change_state', (nextState) => {
    if (nextState !== 'CONNECTED' && state.connection === 'ready') {
      state.connection = nextState.toLowerCase();
    }
  });

  client.on('error', (error) => {
    state.lastError = error?.message || String(error);
  });

  await client.initialize();
}

const server = app.listen(PORT, HOST, () => {
  console.log(`WA Chat Counter berjalan di http://${HOST}:${PORT}`);
});

async function initializeWhatsAppWithRetry() {
  while (!shuttingDown) {
    try {
      await startWhatsApp();
      return;
    } catch (error) {
      state.connection = 'reconnecting';
      state.lastError = error?.message || String(error);
      console.error(error);

      if (client) {
        try {
          await client.destroy();
        } catch {
          // The browser may already have closed after a navigation failure.
        }
        client = null;
      }

      if (!shuttingDown) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

void initializeWhatsAppWithRetry();

async function shutdown(signal) {
  console.log(`\n${signal}: menutup aplikasi...`);
  shuttingDown = true;
  server.close();
  if (client) {
    try {
      await client.destroy();
    } catch (error) {
      console.error(`Gagal menutup sesi WhatsApp: ${error.message}`);
    }
  }
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

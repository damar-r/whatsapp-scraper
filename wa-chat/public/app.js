const elements = {
  connectionBadge: document.querySelector('#connectionBadge'),
  loginContent: document.querySelector('#loginContent'),
  loginHint: document.querySelector('#loginHint'),
  startDate: document.querySelector('#startDate'),
  endDate: document.querySelector('#endDate'),
  scanButton: document.querySelector('#scanButton'),
  scanPercent: document.querySelector('#scanPercent'),
  progressBar: document.querySelector('#progressBar'),
  progressLabel: document.querySelector('#progressLabel'),
  chatCounter: document.querySelector('#chatCounter'),
  scanError: document.querySelector('#scanError'),
  numberCount: document.querySelector('#numberCount'),
  startDateResult: document.querySelector('#startDateResult'),
  endDateResult: document.querySelector('#endDateResult'),
  scanInfo: document.querySelector('#scanInfo'),
  jsonExport: document.querySelector('#jsonExport'),
  csvExport: document.querySelector('#csvExport'),
};

const connectionLabels = {
  starting: 'Menyiapkan…',
  loading: 'Memuat WhatsApp…',
  qr: 'Menunggu QR',
  authenticated: 'Terverifikasi',
  ready: 'Terhubung',
  reconnecting: 'Menghubungkan ulang…',
  disconnected: 'Terputus',
  auth_failure: 'Autentikasi gagal',
  error: 'Terjadi kesalahan',
};

let dateInputsDirty = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID').format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function setDefaultDates() {
  if (elements.startDate.value && elements.endDate.value) return;
  const today = new Date();
  const toInputDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const end = toInputDate(today);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - 30);
  const start = toInputDate(startDate);
  if (!elements.startDate.value) elements.startDate.value = start;
  if (!elements.endDate.value) elements.endDate.value = end;
}

function formatInputDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium' }).format(date);
}

function setConnection(connection) {
  const label = connectionLabels[connection] || connection || 'Status tidak diketahui';
  elements.connectionBadge.textContent = label;
  elements.connectionBadge.className = 'badge';
  if (connection === 'ready') elements.connectionBadge.classList.add('badge-ready');
  else if (['qr', 'loading', 'authenticated'].includes(connection)) elements.connectionBadge.classList.add('badge-warning');
  else if (['error', 'auth_failure', 'disconnected'].includes(connection)) elements.connectionBadge.classList.add('badge-error');
  else elements.connectionBadge.classList.add('badge-muted');
}

function renderLogin(status) {
  if (status.qr) {
    elements.loginContent.innerHTML = `
      <div class="qr-placeholder">
        <img class="qr-image" src="${status.qr}" alt="QR code WhatsApp Web" />
        <p>Buka WhatsApp di ponsel → Setelan → Perangkat tertaut → Tautkan perangkat.</p>
      </div>`;
    elements.loginHint.textContent = 'QR code akan berubah jika kedaluwarsa. Sesi disimpan hanya di komputer ini.';
    return;
  }

  if (status.connection === 'ready') {
    elements.loginContent.innerHTML = `
      <div class="qr-placeholder">
        <div class="success-mark">✓</div>
        <p>WhatsApp Web siap digunakan.</p>
      </div>`;
    elements.loginHint.textContent = 'Klik “Mulai hitung” untuk mendapatkan ringkasan akun.';
    return;
  }

  const message = status.lastError || 'Menyiapkan koneksi WhatsApp Web…';
  elements.loginContent.innerHTML = `<div class="qr-placeholder"><span class="spinner"></span><p>${escapeHtml(message)}</p></div>`;
  elements.loginHint.textContent = 'Tunggu sampai QR code muncul atau sesi tersambung.';
}

function renderProgress(status) {
  const scan = status.scan || {};
  const total = Number(scan.directChats) || 0;
  const processed = Number(scan.processedChats) || 0;
  const percent = total ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  elements.progressBar.style.width = `${percent}%`;
  elements.scanPercent.textContent = `${percent}%`;
  elements.chatCounter.textContent = `${formatNumber(processed)} / ${formatNumber(total)} nomor`;

  if (scan.running) elements.progressLabel.textContent = 'Pemindaian berjalan…';
  else if (scan.finishedAt) elements.progressLabel.textContent = scan.errors ? `Selesai · ${scan.errors} gagal` : 'Pemindaian selesai';
  else elements.progressLabel.textContent = 'Pilih rentang tanggal';

  elements.scanButton.disabled = status.connection !== 'ready' || Boolean(scan.running);
  elements.scanButton.textContent = scan.running ? 'Sedang menghitung…' : 'Mulai hitung';
  elements.scanError.textContent = status.lastError && !['qr', 'loading', 'authenticated'].includes(status.connection)
    ? status.lastError
    : '';
}

function renderSummary(summary, lastScan) {
  const safeSummary = summary || {};
  const hasResult = Boolean(lastScan || safeSummary.scannedAt);
  elements.numberCount.textContent = formatNumber(safeSummary.numberCount);
  elements.startDateResult.textContent = formatInputDate(safeSummary.startDate);
  elements.endDateResult.textContent = formatInputDate(safeSummary.endDate);
  elements.jsonExport.classList.toggle('disabled', !hasResult);
  elements.csvExport.classList.toggle('disabled', !hasResult);

  if (!hasResult) {
    elements.scanInfo.textContent = 'Belum ada data pemindaian.';
    return;
  }

  const scanned = formatNumber(safeSummary.scannedDirectChats);
  const errors = Number(safeSummary.directChatsWithErrors) || 0;
  elements.scanInfo.textContent = errors
    ? `${scanned} chat pribadi dipindai · ${formatNumber(errors)} tidak dapat dibaca · selesai ${formatDate(lastScan || safeSummary.scannedAt)}`
    : `${scanned} chat pribadi dipindai · selesai ${formatDate(lastScan || safeSummary.scannedAt)}`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'Permintaan gagal');
  return payload;
}

async function refresh() {
  try {
    const status = await fetchJson('/api/status');
    if (!dateInputsDirty && status.summary?.startDate && status.summary?.endDate) {
      elements.startDate.value = status.summary.startDate;
      elements.endDate.value = status.summary.endDate;
    }
    setConnection(status.connection);
    renderLogin(status);
    renderProgress(status);
    renderSummary(status.summary, status.lastScan);
  } catch (error) {
    elements.scanError.textContent = error.message;
  }
}

elements.startDate.addEventListener('input', () => { dateInputsDirty = true; });
elements.endDate.addEventListener('input', () => { dateInputsDirty = true; });

elements.scanButton.addEventListener('click', async () => {
  elements.scanButton.disabled = true;
  elements.scanError.textContent = '';
  const startDate = elements.startDate.value;
  const endDate = elements.endDate.value;

  if (!startDate || !endDate) {
    elements.scanError.textContent = 'Pilih tanggal mulai dan tanggal akhir.';
    elements.scanButton.disabled = false;
    return;
  }
  if (endDate < startDate) {
    elements.scanError.textContent = 'Tanggal akhir tidak boleh lebih awal dari tanggal mulai.';
    elements.scanButton.disabled = false;
    return;
  }

  try {
    await fetchJson('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate }),
    });
  } catch (error) {
    elements.scanError.textContent = error.message;
  }
  await refresh();
});

setDefaultDates();
await refresh();
setInterval(refresh, 1500);

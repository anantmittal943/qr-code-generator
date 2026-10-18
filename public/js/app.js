// Dynamic QR Studio - Frontend Application Logic

let currentTab = 'overview';
let qrPage = 1;
const qrLimit = 10;
let searchDebounceTimer = null;
let previewDebounceTimer = null;

// Chart Instances
let overviewChartInstance = null;
let deviceChartInstance = null;
let osChartInstance = null;
let browserChartInstance = null;
let modalChartInstance = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  if (window.lucide) {
    lucide.createIcons();
  }
  loadOverviewData();
  updateLivePreview();
});

// --- Tab Switching ---

function switchTab(tabName) {
  currentTab = tabName;

  // Update nav buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('bg-indigo-600', 'text-white', 'shadow-sm');
    btn.classList.add('text-slate-400');
  });

  const activeBtn = document.getElementById(`tab-btn-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.remove('text-slate-400');
    activeBtn.classList.add('bg-indigo-600', 'text-white', 'shadow-sm');
  }

  // Update view visibility
  document.querySelectorAll('.tab-content').forEach(section => {
    section.classList.add('hidden');
  });

  const targetSection = document.getElementById(`tab-${tabName}`);
  if (targetSection) {
    targetSection.classList.remove('hidden');
  }

  if (window.lucide) {
    lucide.createIcons();
  }

  // Trigger tab data loads
  if (tabName === 'overview') loadOverviewData();
  if (tabName === 'qrcodes') loadQRCodesList();
  if (tabName === 'analytics') loadAnalyticsData();
  if (tabName === 'settings') loadSettings();
}

// --- Overview Dashboard ---

async function loadOverviewData() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error('Failed to load overview statistics');
    const data = await res.json();

    // Update stat cards
    document.getElementById('stat-total-qrs').innerText = data.stats.totalQRs || 0;
    document.getElementById('stat-active-qrs').innerText = `${data.stats.activeQRs || 0} active`;
    document.getElementById('stat-total-scans').innerText = data.stats.totalScans || 0;
    document.getElementById('stat-today-scans').innerText = `${data.stats.todayScans || 0} scans`;
    document.getElementById('stat-unique-visitors').innerText = data.stats.uniqueVisitors || 0;

    const rate = data.stats.totalQRs > 0 ? Math.round((data.stats.activeQRs / data.stats.totalQRs) * 100) : 100;
    document.getElementById('stat-active-rate').innerText = `${rate}%`;

    // Render Timeline Chart
    renderOverviewChart(data.timeline);

    // Render Top QRs
    renderTopQRs(data.topQRs);

    // Render Recent Scans
    renderRecentScans(data.recentScans);

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderOverviewChart(timeline) {
  const ctx = document.getElementById('overviewTimelineChart')?.getContext('2d');
  if (!ctx) return;

  if (overviewChartInstance) {
    overviewChartInstance.destroy();
  }

  overviewChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: (timeline?.labels || []).map(l => l.slice(5)), // MM-DD
      datasets: [{
        label: 'Scans',
        data: timeline?.counts || [],
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.15)',
        fill: true,
        tension: 0.35,
        borderWidth: 2,
        pointBackgroundColor: '#818cf8',
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { size: 11 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', stepSize: 1, font: { size: 11 } }
        }
      }
    }
  });
}

function renderTopQRs(topList = []) {
  const container = document.getElementById('top-qrs-list');
  if (!container) return;

  if (topList.length === 0) {
    container.innerHTML = `<div class="text-xs text-slate-500 py-6 text-center">No QR campaigns created yet.</div>`;
    return;
  }

  container.innerHTML = topList.map(qr => `
    <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/60 border border-slate-800 hover:border-slate-700 transition-colors">
      <div class="min-w-0 pr-2">
        <div class="text-xs font-semibold text-white truncate">${escapeHtml(qr.title)}</div>
        <div class="text-[10px] text-indigo-400 font-mono">/r/${qr.slug}</div>
      </div>
      <div class="text-right shrink-0">
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          ${qr.totalScans} scans
        </span>
      </div>
    </div>
  `).join('');
}

function renderRecentScans(scans = []) {
  const tbody = document.getElementById('recent-scans-table');
  if (!tbody) return;

  if (scans.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-slate-500">No scan events recorded yet.</td></tr>`;
    return;
  }

  tbody.innerHTML = scans.map(s => {
    const timeStr = new Date(s.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = new Date(s.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `
      <tr class="hover:bg-slate-800/30 transition-colors">
        <td class="py-2.5 px-3 text-slate-400 whitespace-nowrap">${dateStr} ${timeStr}</td>
        <td class="py-2.5 px-3 text-white font-sans font-medium truncate max-w-[140px]">${escapeHtml(s.qrTitle || s.slug)}</td>
        <td class="py-2.5 px-3 text-indigo-400 font-mono">/r/${s.slug}</td>
        <td class="py-2.5 px-3">
          <span class="px-1.5 py-0.5 rounded text-[10px] uppercase font-semibold ${s.device === 'mobile' ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-700 text-slate-300'}">
            ${s.device || 'desktop'}
          </span>
        </td>
        <td class="py-2.5 px-3 text-slate-300 truncate max-w-[120px]">${s.browser} (${s.os})</td>
        <td class="py-2.5 px-3 text-slate-400 truncate max-w-[120px]">${s.referrer || 'Direct'}</td>
      </tr>
    `;
  }).join('');
}

// --- QR Codes Manager Tab ---

function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    qrPage = 1;
    loadQRCodesList();
  }, 300);
}

function changePage(delta) {
  qrPage = Math.max(1, qrPage + delta);
  loadQRCodesList();
}

async function loadQRCodesList() {
  const container = document.getElementById('qrcodes-container');
  if (!container) return;

  const search = document.getElementById('qr-search-input')?.value || '';
  const status = document.getElementById('qr-status-filter')?.value || 'all';

  let url = `/api/qr?page=${qrPage}&limit=${qrLimit}&search=${encodeURIComponent(search)}`;
  if (status === 'active') url += '&active=true';
  if (status === 'inactive') url += '&active=false';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to load QR codes');
    const data = await res.json();

    // Pagination info
    const total = data.total || 0;
    const start = total === 0 ? 0 : (qrPage - 1) * qrLimit + 1;
    const end = Math.min(qrPage * qrLimit, total);
    document.getElementById('qr-page-info').innerText = `Showing ${start}-${end} of ${total}`;

    document.getElementById('qr-prev-btn').disabled = qrPage <= 1;
    document.getElementById('qr-next-btn').disabled = end >= total;

    if (data.items.length === 0) {
      container.innerHTML = `
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center space-y-3">
          <i data-lucide="qr-code" class="w-12 h-12 text-slate-600 mx-auto"></i>
          <h3 class="text-base font-bold text-white">No QR codes found</h3>
          <p class="text-xs text-slate-400">Create your first dynamic QR code to begin tracking redirections.</p>
          <button onclick="switchTab('create')" class="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
            <i data-lucide="plus" class="w-4 h-4"></i>
            <span>Create New QR</span>
          </button>
        </div>
      `;
      if (window.lucide) lucide.createIcons();
      return;
    }

    container.innerHTML = data.items.map(qr => {
      const shortUrl = qr.shortUrl || `${window.location.origin}/r/${qr.slug}`;
      const isActive = qr.active !== false;
      const isExpired = Boolean(qr.expiresAt && new Date(qr.expiresAt).getTime() <= Date.now());

      let statusBadge = '';
      if (isExpired) {
        statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">Expired</span>`;
      } else if (!isActive) {
        statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Paused</span>`;
      } else {
        statusBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>`;
      }

      const expiryBadge = qr.expiresAt ? `
        <div class="text-[11px] ${isExpired ? 'text-rose-400 font-medium' : 'text-slate-400'} flex items-center space-x-1">
          <i data-lucide="clock" class="w-3 h-3"></i>
          <span>${isExpired ? 'Expired:' : 'Expires:'} ${new Date(qr.expiresAt).toLocaleString()}</span>
        </div>
      ` : '';

      return `
        <div class="bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl p-4 transition-all flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          <!-- Thumbnail & Info -->
          <div class="flex items-center space-x-4 min-w-0">
            <div class="w-16 h-16 rounded-xl bg-white p-1.5 shrink-0 flex items-center justify-center shadow">
              <img src="/api/qr/${qr.id}/preview?size=150" alt="QR" class="w-full h-full object-contain">
            </div>
            <div class="min-w-0 space-y-1">
              <div class="flex items-center space-x-2">
                <span class="font-bold text-sm text-white truncate max-w-[220px] sm:max-w-xs">${escapeHtml(qr.title)}</span>
                ${statusBadge}
              </div>
              <div class="flex items-center space-x-2 text-xs">
                <span class="text-indigo-400 font-mono font-medium">${shortUrl}</span>
                <button onclick="copyToClipboard('${shortUrl}')" title="Copy Short URL" class="text-slate-400 hover:text-white transition-colors">
                  <i data-lucide="copy" class="w-3.5 h-3.5"></i>
                </button>
                <a href="${shortUrl}" target="_blank" title="Test Redirection" class="text-slate-400 hover:text-white transition-colors">
                  <i data-lucide="external-link" class="w-3.5 h-3.5"></i>
                </a>
              </div>
              <div class="text-[11px] text-slate-400 truncate max-w-sm sm:max-w-md flex items-center space-x-1">
                <span>&rarr; Destination:</span>
                <a href="${escapeHtml(qr.destinationUrl)}" target="_blank" class="text-slate-300 hover:underline truncate">${escapeHtml(qr.destinationUrl)}</a>
              </div>
              ${expiryBadge}
            </div>
          </div>

          <!-- Stats & Actions -->
          <div class="flex items-center justify-between md:justify-end space-x-4 pt-3 md:pt-0 border-t md:border-t-0 border-slate-800">
            <!-- Scans Counter -->
            <div class="text-right">
              <div class="text-base font-extrabold text-white">${qr.totalScans || 0}</div>
              <div class="text-[10px] text-slate-400">Total Scans</div>
            </div>

            <!-- Action Toolbar Buttons -->
            <div class="flex items-center space-x-1.5">
              <button onclick="toggleQRActive('${qr.id}', ${!isActive})" title="${isActive ? 'Pause QR Code' : 'Activate QR Code'}" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
                <i data-lucide="${isActive ? 'pause' : 'play'}" class="w-4 h-4 ${isActive ? 'text-amber-400' : 'text-emerald-400'}"></i>
              </button>
              <button onclick="openQRAnalytics('${qr.id}')" title="Analytics" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
                <i data-lucide="bar-chart-2" class="w-4 h-4 text-indigo-400"></i>
              </button>
              <button onclick="openEditModal('${qr.id}')" title="Edit Destination URL" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
                <i data-lucide="edit-3" class="w-4 h-4 text-slate-200"></i>
              </button>
              <a href="/api/qr/${qr.id}/download?format=png" title="Download PNG" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
                <i data-lucide="image" class="w-4 h-4 text-emerald-400"></i>
              </a>
              <a href="/api/qr/${qr.id}/download?format=svg" title="Download SVG" class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors">
                <i data-lucide="file-code" class="w-4 h-4 text-purple-400"></i>
              </a>
              <button onclick="confirmDeleteQR('${qr.id}')" title="Delete" class="p-2 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 transition-colors">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) lucide.createIcons();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Live QR Preview Generator (Create Tab) ---

function syncColorInput(type) {
  const hex = document.getElementById(`create-${type}-hex`).value;
  if (/^#[0-9A-F]{6}$/i.test(hex)) {
    document.getElementById(`create-${type}`).value = hex;
    updateLivePreview();
  }
}

function updateLivePreview() {
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(() => {
    const dest = document.getElementById('create-destination')?.value || 'https://example.com';
    const slug = (document.getElementById('create-slug')?.value || 'sample').trim().toLowerCase();
    const fg = document.getElementById('create-fg')?.value || '#000000';
    const bg = document.getElementById('create-bg')?.value || '#ffffff';
    const ecl = document.getElementById('create-ecl')?.value || 'M';

    if (document.getElementById('create-fg-hex')) document.getElementById('create-fg-hex').value = fg;
    if (document.getElementById('create-bg-hex')) document.getElementById('create-bg-hex').value = bg;

    const encodedUrl = `${window.location.origin}/r/${slug}`;
    const previewUrl = `/api/preview-custom?text=${encodeURIComponent(encodedUrl)}&fgColor=${encodeURIComponent(fg)}&bgColor=${encodeURIComponent(bg)}&errorCorrectionLevel=${ecl}`;

    const img = document.getElementById('live-qr-preview-img');
    if (img) img.src = previewUrl;

    const encodedText = document.getElementById('live-encoded-url');
    if (encodedText) encodedText.innerText = encodedUrl;
  }, 200);
}

async function handleCreateQR(e) {
  e.preventDefault();

  const destinationUrl = document.getElementById('create-destination').value.trim();
  const title = document.getElementById('create-title').value.trim();
  const slug = document.getElementById('create-slug').value.trim();
  const tags = document.getElementById('create-tags').value.trim();
  const fgColor = document.getElementById('create-fg').value;
  const bgColor = document.getElementById('create-bg').value;
  const errorCorrectionLevel = document.getElementById('create-ecl').value;
  const expiresVal = document.getElementById('create-expires').value;
  const expiresAt = expiresVal ? new Date(expiresVal).toISOString() : null;

  try {
    const res = await fetch('/api/qr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        destinationUrl,
        title,
        slug: slug || undefined,
        tags,
        expiresAt,
        style: { fgColor, bgColor, errorCorrectionLevel }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to create QR code');

    showToast(`QR Code "${data.title}" generated successfully!`, 'success');
    document.getElementById('create-qr-form').reset();
    updateLivePreview();
    switchTab('qrcodes');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Toggle Active & Delete ---

async function toggleQRActive(id, newStatus) {
  try {
    const res = await fetch(`/api/qr/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: newStatus })
    });
    if (!res.ok) throw new Error('Failed to update status');
    showToast(newStatus ? 'Campaign activated' : 'Campaign paused', 'info');
    loadQRCodesList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmDeleteQR(id) {
  if (!confirm('Are you sure you want to delete this QR code and all its scan history?')) return;

  try {
    const res = await fetch(`/api/qr/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete QR code');
    showToast('QR code deleted', 'success');
    loadQRCodesList();
    loadOverviewData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function formatDateTimeLocal(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2, '0');
  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

// --- Edit QR Modal ---

async function openEditModal(id) {
  try {
    const res = await fetch(`/api/qr/${id}`);
    if (!res.ok) throw new Error('Failed to fetch QR code details');
    const qr = await res.json();

    document.getElementById('edit-qr-id').value = qr.id;
    document.getElementById('edit-qr-title').value = qr.title || '';
    document.getElementById('edit-qr-destination').value = qr.destinationUrl || '';
    document.getElementById('edit-qr-active').value = qr.active !== false ? 'true' : 'false';
    document.getElementById('edit-qr-tags').value = (qr.tags || []).join(', ');
    document.getElementById('edit-qr-expires').value = formatDateTimeLocal(qr.expiresAt);

    openModal('modal-edit-qr');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleUpdateQR(e) {
  e.preventDefault();
  const id = document.getElementById('edit-qr-id').value;
  const title = document.getElementById('edit-qr-title').value.trim();
  const destinationUrl = document.getElementById('edit-qr-destination').value.trim();
  const active = document.getElementById('edit-qr-active').value === 'true';
  const tags = document.getElementById('edit-qr-tags').value.trim();
  const expiresVal = document.getElementById('edit-qr-expires').value;
  const expiresAt = expiresVal ? new Date(expiresVal).toISOString() : null;

  try {
    const res = await fetch(`/api/qr/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, destinationUrl, active, tags, expiresAt })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to update QR code');
    }

    showToast('Destination URL & details updated successfully!', 'success');
    closeModal('modal-edit-qr');
    loadQRCodesList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- QR Deep Analytics Modal ---

async function openQRAnalytics(id) {
  try {
    const res = await fetch(`/api/qr/${id}/analytics`);
    if (!res.ok) throw new Error('Failed to load QR analytics');
    const data = await res.json();

    document.getElementById('modal-analytics-title').innerText = data.qr.title;
    document.getElementById('modal-analytics-slug').innerText = `/r/${data.qr.slug} &rarr; ${data.qr.destinationUrl}`;
    document.getElementById('modal-qr-total-scans').innerText = data.qr.totalScans || 0;
    document.getElementById('modal-qr-unique').innerText = data.qr.uniqueVisitors || 0;
    document.getElementById('modal-qr-created').innerText = new Date(data.qr.createdAt).toLocaleDateString();

    // Chart
    const ctx = document.getElementById('modalQRChart')?.getContext('2d');
    if (ctx) {
      if (modalChartInstance) modalChartInstance.destroy();
      modalChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: (data.timeline?.labels || []).map(l => l.slice(5)),
          datasets: [{
            label: 'Scans',
            data: data.timeline?.counts || [],
            backgroundColor: '#6366f1',
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
            y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', stepSize: 1 } }
          }
        }
      });
    }

    // Scans table
    const tbody = document.getElementById('modal-qr-scans-table');
    if (tbody) {
      if (data.recentScans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-500">No scans recorded yet.</td></tr>`;
      } else {
        tbody.innerHTML = data.recentScans.map(s => `
          <tr class="hover:bg-slate-800/40">
            <td class="py-2 px-3 text-slate-400 whitespace-nowrap">${new Date(s.timestamp).toLocaleString()}</td>
            <td class="py-2 px-3 text-slate-300">${s.device}</td>
            <td class="py-2 px-3 text-slate-300">${s.browser}</td>
            <td class="py-2 px-3 text-slate-300">${s.os}</td>
            <td class="py-2 px-3 text-slate-400">${s.referrer || 'Direct'}</td>
          </tr>
        `).join('');
      }
    }

    openModal('modal-analytics-qr');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Bulk Features ---

let selectedCsvFile = null;

function handleDragOver(e) {
  e.preventDefault();
  document.getElementById('drop-zone')?.classList.add('border-indigo-500', 'bg-indigo-500/10');
}

function handleDragLeave(e) {
  e.preventDefault();
  document.getElementById('drop-zone')?.classList.remove('border-indigo-500', 'bg-indigo-500/10');
}

function handleDrop(e) {
  e.preventDefault();
  handleDragLeave(e);
  if (e.dataTransfer.files?.length > 0) {
    setCsvFile(e.dataTransfer.files[0]);
  }
}

function handleFileSelected(e) {
  if (e.target.files?.length > 0) {
    setCsvFile(e.target.files[0]);
  }
}

document.getElementById('drop-zone')?.addEventListener('click', () => {
  document.getElementById('csv-file-input')?.click();
});

function setCsvFile(file) {
  if (!file.name.endsWith('.csv')) {
    showToast('Please select a valid .csv file', 'error');
    return;
  }
  selectedCsvFile = file;
  document.getElementById('csv-filename').innerText = `${file.name} (${Math.round(file.size / 1024)} KB)`;
  document.getElementById('csv-file-status').classList.remove('hidden');
  document.getElementById('upload-csv-btn').disabled = false;
}

async function submitBulkCsv() {
  if (!selectedCsvFile) return;

  const btn = document.getElementById('upload-csv-btn');
  btn.disabled = true;
  btn.innerText = 'Processing batch...';

  const formData = new FormData();
  formData.append('file', selectedCsvFile);

  try {
    const res = await fetch('/api/bulk/upload', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to process CSV file');

    showBulkResults(data);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerText = 'Upload & Generate from CSV';
  }
}

async function submitBulkText() {
  const text = document.getElementById('bulk-text-input').value.trim();
  if (!text) {
    showToast('Please enter at least one URL', 'error');
    return;
  }

  try {
    const res = await fetch('/api/bulk/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to process bulk entries');

    showBulkResults(data);
    document.getElementById('bulk-text-input').value = '';
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showBulkResults(results) {
  const box = document.getElementById('bulk-results-box');
  const title = document.getElementById('bulk-summary-title');
  const list = document.getElementById('bulk-created-list');

  box.classList.remove('hidden');
  title.innerText = `Successfully Generated ${results.successCount} of ${results.total} QR Codes`;

  list.innerHTML = results.created.map(qr => `
    <div class="flex items-center justify-between p-2 rounded-lg bg-slate-800/80 border border-slate-700">
      <div class="truncate pr-2">
        <span class="font-bold text-white">${escapeHtml(qr.title)}</span>
        <span class="text-indigo-400 font-mono ml-2">/r/${qr.slug}</span>
        <span class="text-slate-400 text-[10px] ml-2">&rarr; ${escapeHtml(qr.destinationUrl)}</span>
      </div>
      <div class="flex space-x-1 shrink-0">
        <a href="/api/qr/${qr.id}/download?format=png" class="px-2 py-0.5 rounded bg-indigo-600 text-white font-bold text-[10px]">PNG</a>
        <a href="/api/qr/${qr.id}/download?format=svg" class="px-2 py-0.5 rounded bg-slate-700 text-slate-200 font-bold text-[10px]">SVG</a>
      </div>
    </div>
  `).join('');

  showToast(`Bulk generation complete: ${results.successCount} QR codes created!`, 'success');
  if (window.lucide) lucide.createIcons();
}

function downloadSampleCsv() {
  const sample = `title,destination_url,custom_slug,tags,fg_color,bg_color
Summer Sale Flyer,https://yourstore.com/summer,summer26,Retail,#000000,#ffffff
Product Catalog,https://yourstore.com/catalog,catalog,Promo,#0f766e,#f0fdfa
Customer Loyalty,https://yourstore.com/loyalty,rewards,Loyalty,#4338ca,#ffffff`;

  const blob = new Blob([sample], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'dynamic-qr-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function downloadBulkZip() {
  window.location.href = '/api/bulk/export?format=all';
}

// --- Global Analytics Tab ---

async function loadAnalyticsData() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error('Failed to load analytics');
    const data = await res.json();

    renderDoughnutChart('deviceChart', data.devices, ['#6366f1', '#10b981', '#f59e0b', '#ec4899']);
    renderBarChart('osChart', data.oses, '#10b981');
    renderBarChart('browserChart', data.browsers, '#f59e0b');

    // Referrers
    const refContainer = document.getElementById('referrers-list');
    if (refContainer) {
      if (!data.referrers?.labels || data.referrers.labels.length === 0) {
        refContainer.innerHTML = `<div class="text-slate-500 py-4 text-center">No referral traffic recorded yet.</div>`;
      } else {
        refContainer.innerHTML = data.referrers.labels.map((label, idx) => `
          <div class="flex items-center justify-between p-2 rounded-lg bg-slate-800/60 border border-slate-800">
            <span class="text-slate-300 font-mono">${escapeHtml(label)}</span>
            <span class="font-bold text-indigo-400">${data.referrers.counts[idx]} scans</span>
          </div>
        `).join('');
      }
    }

    // Analytics scan audit log
    const auditTbody = document.getElementById('analytics-scans-table');
    if (auditTbody) {
      if (data.recentScans.length === 0) {
        auditTbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-slate-500">No scan activity recorded.</td></tr>`;
      } else {
        auditTbody.innerHTML = data.recentScans.map(s => `
          <tr class="hover:bg-slate-800/40">
            <td class="py-2 px-3 text-slate-400 whitespace-nowrap">${new Date(s.timestamp).toLocaleString()}</td>
            <td class="py-2 px-3 text-indigo-400 font-mono">/r/${s.slug}</td>
            <td class="py-2 px-3 text-slate-300">${s.device} / ${s.os}</td>
            <td class="py-2 px-3 text-slate-300">${s.browser}</td>
            <td class="py-2 px-3 text-slate-400">${s.referrer || 'Direct'}</td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderDoughnutChart(canvasId, aggregateData, colors) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  if (canvasId === 'deviceChart' && deviceChartInstance) deviceChartInstance.destroy();

  const chart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: aggregateData?.labels || ['None'],
      datasets: [{
        data: aggregateData?.counts?.length ? aggregateData.counts : [1],
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } }
      }
    }
  });

  if (canvasId === 'deviceChart') deviceChartInstance = chart;
}

function renderBarChart(canvasId, aggregateData, color) {
  const ctx = document.getElementById(canvasId)?.getContext('2d');
  if (!ctx) return;

  if (canvasId === 'osChart' && osChartInstance) osChartInstance.destroy();
  if (canvasId === 'browserChart' && browserChartInstance) browserChartInstance.destroy();

  const chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: aggregateData?.labels || [],
      datasets: [{
        data: aggregateData?.counts || [],
        backgroundColor: color,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { size: 10 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', stepSize: 1, font: { size: 10 } } }
      }
    }
  });

  if (canvasId === 'osChart') osChartInstance = chart;
  if (canvasId === 'browserChart') browserChartInstance = chart;
}

// --- Settings Tab ---

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error('Failed to fetch settings');
    const data = await res.json();

    document.getElementById('settings-baseurl').value = data.baseUrl || window.location.origin;
    document.getElementById('settings-appname').value = data.appName || 'Dynamic QR Studio';
    document.getElementById('settings-admin-protection').checked = Boolean(data.adminProtection);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const baseUrl = document.getElementById('settings-baseurl').value.trim();
  const appName = document.getElementById('settings-appname').value.trim();
  const adminProtection = document.getElementById('settings-admin-protection').checked;
  const adminKey = document.getElementById('settings-admin-key').value.trim();

  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, appName, adminProtection, adminKey: adminKey || undefined })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save settings');
    showToast('Settings updated successfully', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- Modals & Toasts ---

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
  if (window.lucide) lucide.createIcons();
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  const bgColors = {
    success: 'bg-emerald-600 text-white',
    error: 'bg-rose-600 text-white',
    info: 'bg-indigo-600 text-white'
  };

  toast.className = `toast px-4 py-2.5 rounded-xl shadow-xl text-xs font-semibold flex items-center space-x-2 ${bgColors[type] || bgColors.info}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Short URL copied to clipboard!', 'success');
  }).catch(() => {
    showToast('Could not copy to clipboard', 'error');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

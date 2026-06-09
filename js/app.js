// app.js — Main App Orchestration & UI Logic
// Manages the full workflow: upload → scan → parse → display → export

(function () {
  'use strict';

  window.CalScan = window.CalScan || {};

  // ─── State ────────────────────────────────────────────────

  const State = {
    currentFile: null,
    extractedText: '',
    events: [],
    isProcessing: false,
    editingEventId: null
  };

  // ─── DOM References ───────────────────────────────────────

  const DOM = {};

  function cacheDOMReferences() {
    DOM.uploadZone = document.getElementById('upload-zone');
    DOM.fileInput = document.getElementById('file-input');
    DOM.processing = document.getElementById('processing');
    DOM.progressFill = document.getElementById('progress-fill');
    DOM.processingStatus = document.getElementById('processing-status');
    DOM.stepScan = document.getElementById('step-scan');
    DOM.stepExtract = document.getElementById('step-extract');
    DOM.stepParse = document.getElementById('step-parse');
    DOM.eventsSection = document.getElementById('events-section');
    DOM.eventsList = document.getElementById('events-list');
    DOM.eventsCount = document.getElementById('events-count');
    DOM.actionBar = document.getElementById('action-bar');
    DOM.addAllBtn = document.getElementById('add-all-btn');
    DOM.downloadBtn = document.getElementById('download-btn');
    DOM.newScanBtn = document.getElementById('new-scan-btn');
    DOM.toastContainer = document.getElementById('toast-container');
    DOM.extractedText = document.getElementById('extracted-text');
    DOM.textPreview = document.getElementById('text-preview');
  }

  // ─── Toast Notifications ──────────────────────────────────

  function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const icons = {
      success: '✓',
      warning: '⚠',
      error: '✕',
      info: 'ℹ'
    };

    toast.innerHTML = `
      <span class="toast__icon">${icons[type] || 'ℹ'}</span>
      <span class="toast__message">${message}</span>
    `;

    DOM.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast--exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ─── Upload Handling ──────────────────────────────────────

  function setupUploadListeners() {
    const zone = DOM.uploadZone;

    // Click to upload
    zone.addEventListener('click', () => {
      if (!State.isProcessing) DOM.fileInput.click();
    });

    // File input change
    DOM.fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
      }
    });

    // Drag & drop
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('upload-zone--dragover');
    });

    zone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('upload-zone--dragover');
    });

    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('upload-zone--dragover');

      if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
      }
    });

    // Prevent default drag behavior on document
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());
  }

  // ─── File Processing Pipeline ─────────────────────────────

  async function handleFile(file) {
    // Validate
    const validation = CalScan.Scanner.validateFile(file);
    if (!validation.valid) {
      showToast(validation.error, 'error');
      return;
    }

    State.currentFile = file;
    State.isProcessing = true;

    // Show processing UI
    DOM.uploadZone.classList.add('upload-zone--processing');
    showProcessing();
    hideEvents();

    try {
      // Step 1: Scan
      setStep('scan', 'active');
      setStep('extract', 'pending');
      setStep('parse', 'pending');
      updateProgress(5, 'Preparing scanner...');

      const result = await CalScan.Scanner.scan(file, (percent, status) => {
        // Map scanner progress to 5-60% range
        const mappedPercent = 5 + Math.round(percent * 0.55);
        updateProgress(mappedPercent, status);
      });

      State.extractedText = result.text;

      // Show extracted text preview
      if (DOM.extractedText && DOM.textPreview) {
        DOM.textPreview.textContent = result.text.substring(0, 5000) + (result.text.length > 5000 ? '\n... (truncated)' : '');
        DOM.extractedText.style.display = 'block';
      }

      // Step 2: Extract
      setStep('scan', 'done');
      setStep('extract', 'active');
      updateProgress(65, 'Extracting dates and events...');

      // Small delay for UX smoothness
      await sleep(400);

      // Step 3: Parse
      setStep('extract', 'done');
      setStep('parse', 'active');
      updateProgress(80, 'Parsing events...');

      const events = CalScan.Parser.parseEvents(State.extractedText);
      State.events = events;

      await sleep(300);
      updateProgress(100, 'Complete!');
      setStep('parse', 'done');

      await sleep(500);

      // Show results
      State.isProcessing = false;
      DOM.uploadZone.classList.remove('upload-zone--processing');

      if (events.length > 0) {
        renderEvents(events);
        showEvents();
        showToast(`Found ${events.length} event${events.length > 1 ? 's' : ''}! 🎉`, 'success');
      } else {
        hideProcessing();
        showEmptyState();
        showToast('No events detected. Try a clearer image or different document.', 'warning', 5000);
      }

    } catch (error) {
      console.error('Processing error:', error);
      State.isProcessing = false;
      DOM.uploadZone.classList.remove('upload-zone--processing');
      hideProcessing();
      showToast(`Failed to process file: ${error.message}`, 'error', 5000);
    }

    // Reset file input
    DOM.fileInput.value = '';
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Processing UI ────────────────────────────────────────

  function showProcessing() {
    DOM.processing.classList.add('processing--visible');
  }

  function hideProcessing() {
    DOM.processing.classList.remove('processing--visible');
  }

  function updateProgress(percent, status) {
    DOM.progressFill.style.width = `${Math.min(100, percent)}%`;
    if (status) DOM.processingStatus.textContent = status;
  }

  function setStep(step, state) {
    const el = document.getElementById(`step-${step}`);
    if (!el) return;

    el.classList.remove('processing__step--active', 'processing__step--done', 'processing__step--pending');

    if (state === 'active') {
      el.classList.add('processing__step--active');
    } else if (state === 'done') {
      el.classList.add('processing__step--done');
      const icon = el.querySelector('.processing__step-icon');
      if (icon) icon.textContent = '✓';
    }
  }

  // ─── Events UI ────────────────────────────────────────────

  function showEvents() {
    hideProcessing();
    DOM.eventsSection.classList.add('events--visible');
    DOM.actionBar.classList.add('action-bar--visible');
  }

  function hideEvents() {
    DOM.eventsSection.classList.remove('events--visible');
    DOM.actionBar.classList.remove('action-bar--visible');
  }

  function showEmptyState() {
    DOM.eventsSection.classList.add('events--visible');
    DOM.eventsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <div class="empty-state__text">No events found in this document</div>
        <p style="color: #64748b; margin-top: 0.5rem; font-size: 0.9rem;">
          Try uploading a document with clear dates like "Meeting on June 15 at 3pm"
        </p>
      </div>
    `;
    DOM.actionBar.classList.remove('action-bar--visible');
  }

  function renderEvents(events) {
    DOM.eventsCount.textContent = `${events.length} event${events.length > 1 ? 's' : ''}`;

    DOM.eventsList.innerHTML = events.map((event, index) => {
      const dateStr = CalScan.Parser.formatDateRange(event.startDate, event.endDate, event.isAllDay);
      const bgColor = event.color || '#64748b';

      return `
        <div class="event-card" id="event-${event.id}" style="--card-index: ${index};">
          <div class="event-card__header">
            <div class="event-card__icon" style="background: ${bgColor}22; color: ${bgColor};">
              ${event.icon}
            </div>
            <div class="event-card__info">
              <div class="event-card__title">${escapeHTML(event.title)}</div>
              <div class="event-card__category" style="color: ${bgColor};">${event.category}</div>
            </div>
          </div>
          <div class="event-card__details">
            <div class="event-card__detail">
              <span class="event-card__detail-icon">📅</span>
              <span>${dateStr}</span>
            </div>
            ${event.isAllDay ? `
              <div class="event-card__detail">
                <span class="event-card__detail-icon">☀️</span>
                <span>All Day</span>
              </div>
            ` : ''}
            ${event.location ? `
              <div class="event-card__detail">
                <span class="event-card__detail-icon">📍</span>
                <span>${escapeHTML(event.location)}</span>
              </div>
            ` : ''}
          </div>
          ${event.description && event.description !== event.title ? `
            <div class="event-card__description">${escapeHTML(truncate(event.description, 120))}</div>
          ` : ''}
          <div class="event-card__actions">
            <button class="btn btn--primary btn--small" onclick="CalScan.App.addSingleEvent('${event.id}')" title="Add to Calendar">
              <span>📅</span> Add to Calendar
            </button>
            <button class="btn btn--secondary btn--small" onclick="CalScan.App.editEvent('${event.id}')" title="Edit">
              <span>✏️</span> Edit
            </button>
            <button class="btn btn--danger btn--small btn--icon" onclick="CalScan.App.deleteEvent('${event.id}')" title="Delete">
              ✕
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Event Actions ────────────────────────────────────────

  function addSingleEvent(eventId) {
    const event = State.events.find(e => e.id === eventId);
    if (!event) return;

    try {
      CalScan.Calendar.addSingleEvent(event);
      showToast(`"${event.title}" added to calendar! 📅`, 'success');
    } catch (e) {
      showToast('Failed to generate calendar file', 'error');
    }
  }

  function addAllEvents() {
    if (State.events.length === 0) return;

    try {
      CalScan.Calendar.addAllToCalendar(State.events);
      showToast(`${State.events.length} event${State.events.length > 1 ? 's' : ''} added to calendar! 🎉`, 'success');
    } catch (e) {
      showToast('Failed to generate calendar file', 'error');
    }
  }

  function downloadAll() {
    if (State.events.length === 0) return;

    try {
      const ics = CalScan.Calendar.generateICS(State.events);
      CalScan.Calendar.downloadICS(ics, 'calscan-events.ics');
      showToast('Calendar file downloaded! 📥', 'success');
    } catch (e) {
      showToast('Failed to download calendar file', 'error');
    }
  }

  function deleteEvent(eventId) {
    const card = document.getElementById(`event-${eventId}`);
    if (card) {
      card.style.transition = 'all 0.4s ease';
      card.style.opacity = '0';
      card.style.transform = 'translateX(40px) scale(0.95)';
      card.style.maxHeight = card.offsetHeight + 'px';

      setTimeout(() => {
        card.style.maxHeight = '0';
        card.style.padding = '0';
        card.style.margin = '0';
        card.style.border = 'none';
      }, 200);

      setTimeout(() => {
        State.events = State.events.filter(e => e.id !== eventId);
        card.remove();

        // Update count
        DOM.eventsCount.textContent = `${State.events.length} event${State.events.length !== 1 ? 's' : ''}`;

        if (State.events.length === 0) {
          showEmptyState();
          DOM.actionBar.classList.remove('action-bar--visible');
        }

        showToast('Event removed', 'info');
      }, 500);
    }
  }

  function editEvent(eventId) {
    const event = State.events.find(e => e.id === eventId);
    if (!event) return;

    const card = document.getElementById(`event-${eventId}`);
    if (!card) return;

    // If already editing, cancel
    if (State.editingEventId === eventId) {
      renderEvents(State.events);
      State.editingEventId = null;
      return;
    }

    State.editingEventId = eventId;
    card.classList.add('event-card--editing');

    const formatDateForInput = (date) => {
      if (!date) return '';
      const offset = date.getTimezoneOffset();
      const local = new Date(date.getTime() - offset * 60000);
      return local.toISOString().slice(0, 16);
    };

    card.innerHTML = `
      <div class="event-card__header">
        <div class="event-card__icon" style="background: ${event.color}22; color: ${event.color};">
          ${event.icon}
        </div>
        <div class="event-card__info" style="flex: 1;">
          <label style="font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.25rem;">Title</label>
          <input type="text" class="edit-field edit-field--title" id="edit-title-${eventId}" value="${escapeAttr(event.title)}" />
        </div>
      </div>
      <div class="edit-row" style="margin-top: 1rem;">
        <div>
          <label style="font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.25rem;">Start</label>
          <input type="datetime-local" class="edit-field" id="edit-start-${eventId}" value="${formatDateForInput(event.startDate)}" />
        </div>
        <div>
          <label style="font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.25rem;">End</label>
          <input type="datetime-local" class="edit-field" id="edit-end-${eventId}" value="${formatDateForInput(event.endDate)}" />
        </div>
      </div>
      <div style="margin-top: 0.75rem;">
        <label style="font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.25rem;">Location</label>
        <input type="text" class="edit-field" id="edit-location-${eventId}" value="${escapeAttr(event.location || '')}" placeholder="Optional" />
      </div>
      <div style="margin-top: 0.75rem;">
        <label style="font-size: 0.75rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.25rem;">Description</label>
        <textarea class="edit-field" id="edit-desc-${eventId}" rows="2" placeholder="Optional">${escapeHTML(event.description || '')}</textarea>
      </div>
      <div class="event-card__actions">
        <button class="btn btn--primary btn--small" onclick="CalScan.App.saveEdit('${eventId}')">
          <span>✓</span> Save
        </button>
        <button class="btn btn--secondary btn--small" onclick="CalScan.App.cancelEdit('${eventId}')">
          <span>✕</span> Cancel
        </button>
      </div>
    `;
  }

  function saveEdit(eventId) {
    const event = State.events.find(e => e.id === eventId);
    if (!event) return;

    const title = document.getElementById(`edit-title-${eventId}`)?.value;
    const startStr = document.getElementById(`edit-start-${eventId}`)?.value;
    const endStr = document.getElementById(`edit-end-${eventId}`)?.value;
    const location = document.getElementById(`edit-location-${eventId}`)?.value;
    const description = document.getElementById(`edit-desc-${eventId}`)?.value;

    if (title) event.title = title.trim();
    if (startStr) event.startDate = new Date(startStr);
    if (endStr) event.endDate = new Date(endStr);
    event.location = location?.trim() || null;
    if (description !== undefined) event.description = description.trim();

    // Re-detect category based on updated title
    if (CalScan.Icons) {
      const cat = CalScan.Icons.detectCategory(event.title, event.description);
      event.category = cat.category;
      event.icon = cat.icon;
      event.color = cat.color;
    }

    // Check if it's now all-day (no time component)
    event.isAllDay = event.startDate.getHours() === 0 &&
      event.startDate.getMinutes() === 0 &&
      event.endDate.getHours() === 0 &&
      event.endDate.getMinutes() === 0;

    State.editingEventId = null;
    renderEvents(State.events);
    showToast('Event updated ✏️', 'success');
  }

  function cancelEdit(eventId) {
    State.editingEventId = null;
    renderEvents(State.events);
  }

  function resetApp() {
    State.currentFile = null;
    State.extractedText = '';
    State.events = [];
    State.isProcessing = false;
    State.editingEventId = null;

    hideEvents();
    hideProcessing();
    DOM.uploadZone.classList.remove('upload-zone--processing');
    updateProgress(0, '');

    // Hide extracted text
    if (DOM.extractedText) DOM.extractedText.style.display = 'none';

    // Reset step icons
    ['scan', 'extract', 'parse'].forEach(step => {
      const el = document.getElementById(`step-${step}`);
      if (el) {
        el.classList.remove('processing__step--active', 'processing__step--done');
        const icon = el.querySelector('.processing__step-icon');
        if (icon) {
          const defaultIcons = { scan: '1', extract: '2', parse: '3' };
          icon.textContent = defaultIcons[step];
        }
      }
    });
  }

  // ─── Utilities ────────────────────────────────────────────

  function escapeHTML(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function truncate(str, maxLen) {
    if (!str || str.length <= maxLen) return str;
    return str.substring(0, maxLen) + '...';
  }

  // ─── Initialization ───────────────────────────────────────

  async function init() {
    cacheDOMReferences();
    setupUploadListeners();

    // Action bar buttons
    DOM.addAllBtn?.addEventListener('click', addAllEvents);
    DOM.downloadBtn?.addEventListener('click', downloadAll);
    DOM.newScanBtn?.addEventListener('click', resetApp);

    // Log library status
    const chronoOk = typeof chrono !== 'undefined' && chrono && typeof chrono.parse === 'function';
    const tesseractOk = typeof Tesseract !== 'undefined';
    const pdfjsOk = typeof pdfjsLib !== 'undefined';
    console.log(`✅ CalScan initialized | chrono: ${chronoOk} | Tesseract: ${tesseractOk} | PDF.js: ${pdfjsOk}`);

    if (!chronoOk) {
      console.warn('⏳ chrono-node still loading, will use regex fallback if needed...');
    }
  }

  // Wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── Export ───────────────────────────────────────────────

  window.CalScan.App = {
    addSingleEvent,
    addAllEvents,
    deleteEvent,
    editEvent,
    saveEdit,
    cancelEdit,
    resetApp,
    showToast
  };

})();

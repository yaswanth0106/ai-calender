// calendar.js — ICS File Generation & Download
// Generates RFC 5545 compliant .ics files for Apple Calendar import.

(function () {
  'use strict';

  window.CalScan = window.CalScan || {};

  // ─── Helpers ───────────────────────────────────────────────

  /**
   * Format a Date to ICS datetime string (UTC): YYYYMMDDTHHMMSSZ
   */
  function formatDateToICS(date) {
    if (!date) return '';
    return date.toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
  }

  /**
   * Format a Date to ICS date-only string: YYYYMMDD (for all-day events)
   */
  function formatDateToICSDate(date) {
    if (!date) return '';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  /**
   * Escape special characters for ICS text fields
   * Per RFC 5545: backslash, semicolons, commas, and newlines must be escaped
   */
  function escapeICSText(text) {
    if (!text) return '';
    return text
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  /**
   * Fold long lines per RFC 5545 (max 75 octets per line)
   */
  function foldLine(line) {
    const maxLen = 75;
    if (line.length <= maxLen) return line;

    let result = line.substring(0, maxLen);
    let remaining = line.substring(maxLen);

    while (remaining.length > 0) {
      const chunk = remaining.substring(0, maxLen - 1); // -1 for the leading space
      result += '\r\n ' + chunk;
      remaining = remaining.substring(maxLen - 1);
    }

    return result;
  }

  /**
   * Generate a unique ID for calendar events
   */
  function generateUID() {
    const uuid = crypto.randomUUID
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    return uuid + '@calscan.app';
  }

  // ─── VEVENT Generation ────────────────────────────────────

  /**
   * Generate a single VEVENT block
   * @param {Object} event - Event object with title, startDate, endDate, etc.
   * @returns {string} VEVENT block string
   */
  function generateVEVENT(event) {
    const lines = [];

    lines.push('BEGIN:VEVENT');
    lines.push(foldLine('UID:' + generateUID()));
    lines.push('DTSTAMP:' + formatDateToICS(new Date()));
    lines.push('SEQUENCE:0');
    lines.push('STATUS:CONFIRMED');

    // Date/Time handling
    if (event.isAllDay) {
      lines.push('DTSTART;VALUE=DATE:' + formatDateToICSDate(event.startDate));
      // For all-day events, end date is exclusive (next day)
      const endDate = event.endDate ? new Date(event.endDate) : new Date(event.startDate);
      if (!event.endDate || event.startDate.toDateString() === event.endDate.toDateString()) {
        endDate.setDate(endDate.getDate() + 1);
      }
      lines.push('DTEND;VALUE=DATE:' + formatDateToICSDate(endDate));
    } else {
      lines.push('DTSTART:' + formatDateToICS(event.startDate));
      if (event.endDate) {
        lines.push('DTEND:' + formatDateToICS(event.endDate));
      } else {
        // Default: 1 hour duration
        const defaultEnd = new Date(event.startDate);
        defaultEnd.setHours(defaultEnd.getHours() + 1);
        lines.push('DTEND:' + formatDateToICS(defaultEnd));
      }
    }

    // Content fields
    lines.push(foldLine('SUMMARY:' + escapeICSText(event.title || 'Untitled Event')));

    if (event.description) {
      lines.push(foldLine('DESCRIPTION:' + escapeICSText(event.description)));
    }

    if (event.location) {
      lines.push(foldLine('LOCATION:' + escapeICSText(event.location)));
    }

    if (event.category && event.category !== 'default') {
      lines.push('CATEGORIES:' + escapeICSText(event.category.toUpperCase()));
    }

    // Add a 15-minute reminder
    lines.push('BEGIN:VALARM');
    lines.push('TRIGGER:-PT15M');
    lines.push('ACTION:DISPLAY');
    lines.push('DESCRIPTION:Event reminder');
    lines.push('END:VALARM');

    lines.push('END:VEVENT');

    return lines.join('\r\n');
  }

  // ─── ICS Calendar Generation ──────────────────────────────

  /**
   * Generate a complete .ics calendar file with multiple events
   * @param {Array<Object>} events - Array of event objects
   * @returns {string} Complete .ics file content
   */
  function generateICS(events) {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//CalScan//EventScanner//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:CalScan Events',
      'X-WR-TIMEZONE:UTC'
    ];

    for (const event of events) {
      lines.push(generateVEVENT(event));
    }

    lines.push('END:VCALENDAR');

    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Generate a .ics file for a single event
   * @param {Object} event - Event object
   * @returns {string} Complete .ics file content
   */
  function generateSingleICS(event) {
    return generateICS([event]);
  }

  // ─── Download & Export ────────────────────────────────────

  /**
   * Trigger a .ics file download in the browser
   * On iOS Safari, this opens the native "Add to Calendar" dialog
   * @param {string} icsContent - The .ics file content
   * @param {string} [filename='calscan-events.ics'] - Download filename
   */
  function downloadICS(icsContent, filename) {
    filename = filename || 'calscan-events.ics';

    const blob = new Blob([icsContent], {
      type: 'text/calendar;charset=utf-8'
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';

    document.body.appendChild(link);
    link.click();

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /**
   * Generate ICS for all events and trigger download
   * @param {Array<Object>} events - Array of event objects
   */
  function addAllToCalendar(events) {
    if (!events || events.length === 0) {
      throw new Error('No events to add');
    }
    const icsContent = generateICS(events);
    downloadICS(icsContent, 'calscan-events.ics');
  }

  /**
   * Generate ICS for a single event and trigger download
   * @param {Object} event - Event object
   */
  function addSingleEvent(event) {
    if (!event) {
      throw new Error('No event provided');
    }
    const icsContent = generateSingleICS(event);
    const safeName = (event.title || 'event')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 40);
    downloadICS(icsContent, `${safeName}.ics`);
  }

  // ─── Export ───────────────────────────────────────────────

  window.CalScan.Calendar = {
    generateICS,
    generateSingleICS,
    downloadICS,
    addAllToCalendar,
    addSingleEvent
  };

})();

// parser.js — Event Extraction with chrono-node + Regex Fallback
// Extracts structured events from raw text using multiple strategies.
// Handles large documents by processing in chunks.

(function () {
  'use strict';

  window.CalScan = window.CalScan || {};

  // ─── Helpers ───────────────────────────────────────────────

  function generateId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  function cleanTitle(text) {
    if (!text) return 'Untitled Event';

    let title = text
      .replace(/^[\s\-–—:,;.•·*#>|]+/, '')
      .replace(/[\s\-–—:,;.•·*#>|]+$/, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^---\s*Page\s*\d+\s*---$/i, '') // Remove page markers
      .trim();

    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    if (title.length < 2) return 'Event';
    if (title.length > 100) title = title.substring(0, 97) + '...';

    return title;
  }

  function extractLocation(text) {
    if (!text) return null;

    const locationPatterns = [
      /(?:at|@)\s+([A-Z][A-Za-z0-9\s,.'&\-]{2,40})/,
      /(?:in|venue[:\s])\s+([A-Z][A-Za-z0-9\s,.'&\-]{2,40})/i,
      /(?:location|place|where)[:\s]+([^\n,]{3,40})/i,
      /(?:room|hall|bldg|building)\s+([A-Za-z0-9\s\-]{1,20})/i,
    ];

    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) return match[1].trim();
    }

    return null;
  }

  function splitIntoSegments(text) {
    const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0);
    const segments = [];

    for (const line of lines) {
      // Skip page markers
      if (/^---\s*Page\s*\d+\s*---$/i.test(line)) continue;

      if (line.length > 300) {
        const sentences = line.split(/(?<=[.!?])\s+/);
        segments.push(...sentences.filter(s => s.length > 3));
      } else {
        segments.push(line);
      }
    }

    return segments;
  }

  function extractTitleFromSegment(segment, dateText) {
    if (!segment || !dateText) return cleanTitle(segment);

    let title = segment.replace(dateText, '').trim();
    title = title
      .replace(/^(?:on|at|from|to|by|before|after|until|during)\s+/i, '')
      .replace(/^[-–—:,;.]\s*/, '')
      .trim();

    return cleanTitle(title);
  }

  function inferEndDate(startDate, hasExplicitTime) {
    const endDate = new Date(startDate);
    if (hasExplicitTime) {
      endDate.setHours(endDate.getHours() + 1);
    } else {
      endDate.setDate(endDate.getDate() + 1);
    }
    return endDate;
  }

  function hasExplicitTime(chronoResult) {
    return chronoResult.start.isCertain('hour') || chronoResult.start.isCertain('minute');
  }

  function deduplicateEvents(events) {
    const seen = new Map();
    return events.filter(event => {
      const dateKey = event.startDate.toISOString().slice(0, 16);
      const titleKey = event.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
      const key = `${dateKey}|${titleKey}`;
      if (seen.has(key)) return false;
      seen.set(key, true);
      return true;
    });
  }

  // ─── Regex-Based Date Finder (Fallback) ───────────────────

  const DATE_PATTERNS = [
    // "January 15, 2026" or "Jan 15, 2026"
    {
      regex: /\b((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/gi,
      parser: (match) => new Date(match.replace(/(\d+)(?:st|nd|rd|th)/i, '$1'))
    },
    // "15 January 2026" or "15 Jan 2026"
    {
      regex: /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?,?\s+\d{4})/gi,
      parser: (match) => new Date(match.replace(/(\d+)(?:st|nd|rd|th)/i, '$1'))
    },
    // "2026-06-15" or "2026/06/15" (ISO format)
    {
      regex: /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})/g,
      parser: (match) => new Date(match.replace(/\//g, '-'))
    },
    // "06/15/2026" or "06-15-2026" (US format)
    {
      regex: /\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/g,
      parser: (match) => {
        const parts = match.split(/[-/]/);
        return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
      }
    },
    // "15/06/2026" (EU format — try if US parsing gives invalid date)
    {
      regex: /\b(\d{1,2}[-/]\d{1,2}[-/]\d{4})\b/g,
      parser: (match) => {
        const parts = match.split(/[-/]/);
        return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
      }
    },
    // "June 15" (no year — assume current/next year)
    {
      regex: /\b((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?)\b/gi,
      parser: (match) => {
        const d = new Date(match.replace(/(\d+)(?:st|nd|rd|th)/i, '$1') + ', ' + new Date().getFullYear());
        if (d < new Date()) d.setFullYear(d.getFullYear() + 1);
        return d;
      }
    }
  ];

  // Time patterns to pair with dates
  const TIME_PATTERN = /\b(\d{1,2})[:\.](\d{2})\s*(am|pm|AM|PM)?\b|\b(\d{1,2})\s*(am|pm|AM|PM)\b/;

  /**
   * Regex-based date extraction as fallback when chrono-node is unavailable
   */
  function regexFindDates(text) {
    const found = [];

    const segments = splitIntoSegments(text);

    for (const segment of segments) {
      for (const pattern of DATE_PATTERNS) {
        const matches = [...segment.matchAll(new RegExp(pattern.regex))];

        for (const match of matches) {
          try {
            const date = pattern.parser(match[1]);
            if (isNaN(date.getTime())) continue;
            if (date.getFullYear() < 2000 || date.getFullYear() > 2100) continue;

            // Try to find a time near the date match
            const afterDate = segment.slice(match.index + match[0].length, match.index + match[0].length + 30);
            const beforeDate = segment.slice(Math.max(0, match.index - 30), match.index);
            const nearby = beforeDate + ' ' + afterDate;
            const timeMatch = nearby.match(TIME_PATTERN);

            let hasTime = false;
            if (timeMatch) {
              let hours = parseInt(timeMatch[1] || timeMatch[4]);
              const minutes = parseInt(timeMatch[2] || '0');
              const meridiem = (timeMatch[3] || timeMatch[5] || '').toLowerCase();

              if (meridiem === 'pm' && hours < 12) hours += 12;
              if (meridiem === 'am' && hours === 12) hours = 0;

              if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                date.setHours(hours, minutes, 0, 0);
                hasTime = true;
              }
            }

            // Extract title — text around the date, cleaned up
            let title = segment.replace(match[0], '').trim();
            if (timeMatch) title = title.replace(timeMatch[0], '').trim();

            found.push({
              date: date,
              dateText: match[0],
              title: title,
              segment: segment,
              hasTime: hasTime
            });
          } catch (e) {
            // Skip invalid dates
          }
        }
      }
    }

    // Remove duplicate dates found by different patterns
    const unique = [];
    const seenDates = new Set();

    for (const item of found) {
      const key = item.date.toISOString().slice(0, 10) + '|' + item.segment.slice(0, 20);
      if (!seenDates.has(key)) {
        seenDates.add(key);
        unique.push(item);
      }
    }

    return unique;
  }

  // ─── Main Parser ──────────────────────────────────────────

  /**
   * Parse events from raw text using chrono-node (primary) + regex (fallback)
   */
  function parseEvents(text, referenceDate) {
    if (!text || text.trim().length === 0) return [];

    const refDate = referenceDate || new Date();
    const events = [];
    const Icons = window.CalScan.Icons;
    const chronoAvailable = typeof chrono !== 'undefined' && chrono && typeof chrono.parse === 'function';

    console.log(`🔍 Parsing text: ${text.length} chars, chrono available: ${chronoAvailable}`);

    if (chronoAvailable) {
      // ─── Strategy 1: chrono-node NLP parsing ───
      const segments = splitIntoSegments(text);
      console.log(`📝 Processing ${segments.length} segments with chrono-node`);

      for (const segment of segments) {
        if (segment.length < 4) continue;

        let results;
        try {
          results = chrono.parse(segment, refDate, { forwardDate: true });
        } catch (e) {
          console.warn('chrono parse error:', e);
          continue;
        }

        for (const result of results) {
          const startDate = result.start.date();
          const hasTime = hasExplicitTime(result);
          const isAllDay = !hasTime;

          let endDate = result.end ? result.end.date() : inferEndDate(startDate, hasTime);

          const title = extractTitleFromSegment(segment, result.text);
          const location = extractLocation(segment);

          const categoryInfo = Icons
            ? Icons.detectCategory(title, segment)
            : { category: 'default', icon: '📅', color: '#64748b' };

          events.push({
            id: generateId(),
            title: title,
            description: segment.trim(),
            startDate: startDate,
            endDate: endDate,
            location: location,
            category: categoryInfo.category,
            icon: categoryInfo.icon,
            color: categoryInfo.color,
            isAllDay: isAllDay,
            rawText: result.text,
            confidence: hasTime ? 'high' : 'medium'
          });
        }
      }
    }

    // ─── Strategy 2: Regex fallback (always run to catch what chrono misses) ───
    const regexResults = regexFindDates(text);
    console.log(`🔢 Regex found ${regexResults.length} additional date references`);

    for (const item of regexResults) {
      // Skip if chrono already found this date+context
      const isDuplicate = events.some(evt => {
        const sameDay = evt.startDate.toISOString().slice(0, 10) === item.date.toISOString().slice(0, 10);
        const similarTitle = evt.title.toLowerCase().includes(item.title.toLowerCase().slice(0, 10)) ||
          item.title.toLowerCase().includes(evt.title.toLowerCase().slice(0, 10));
        return sameDay && (similarTitle || !item.title);
      });

      if (!isDuplicate && item.title.length > 1) {
        const title = cleanTitle(item.title);
        const location = extractLocation(item.segment);

        const categoryInfo = Icons
          ? Icons.detectCategory(title, item.segment)
          : { category: 'default', icon: '📅', color: '#64748b' };

        const endDate = inferEndDate(item.date, item.hasTime);

        events.push({
          id: generateId(),
          title: title,
          description: item.segment.trim(),
          startDate: item.date,
          endDate: endDate,
          location: location,
          category: categoryInfo.category,
          icon: categoryInfo.icon,
          color: categoryInfo.color,
          isAllDay: !item.hasTime,
          rawText: item.dateText,
          confidence: item.hasTime ? 'medium' : 'low'
        });
      }
    }

    // Deduplicate and sort
    const uniqueEvents = deduplicateEvents(events);
    uniqueEvents.sort((a, b) => a.startDate - b.startDate);

    console.log(`✅ Found ${uniqueEvents.length} unique events`);

    return uniqueEvents;
  }

  // ─── Display Formatting ───────────────────────────────────

  function formatDateForDisplay(date, isAllDay) {
    if (!date) return '';

    const options = {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    };

    if (!isAllDay) {
      options.hour = '2-digit';
      options.minute = '2-digit';
    }

    return date.toLocaleDateString('en-US', options);
  }

  function formatDateRange(startDate, endDate, isAllDay) {
    if (!startDate) return '';

    const startStr = formatDateForDisplay(startDate, isAllDay);

    if (!endDate || isAllDay) return startStr;

    const sameDay = startDate.toDateString() === endDate.toDateString();
    if (sameDay) {
      const timeStr = endDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      });
      return `${startStr} – ${timeStr}`;
    }

    return `${startStr} – ${formatDateForDisplay(endDate, isAllDay)}`;
  }

  // ─── Export ───────────────────────────────────────────────

  window.CalScan.Parser = {
    parseEvents,
    formatDateForDisplay,
    formatDateRange
  };

})();

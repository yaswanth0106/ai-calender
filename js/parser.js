// parser.js — Event Extraction with chrono-node + Regex Fallback
// v3: Fixed title extraction, filters noise, uses multi-line context.

(function () {
  'use strict';

  window.CalScan = window.CalScan || {};

  // ─── Helpers ───────────────────────────────────────────────

  function generateId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  function cleanTitle(text) {
    if (!text) return '';

    let title = text
      .replace(/^[\s\-–—:,;.•·*#>|/\\()]+/, '')
      .replace(/[\s\-–—:,;.•·*#>|/\\()]+$/, '')
      .replace(/^---\s*Page\s*\d+\s*---$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    if (title.length < 2) return '';
    if (title.length > 100) title = title.substring(0, 97) + '...';

    return title;
  }

  /**
   * Check if text is just noise / not a real event title
   */
  function isNoise(text) {
    if (!text || text.trim().length < 2) return true;

    const lower = text.toLowerCase().trim();

    // Pure date/time strings aren't titles
    if (/^(\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4})$/.test(lower)) return true;
    if (/^(\d{1,2}:\d{2}\s*(am|pm)?)\s*$/i.test(lower)) return true;

    // Month + year only (like "May, 2026") — not a real event
    if (/^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?,?\s*\d{0,4}\s*$/i.test(lower)) return true;

    // Just numbers
    if (/^\d+$/.test(lower)) return true;

    // Just a day of week
    if (/^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\.?\s*$/i.test(lower)) return true;

    // Just "page X" or section markers
    if (/^page\s*\d+$/i.test(lower)) return true;

    // Too short after cleaning
    if (lower.replace(/[^a-z]/g, '').length < 2) return true;

    return false;
  }

  /**
   * Check if a date match is just a month/year header (not a specific event date)
   */
  function isMonthYearOnly(dateText) {
    const t = dateText.trim().toLowerCase();
    // "May 2026", "June, 2026", "Jan 2026" etc.
    return /^(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\.?,?\s+\d{4}$/i.test(t);
  }

  function extractLocation(text) {
    if (!text) return null;
    const patterns = [
      /(?:at|@)\s+([A-Z][A-Za-z0-9\s,.'&\-]{2,40})/,
      /(?:in|venue[:\s])\s+([A-Z][A-Za-z0-9\s,.'&\-]{2,40})/i,
      /(?:location|place|where)[:\s]+([^\n,]{3,40})/i,
      /(?:room|hall|bldg|building)\s+([A-Za-z0-9\s\-]{1,20})/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m && m[1]) return m[1].trim();
    }
    return null;
  }

  /**
   * Split text into lines, keeping track of line indices for context
   */
  function getLines(text) {
    return text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 0 && !/^---\s*Page\s*\d+\s*---$/i.test(l));
  }

  /**
   * Extract a meaningful title from a line after removing the date text.
   * If the remaining text is empty, look at surrounding lines for context.
   */
  function extractTitle(lines, lineIndex, dateText) {
    const currentLine = lines[lineIndex] || '';

    // Remove the date text from the current line
    let title = currentLine;
    if (dateText) {
      title = title.replace(dateText, '');
    }

    // Remove common connectors
    title = title
      .replace(/^[\s\-–—:,;.|]+/, '')
      .replace(/[\s\-–—:,;.|]+$/, '')
      .replace(/^(?:on|at|from|to|by|before|after|until|during|scheduled\s+for)\s+/i, '')
      .trim();

    title = cleanTitle(title);

    // If title is good, return it
    if (title && !isNoise(title) && title.length >= 3) {
      return title;
    }

    // Try to find context from the PREVIOUS line (often the title/heading)
    if (lineIndex > 0) {
      const prevLine = cleanTitle(lines[lineIndex - 1]);
      if (prevLine && !isNoise(prevLine) && prevLine.length >= 3) {
        return prevLine;
      }
    }

    // Try the NEXT line
    if (lineIndex < lines.length - 1) {
      const nextLine = cleanTitle(lines[lineIndex + 1]);
      if (nextLine && !isNoise(nextLine) && nextLine.length >= 3) {
        return nextLine;
      }
    }

    // Try 2 lines before
    if (lineIndex > 1) {
      const prev2 = cleanTitle(lines[lineIndex - 2]);
      if (prev2 && !isNoise(prev2) && prev2.length >= 3) {
        return prev2;
      }
    }

    // Last resort: use the full original line
    const fallback = cleanTitle(currentLine);
    if (fallback && fallback.length >= 3) return fallback;

    return '';
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

  function deduplicateEvents(events) {
    const seen = new Map();
    return events.filter(event => {
      const dateKey = event.startDate.toISOString().slice(0, 10);
      const titleKey = event.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 15);
      const key = `${dateKey}|${titleKey}`;
      if (seen.has(key)) return false;
      seen.set(key, true);
      return true;
    });
  }

  // ─── Regex-Based Date Finder ──────────────────────────────

  const DATE_PATTERNS = [
    // "January 15, 2026" or "Jan 15, 2026" or "January 15th, 2026"
    {
      regex: /((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/gi,
      parser: (m) => new Date(m.replace(/(\d+)(?:st|nd|rd|th)/i, '$1'))
    },
    // "15 January 2026" or "15th Jan 2026"
    {
      regex: /(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?,?\s+\d{4})/gi,
      parser: (m) => new Date(m.replace(/(\d+)(?:st|nd|rd|th)/i, '$1'))
    },
    // "2026-06-15" ISO format
    {
      regex: /(\d{4}-\d{1,2}-\d{1,2})/g,
      parser: (m) => new Date(m)
    },
    // "06/15/2026" US format (month/day/year)
    {
      regex: /(\d{1,2}\/\d{1,2}\/\d{4})/g,
      parser: (m) => {
        const p = m.split('/');
        return new Date(parseInt(p[2]), parseInt(p[0]) - 1, parseInt(p[1]));
      }
    },
    // "January 15" or "Jan 15" (no year — use current year, forward date)
    {
      regex: /((?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?)\b/gi,
      parser: (m) => {
        const d = new Date(m.replace(/(\d+)(?:st|nd|rd|th)/i, '$1') + ', ' + new Date().getFullYear());
        if (isNaN(d.getTime())) return null;
        // Don't forward-date too aggressively — keep within a year
        return d;
      }
    }
  ];

  const TIME_PATTERN = /(\d{1,2})[:\.](\d{2})\s*(am|pm|AM|PM)|(\d{1,2})\s*(am|pm|AM|PM)/;

  function regexFindDates(text, lines) {
    const found = [];

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];

      for (const pattern of DATE_PATTERNS) {
        const matches = [...line.matchAll(new RegExp(pattern.regex))];

        for (const match of matches) {
          try {
            // Skip month/year only headers
            if (isMonthYearOnly(match[1] || match[0])) continue;

            const date = pattern.parser(match[1] || match[0]);
            if (!date || isNaN(date.getTime())) continue;
            if (date.getFullYear() < 2000 || date.getFullYear() > 2100) continue;

            // Check the parsed date has a specific day (not just month)
            // Validate date is reasonable
            if (date.getDate() < 1 || date.getDate() > 31) continue;

            // Find time near the date
            const afterDate = line.slice(match.index + match[0].length, match.index + match[0].length + 40);
            const beforeDate = line.slice(Math.max(0, match.index - 40), match.index);
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

            // Extract title using context-aware extraction
            const title = extractTitle(lines, lineIdx, match[0]);

            // Skip if no meaningful title found
            if (!title || isNoise(title)) continue;

            found.push({
              date: date,
              dateText: match[0],
              title: title,
              line: line,
              lineIndex: lineIdx,
              hasTime: hasTime
            });
          } catch (e) {
            // Skip invalid
          }
        }
      }
    }

    // Remove duplicate dates from the same line
    const unique = [];
    const seenKeys = new Set();
    for (const item of found) {
      const key = item.date.toISOString().slice(0, 10) + '|' + item.lineIndex;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        unique.push(item);
      }
    }

    return unique;
  }

  // ─── Chrono-node Strategy ─────────────────────────────────

  function chronoParse(text, lines, refDate) {
    const events = [];
    const Icons = window.CalScan.Icons;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      if (line.length < 4) continue;

      let results;
      try {
        results = chrono.parse(line, refDate, { forwardDate: true });
      } catch (e) {
        continue;
      }

      for (const result of results) {
        // Skip month-only references
        if (isMonthYearOnly(result.text)) continue;

        // Must have at least a specific day
        if (!result.start.isCertain('day') && !result.start.isCertain('month')) continue;

        const startDate = result.start.date();
        const hasTime = result.start.isCertain('hour') || result.start.isCertain('minute');
        const isAllDay = !hasTime;

        let endDate = result.end ? result.end.date() : inferEndDate(startDate, hasTime);

        // Extract title with context awareness
        const title = extractTitle(lines, lineIdx, result.text);

        // Skip if no meaningful title
        if (!title || isNoise(title)) continue;

        const location = extractLocation(line);

        const categoryInfo = Icons
          ? Icons.detectCategory(title, line)
          : { category: 'default', icon: '📅', color: '#64748b' };

        events.push({
          id: generateId(),
          title: title,
          description: line.trim(),
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

    return events;
  }

  // ─── Main Parser ──────────────────────────────────────────

  function parseEvents(text, referenceDate) {
    if (!text || text.trim().length === 0) return [];

    const refDate = referenceDate || new Date();
    const lines = getLines(text);
    const Icons = window.CalScan.Icons;
    let events = [];

    const chronoAvailable = typeof chrono !== 'undefined' && chrono && typeof chrono.parse === 'function';
    console.log(`🔍 Parsing: ${text.length} chars, ${lines.length} lines, chrono: ${chronoAvailable}`);

    // Strategy 1: chrono-node
    if (chronoAvailable) {
      events = chronoParse(text, lines, refDate);
      console.log(`📅 chrono found ${events.length} events`);
    }

    // Strategy 2: Regex (catches what chrono misses)
    const regexResults = regexFindDates(text, lines);
    console.log(`🔢 regex found ${regexResults.length} date references`);

    for (const item of regexResults) {
      // Check for duplicates with chrono results
      const isDup = events.some(evt => {
        const sameDay = evt.startDate.toISOString().slice(0, 10) === item.date.toISOString().slice(0, 10);
        const sameLine = evt.description === item.line;
        const simTitle = evt.title.toLowerCase().slice(0, 12) === item.title.toLowerCase().slice(0, 12);
        return sameDay && (sameLine || simTitle);
      });

      if (!isDup) {
        const location = extractLocation(item.line);
        const categoryInfo = Icons
          ? Icons.detectCategory(item.title, item.line)
          : { category: 'default', icon: '📅', color: '#64748b' };

        const endDate = inferEndDate(item.date, item.hasTime);

        events.push({
          id: generateId(),
          title: item.title,
          description: item.line.trim(),
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

    // Final filtering: remove events with no real title
    events = events.filter(e => e.title && e.title.length >= 2 && !isNoise(e.title));

    // Deduplicate and sort
    events = deduplicateEvents(events);
    events.sort((a, b) => a.startDate - b.startDate);

    console.log(`✅ Final: ${events.length} events`);
    return events;
  }

  // ─── Display Formatting ───────────────────────────────────

  function formatDateForDisplay(date, isAllDay) {
    if (!date) return '';
    const options = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
    if (!isAllDay) { options.hour = '2-digit'; options.minute = '2-digit'; }
    return date.toLocaleDateString('en-US', options);
  }

  function formatDateRange(startDate, endDate, isAllDay) {
    if (!startDate) return '';
    const startStr = formatDateForDisplay(startDate, isAllDay);
    if (!endDate || isAllDay) return startStr;
    const sameDay = startDate.toDateString() === endDate.toDateString();
    if (sameDay) {
      return `${startStr} – ${endDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    }
    return `${startStr} – ${formatDateForDisplay(endDate, isAllDay)}`;
  }

  // ─── Export ───────────────────────────────────────────────

  window.CalScan.Parser = { parseEvents, formatDateForDisplay, formatDateRange };

})();

// icons.js — Event Category Detection & Icon Mapping

(function () {
  'use strict';

  window.CalScan = window.CalScan || {};

  const CATEGORIES = {
    meeting: {
      keywords: ['meeting', 'call', 'conference', 'standup', 'sync', 'zoom', 'teams', 'huddle', '1:1', 'one-on-one', 'catch-up', 'catchup', 'briefing'],
      icon: '🤝',
      color: '#6366f1',
      label: 'Meeting'
    },
    birthday: {
      keywords: ['birthday', 'bday', 'born', 'anniversary', 'b-day', 'turning'],
      icon: '🎂',
      color: '#ec4899',
      label: 'Birthday'
    },
    travel: {
      keywords: ['flight', 'travel', 'trip', 'airport', 'hotel', 'departure', 'arrival', 'boarding', 'itinerary', 'checkin', 'check-in', 'checkout', 'check-out', 'airbnb', 'booking'],
      icon: '✈️',
      color: '#06b6d4',
      label: 'Travel'
    },
    deadline: {
      keywords: ['deadline', 'due', 'submit', 'assignment', 'deliverable', 'cutoff', 'cut-off', 'final', 'expiry', 'expires', 'expiration', 'last day'],
      icon: '⏰',
      color: '#ef4444',
      label: 'Deadline'
    },
    celebration: {
      keywords: ['party', 'celebration', 'festival', 'wedding', 'ceremony', 'gala', 'reception', 'prom', 'homecoming', 'reunion', 'get-together'],
      icon: '🎉',
      color: '#f59e0b',
      label: 'Celebration'
    },
    medical: {
      keywords: ['doctor', 'hospital', 'dental', 'checkup', 'check-up', 'health', 'therapy', 'clinic', 'physician', 'surgeon', 'dr.', 'medical', 'vaccine', 'vaccination', 'appointment'],
      icon: '🏥',
      color: '#10b981',
      label: 'Medical'
    },
    education: {
      keywords: ['class', 'lecture', 'exam', 'school', 'university', 'seminar', 'workshop', 'training', 'course', 'tutorial', 'quiz', 'test', 'orientation', 'commencement', 'graduation'],
      icon: '📚',
      color: '#8b5cf6',
      label: 'Education'
    },
    sports: {
      keywords: ['gym', 'workout', 'game', 'match', 'practice', 'fitness', 'run', 'race', 'marathon', 'yoga', 'swim', 'hike', 'tournament', 'championship'],
      icon: '🏋️',
      color: '#14b8a6',
      label: 'Sports'
    },
    dining: {
      keywords: ['dinner', 'lunch', 'brunch', 'restaurant', 'reservation', 'cafe', 'breakfast', 'supper', 'bistro', 'bar', 'happy hour'],
      icon: '🍽️',
      color: '#f97316',
      label: 'Dining'
    },
    work: {
      keywords: ['work', 'office', 'project', 'presentation', 'review', 'sprint', 'demo', 'retrospective', 'retro', 'kickoff', 'kick-off', 'launch', 'release'],
      icon: '💼',
      color: '#3b82f6',
      label: 'Work'
    },
    payment: {
      keywords: ['payment', 'bill', 'rent', 'invoice', 'salary', 'tax', 'subscription', 'fee', 'insurance', 'premium', 'installment', 'mortgage', 'payroll'],
      icon: '💰',
      color: '#22c55e',
      label: 'Payment'
    },
    default: {
      keywords: [],
      icon: '📅',
      color: '#64748b',
      label: 'Event'
    }
  };

  /**
   * Detect the event category based on title and description text.
   * @param {string} title - Event title
   * @param {string} [description=''] - Event description
   * @returns {{ category: string, icon: string, color: string, label: string }}
   */
  function detectCategory(title, description) {
    const text = ((title || '') + ' ' + (description || '')).toLowerCase();

    for (const [key, cat] of Object.entries(CATEGORIES)) {
      if (key === 'default') continue;

      for (const keyword of cat.keywords) {
        // Word boundary check — match whole words or compound words
        const regex = new RegExp('(?:^|[\\s,;.!?\\-\\/\\(])' + escapeRegex(keyword) + '(?:[\\s,;.!?\\-\\/\\)]|$)', 'i');
        if (regex.test(' ' + text + ' ')) {
          return {
            category: key,
            icon: cat.icon,
            color: cat.color,
            label: cat.label
          };
        }
      }
    }

    return {
      category: 'default',
      icon: CATEGORIES.default.icon,
      color: CATEGORIES.default.color,
      label: CATEGORIES.default.label
    };
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getCategoryIcon(category) {
    return (CATEGORIES[category] || CATEGORIES.default).icon;
  }

  function getCategoryColor(category) {
    return (CATEGORIES[category] || CATEGORIES.default).color;
  }

  function getCategoryLabel(category) {
    return (CATEGORIES[category] || CATEGORIES.default).label;
  }

  function getAllCategories() {
    return Object.entries(CATEGORIES).map(([key, val]) => ({
      category: key,
      icon: val.icon,
      color: val.color,
      label: val.label,
      keywords: val.keywords
    }));
  }

  // ─── Export ─────────────────────────────────────────────
  window.CalScan.Icons = {
    detectCategory,
    getCategoryIcon,
    getCategoryColor,
    getCategoryLabel,
    getAllCategories
  };

})();

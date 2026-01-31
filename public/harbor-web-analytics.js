/**
 * Harbor Web Analytics - Privacy-First Analytics for Harbor Scale
 * Version: 1.0.0
 */

(function() {
  'use strict';

  // ============================================
  // CONFIGURATION EXTRACTION
  // ============================================
  
  const script = document.currentScript || document.querySelector('script[src*="harbor-track"]');
  if (!script) {
    console.error('[HarborTrack] Could not find script tag. Tracking disabled.');
    return;
  }

  const scriptSrc = script.src;
  const url = new URL(scriptSrc);
  
  const CONFIG = {
    harborId: url.searchParams.get('h') || script.getAttribute('data-harbor-id'),
    apiKey: url.searchParams.get('k') || script.getAttribute('data-api-key'),
    endpoint: url.searchParams.get('e') || script.getAttribute('data-endpoint') || 'https://harborscale.com/api/v2',
    debug: url.searchParams.get('debug') === 'true' || script.hasAttribute('data-debug'),
    
    // Privacy settings
    respectDNT: url.searchParams.get('dnt') !== 'false', // Default: respect Do Not Track
    hashIPs: url.searchParams.get('hash-ip') !== 'false', // Default: hash IPs for privacy
    
    // Features (can be disabled)
    autoPageviews: url.searchParams.get('auto-pageviews') !== 'false',
    trackClicks: url.searchParams.get('track-clicks') !== 'false',
    trackErrors: url.searchParams.get('track-errors') !== 'false',
    trackPerformance: url.searchParams.get('track-perf') !== 'false',
  };

  // Validation
  if (!CONFIG.harborId || !CONFIG.apiKey) {
    console.error('[HarborTrack] Missing required parameters: h (harbor ID) and k (API key)');
    return;
  }

  // Respect Do Not Track
  if (CONFIG.respectDNT && (navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes')) {
    console.info('[HarborTrack] Do Not Track enabled. Tracking disabled.');
    return;
  }

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================

  /**
   * Simple hash function for privacy (FNV-1a)
   */
  function simpleHash(str) {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36);
  }

  /**
   * Generate a session ID (stored in sessionStorage)
   */
  function getSessionId() {
    const key = '_ht_sid';
    let sid = sessionStorage.getItem(key);
    if (!sid) {
      sid = simpleHash(Date.now() + Math.random().toString());
      sessionStorage.setItem(key, sid);
    }
    return sid;
  }

  /**
   * Get a privacy-safe user identifier
   * Uses: session ID + hashed user agent (no IPs, no cookies)
   */
  function getShipId() {
    const session = getSessionId();
    const ua = CONFIG.hashIPs ? simpleHash(navigator.userAgent) : navigator.userAgent.slice(0, 50);
    return `${session}_${ua}`;
  }

  /**
   * Log debug messages
   */
  function debug(...args) {
    if (CONFIG.debug) {
      console.log('[HarborTrack]', ...args);
    }
  }

  /**
   * Debounce function to prevent spam
   */
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // ============================================
  // CORE TRACKING FUNCTION
  // ============================================

  /**
   * Send event to Harbor Scale
   * @param {string} eventName - The cargo_id (event type)
   * @param {number} value - Numeric value (default: 1)
   * @param {object} metadata - Additional data (stored in memory, not sent)
   */
  function track(eventName, value = 1, metadata = {}) {
    // Input validation
    if (!eventName || typeof eventName !== 'string') {
      console.warn('[HarborTrack] Invalid event name:', eventName);
      return;
    }

    // Prepare payload matching your SensorData model
    const payload = {
      time: new Date().toISOString(),
      ship_id: getShipId(),
      cargo_id: eventName,
      value: typeof value === 'number' ? value : 1
    };

    debug('Tracking event:', eventName, 'Value:', value, 'Metadata:', metadata);

    // Send via Beacon API (survives page unload) with fallback to fetch
    const url = `${CONFIG.endpoint}/ingest/${CONFIG.harborId}`;
    const headers = {
      'Content-Type': 'application/json',
      'X-API-Key': CONFIG.apiKey
    };
    const body = JSON.stringify(payload);

    // Try Beacon API first (better for page unload events)
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      const sent = navigator.sendBeacon(url, blob);
      
      if (sent) {
        debug('Event sent via Beacon API');
        return;
      }
    }

    // Fallback to fetch
    fetch(url, {
      method: 'POST',
      headers: headers,
      body: body,
      keepalive: true // Important for unload events
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      debug('Event sent via Fetch API');
    })
    .catch(error => {
      console.error('[HarborTrack] Failed to send event:', error);
    });
  }

  // ============================================
  // AUTO-TRACKING FEATURES
  // ============================================

  /**
   * Track page views automatically
   */
  if (CONFIG.autoPageviews) {
    // Initial page view
    track('pageview', 1, {
      path: window.location.pathname,
      referrer: document.referrer
    });

    // Track SPA navigation (History API)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function(...args) {
      originalPushState.apply(this, args);
      track('pageview', 1, { path: window.location.pathname });
    };

    history.replaceState = function(...args) {
      originalReplaceState.apply(this, args);
      track('pageview', 1, { path: window.location.pathname });
    };

    window.addEventListener('popstate', () => {
      track('pageview', 1, { path: window.location.pathname });
    });
  }

  /**
   * Track clicks on elements with data-track attribute
   */
  if (CONFIG.trackClicks) {
    document.addEventListener('click', (e) => {
      const element = e.target.closest('[data-track]');
      if (!element) return;

      const eventName = element.getAttribute('data-track');
      const value = parseFloat(element.getAttribute('data-track-value')) || 1;

      track(`click_${eventName}`, value, {
        text: element.textContent.trim().slice(0, 50),
        tag: element.tagName
      });
    }, true);

    // Track external links
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;

      try {
        const url = new URL(link.href, window.location.href);
        if (url.hostname !== window.location.hostname) {
          track('outbound_link', 1, {
            url: url.hostname
          });
        }
      } catch (err) {
        // Invalid URL, ignore
      }
    }, true);
  }

  /**
   * Track JavaScript errors
   */
  if (CONFIG.trackErrors) {
    window.addEventListener('error', (event) => {
      track('js_error', 1, {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno
      });
    });

    // Track unhandled promise rejections
    window.addEventListener('unhandledrejection', (event) => {
      track('promise_rejection', 1, {
        reason: event.reason?.message || String(event.reason)
      });
    });
  }

  /**
   * Track basic performance metrics
   */
  if (CONFIG.trackPerformance) {
    window.addEventListener('load', () => {
      // Wait for performance data to be available
      setTimeout(() => {
        if (!window.performance || !window.performance.timing) return;

        const timing = window.performance.timing;
        const loadTime = timing.loadEventEnd - timing.navigationStart;
        const domReady = timing.domContentLoadedEventEnd - timing.navigationStart;
        const ttfb = timing.responseStart - timing.navigationStart;

        if (loadTime > 0) track('page_load_time', loadTime);
        if (domReady > 0) track('dom_ready_time', domReady);
        if (ttfb > 0) track('time_to_first_byte', ttfb);

        // Core Web Vitals (if available)
        if (window.PerformanceObserver) {
          // Largest Contentful Paint (LCP)
          try {
            const lcpObserver = new PerformanceObserver((list) => {
              const entries = list.getEntries();
              const lastEntry = entries[entries.length - 1];
              track('lcp', Math.round(lastEntry.renderTime || lastEntry.loadTime));
              lcpObserver.disconnect();
            });
            lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
          } catch (e) {}

          // First Input Delay (FID)
          try {
            const fidObserver = new PerformanceObserver((list) => {
              const entries = list.getEntries();
              entries.forEach((entry) => {
                track('fid', Math.round(entry.processingStart - entry.startTime));
              });
              fidObserver.disconnect();
            });
            fidObserver.observe({ entryTypes: ['first-input'] });
          } catch (e) {}

          // Cumulative Layout Shift (CLS)
          try {
            let clsValue = 0;
            const clsObserver = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (!entry.hadRecentInput) {
                  clsValue += entry.value;
                }
              }
            });
            clsObserver.observe({ entryTypes: ['layout-shift'] });

            // Report CLS on page hide
            document.addEventListener('visibilitychange', () => {
              if (document.visibilityState === 'hidden') {
                track('cls', Math.round(clsValue * 1000));
                clsObserver.disconnect();
              }
            });
          } catch (e) {}
        }
      }, 0);
    });
  }

  // ============================================
  // ADVANCED TRACKING HELPERS
  // ============================================

  /**
   * Track scroll depth (25%, 50%, 75%, 100%)
   */
  function trackScrollDepth() {
    const milestones = [25, 50, 75, 100];
    const reached = new Set();

    const checkScroll = debounce(() => {
      const scrollPercent = Math.round(
        (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100
      );

      milestones.forEach(milestone => {
        if (scrollPercent >= milestone && !reached.has(milestone)) {
          reached.add(milestone);
          track('scroll_depth', milestone, {
            page: window.location.pathname
          });
        }
      });
    }, 500);

    window.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);
  }

  /**
   * Track time on page (sends when user leaves)
   */
  function trackTimeOnPage() {
    const startTime = Date.now();
    let isActive = true;
    let totalActiveTime = 0;
    let lastActiveTime = startTime;

    // Track when user becomes inactive
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (isActive) {
          totalActiveTime += Date.now() - lastActiveTime;
          isActive = false;
        }
      } else {
        isActive = true;
        lastActiveTime = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Send data when user leaves
    window.addEventListener('beforeunload', () => {
      if (isActive) {
        totalActiveTime += Date.now() - lastActiveTime;
      }
      const timeOnPage = Math.round(totalActiveTime / 1000); // Convert to seconds
      track('time_on_page', timeOnPage, {
        page: window.location.pathname
      });
    });
  }

  /**
   * Track form interactions
   */
  function trackForm(formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) return;

    const formId = form.id || 'unnamed_form';
    const fieldsInteracted = new Set();

    // Track field interactions
    form.querySelectorAll('input, textarea, select').forEach(field => {
      field.addEventListener('focus', () => {
        const fieldName = field.name || field.id || 'unnamed_field';
        if (!fieldsInteracted.has(fieldName)) {
          fieldsInteracted.add(fieldName);
          track('form_field_focus', 1, {
            form: formId,
            field: fieldName
          });
        }
      });

      field.addEventListener('blur', () => {
        if (field.value) {
          track('form_field_filled', 1, {
            form: formId,
            field: field.name || field.id || 'unnamed_field'
          });
        }
      });
    });

    // Track submission
    form.addEventListener('submit', () => {
      track('form_submit', 1, {
        form: formId,
        fields_count: fieldsInteracted.size
      });
    });

    // Track abandonment (user leaves without submitting)
    let formSubmitted = false;
    form.addEventListener('submit', () => { formSubmitted = true; });

    window.addEventListener('beforeunload', () => {
      if (fieldsInteracted.size > 0 && !formSubmitted) {
        track('form_abandoned', fieldsInteracted.size, {
          form: formId
        });
      }
    });
  }

  // ============================================
  // PUBLIC API
  // ============================================

  window.harbor = {
    track: track,
    trackScrollDepth: trackScrollDepth,
    trackTimeOnPage: trackTimeOnPage,
    trackForm: trackForm,
    
    // Utility to manually trigger pageview (for SPAs)
    pageview: function(path) {
      track('pageview', 1, { path: path || window.location.pathname });
    },
    
    // Expose config for debugging
    getConfig: function() {
      return { ...CONFIG, apiKey: '***hidden***' };
    }
  };

  debug('Harbor Track initialized', window.harbor.getConfig());

  // ============================================
  // OPTIONAL AUTO-INIT FEATURES
  // ============================================

  // Auto-enable scroll tracking if data-track-scroll is present
  if (script.hasAttribute('data-track-scroll')) {
    trackScrollDepth();
  }

  // Auto-enable time tracking if data-track-time is present
  if (script.hasAttribute('data-track-time')) {
    trackTimeOnPage();
  }

})();

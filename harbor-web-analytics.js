/**
 * Harbor Web Analytics - Privacy-First Analytics for Harbor Scale
 * Version: 2.1.0 - 
 */

(function() {
  'use strict';

  // ============================================
  // 1. CONFIGURATION
  // ============================================
  const script = document.currentScript || document.querySelector('script[src*="harbor-track"]');
  if (!script) return;

  const url = new URL(script.src);
  const CONFIG = {
    harborId: url.searchParams.get('h') || script.getAttribute('data-harbor-id'),
    apiKey: url.searchParams.get('k') || script.getAttribute('data-api-key'),
    endpoint: url.searchParams.get('e') || script.getAttribute('data-endpoint') || 'https://harborscale.com/api/v2',
    debug: url.searchParams.get('debug') === 'true',
    
    // Feature Flags (Enable/Disable modules)
    trackForms: url.searchParams.get('track-forms') !== 'false',
    trackErrors: url.searchParams.get('track-errors') !== 'false',
    trackScroll: url.searchParams.get('track-scroll') !== 'false',
    trackClicks: url.searchParams.get('track-clicks') !== 'false',
    trackPerf: url.searchParams.get('track-perf') !== 'false',
    trackMouse: url.searchParams.get('track-mouse') !== 'false',
    trackMedia: url.searchParams.get('track-media') !== 'false',
    trackVisibility: url.searchParams.get('track-visibility') !== 'false',
    
    batchSize: parseInt(url.searchParams.get('batch-size')) || 100,
    batchInterval: parseInt(url.searchParams.get('batch-interval')) || 5000,
  };

  if (!CONFIG.harborId || !CONFIG.apiKey) {
    console.error('[Harbor] Missing API Key or Harbor ID');
    return;
  }

  if (navigator.doNotTrack === '1') return;

  // ============================================
  // 2. ENHANCED VISITOR IDENTITY
  // ============================================
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(36);
  }

  function getVisitorId() {
    try {
      const sessionKey = '_ht_sid';
      let sid = sessionStorage.getItem(sessionKey);
      if (!sid) {
        sid = hash(Date.now() + Math.random().toString());
        sessionStorage.setItem(sessionKey, sid);
      }
      // Enhanced fingerprint
      const traits = [
        navigator.language || '',
        new Date().getTimezoneOffset(),
        window.screen.width + 'x' + window.screen.height,
        window.screen.colorDepth,
        navigator.hardwareConcurrency || 1,
        navigator.deviceMemory || 1,
        navigator.platform || '',
        !!window.indexedDB,
        !!window.sessionStorage,
        navigator.maxTouchPoints || 0
      ].join('|');
      return `${sid}_${hash(traits)}`;
    } catch (e) {
      return 'unknown_visitor';
    }
  }

  // ============================================
  // 3. BATCHED STREAMING ENGINE (Schema Compliant)
  // ============================================
  const QUEUE = [];
  let batchTimer = null;
  const SESSION_START = Date.now();

  /**
   * Track an event - engineered to match cargo_data schema
   * @param {string} cargoId - Event name (can include metadata via naming convention)
   * @param {number} value - Numeric value only
   * @param {string} shipIdSuffix - Optional suffix to add context to ship_id
   */
  function track(cargoId, value = 1, shipIdSuffix = '') {
    // Ensure value is strictly a number
    const numericValue = typeof value === 'number' ? value : parseFloat(value) || 0;
    
    const payload = {
      ship_id: shipIdSuffix ? `${getVisitorId()}_${shipIdSuffix}` : getVisitorId(),
      cargo_id: cargoId,
      value: numericValue
    };

    QUEUE.push(payload);
    if (CONFIG.debug) console.log(`[Harbor] Queued (${QUEUE.length}):`, payload);
    
    // Auto-flush when batch size reached
    if (QUEUE.length >= CONFIG.batchSize) {
      flushBatch();
    } else if (!batchTimer) {
      batchTimer = setTimeout(flushBatch, CONFIG.batchInterval);
    }
  }

  function flushBatch() {
    if (QUEUE.length === 0) return;
    
    clearTimeout(batchTimer);
    batchTimer = null;
    
    const batch = QUEUE.splice(0, CONFIG.batchSize);
    
    fetch(`${CONFIG.endpoint}/ingest/${CONFIG.harborId}/batch`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'X-API-Key': CONFIG.apiKey
      },
      body: JSON.stringify(batch),
      keepalive: true
    })
    .then(() => {
      if (CONFIG.debug) console.log(`[Harbor] Flushed ${batch.length} events`);
    })
    .catch(err => {
      if (CONFIG.debug) console.error('[Harbor] Flush failed:', err);
      QUEUE.unshift(...batch); // Re-queue on failure
    });
    
    // Continue processing if more events
    if (QUEUE.length > 0) {
      batchTimer = setTimeout(flushBatch, CONFIG.batchInterval);
    }
  }

  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    if (QUEUE.length > 0) {
      navigator.sendBeacon(
        `${CONFIG.endpoint}/ingest/${CONFIG.harborId}?k=${CONFIG.apiKey}`,
        JSON.stringify(QUEUE)
      );
    }
  });

  // ============================================
  // 4. DEVICE & ENVIRONMENT CONTEXT (As Metrics)
  // ============================================
  function trackDeviceContext() {
    track('device.viewport_width', window.innerWidth);
    track('device.viewport_height', window.innerHeight);
    track('device.screen_width', window.screen.width);
    track('device.screen_height', window.screen.height);
    track('device.pixel_ratio', Math.round((window.devicePixelRatio || 1) * 100));
    track('device.touch_points', navigator.maxTouchPoints || 0);
    track('device.memory_gb', navigator.deviceMemory || 0);
    track('device.cpu_cores', navigator.hardwareConcurrency || 0);
    
    // Connection info
    const conn = navigator.connection;
    if (conn) {
      track('connection.rtt_ms', conn.rtt || 0);
      track('connection.downlink_mbps', Math.round((conn.downlink || 0) * 100));
      track('connection.save_data', conn.saveData ? 1 : 0);
    }
  }

  // Enrich with battery status (async)
  if (navigator.getBattery) {
    navigator.getBattery().then(battery => {
      track('device.battery_level', Math.round(battery.level * 100));
      track('device.battery_charging', battery.charging ? 1 : 0);
    });
  }

  // Track initial device context
  track('session.start', 1);
  trackDeviceContext();

  // ============================================
  // 5. DEEP TRACKING MODULES (Schema Compliant)
  // ============================================

  // A. PAGEVIEWS (SPA Aware + Timing)
  let pageLoadTime = Date.now();
  const logPage = () => {
    const timeOnPreviousPage = Date.now() - pageLoadTime;
    pageLoadTime = Date.now();
    
    const pathname = window.location.pathname;
    const hasQuery = window.location.search ? 1 : 0;
    const hasHash = window.location.hash ? 1 : 0;
    
    // Use pathname in ship_id for page-specific tracking
    track('pageview', 1, pathname);
    track('pageview.has_query', hasQuery, pathname);
    track('pageview.has_hash', hasHash, pathname);
    
    if (timeOnPreviousPage > 100) {
      track('page.time_on_page_sec', Math.round(timeOnPreviousPage / 1000), pathname);
    }
  };
  
  logPage();
  const pushState = history.pushState;
  history.pushState = function(...args) {
    pushState.apply(this, args);
    logPage();
  };
  window.addEventListener('popstate', logPage);

  // B. ENHANCED FORM TRACKING
  if (CONFIG.trackForms) {
    const formStates = new Map();
    
    document.addEventListener('focus', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        const form = e.target.form;
        const formId = form ? (form.id || form.name || 'form_' + hash(form.outerHTML.slice(0, 100))) : 'no_form';
        const fieldType = e.target.type || e.target.tagName.toLowerCase();
        
        if (!formStates.has(formId)) {
          formStates.set(formId, {
            started_at: Date.now(),
            fields_focused: new Set(),
            fields_changed: new Set(),
            field_count: form ? form.elements.length : 0
          });
        }
        
        const state = formStates.get(formId);
        const fieldName = e.target.name || e.target.id || 'unknown';
        state.fields_focused.add(fieldName);
        
        const timeInForm = Math.round((Date.now() - state.started_at) / 1000);
        track(`form.focus.${fieldType}`, timeInForm, formId);
        track('form.fields_focused_count', state.fields_focused.size, formId);
      }
    }, true);

    document.addEventListener('change', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        const form = e.target.form;
        const formId = form ? (form.id || form.name || 'form_' + hash(form.outerHTML.slice(0, 100))) : 'no_form';
        const fieldType = e.target.type || e.target.tagName.toLowerCase();
        const valueLength = e.target.value ? e.target.value.length : 0;
        
        if (formStates.has(formId)) {
          formStates.get(formId).fields_changed.add(e.target.name || e.target.id || 'unknown');
        }
        
        track(`form.change.${fieldType}`, valueLength, formId);
      }
    }, true);
    
    document.addEventListener('submit', (e) => {
      const formId = e.target.id || e.target.name || 'form_' + hash(e.target.outerHTML.slice(0, 100));
      const state = formStates.get(formId);
      
      if (state) {
        const timeToSubmit = Math.round((Date.now() - state.started_at) / 1000);
        const completionRate = Math.round((state.fields_changed.size / state.field_count) * 100);
        
        track('form.submit', timeToSubmit, formId);
        track('form.completion_rate', completionRate, formId);
        track('form.fields_changed', state.fields_changed.size, formId);
        
        formStates.delete(formId);
      } else {
        track('form.submit', 0, formId);
      }
    });
    
    // Form abandonment tracking
    setInterval(() => {
      formStates.forEach((state, formId) => {
        const timeInForm = (Date.now() - state.started_at) / 1000;
        if (timeInForm > 30 && state.fields_changed.size > 0) {
          track('form.abandonment_risk', Math.round(timeInForm), formId);
        }
      });
    }, 30000);
  }

  // C. ENHANCED ERROR TRACKING
  if (CONFIG.trackErrors) {
    const errorCounts = new Map();
    
    window.addEventListener('error', (e) => {
      const errorKey = `${e.message}_${e.filename}_${e.lineno}`;
      const count = (errorCounts.get(errorKey) || 0) + 1;
      errorCounts.set(errorKey, count);
      
      const errorId = hash(errorKey);
      track('error.js', count, errorId);
      track('error.line', e.lineno || 0, errorId);
      track('error.col', e.colno || 0, errorId);
    });
    
    window.addEventListener('unhandledrejection', (e) => {
      const reasonHash = hash(e.reason ? e.reason.toString() : 'unknown');
      track('error.promise', 1, reasonHash);
    });
    
    // Console error tracking (non-intrusive)
    const originalError = console.error;
    console.error = function(...args) {
      const msgHash = hash(args.join(' ').slice(0, 100));
      track('error.console', 1, msgHash);
      originalError.apply(console, args);
    };
  }

  // D. ENHANCED CLICK TRACKING
  if (CONFIG.trackClicks) {
    let clicks = [];
    const clickedElements = new Set();
    
    document.addEventListener('click', (e) => {
      const now = Date.now();
      const el = e.target.closest('button, a, [data-track], input, div, span');
      
      // 1. Enhanced general tracking
      if (el) {
        const elementType = el.tagName.toLowerCase();
        const elementId = el.id || el.className || el.tagName;
        const elementKey = `${elementId}_${el.textContent?.slice(0, 20)}`;
        clickedElements.add(elementKey);
        
        const clickX = Math.round((e.clientX / window.innerWidth) * 100);
        const clickY = Math.round((e.clientY / window.innerHeight) * 100);
        
        track(`click.${elementType}`, clickX, elementId);
        track('click.viewport_y', clickY, elementId);
        track('click.is_link', el.tagName === 'A' ? 1 : 0, elementId);
        track('click.is_button', (el.tagName === 'BUTTON' || el.type === 'button') ? 1 : 0, elementId);
      }

      // 2. Rage Click Detection (3 clicks in 1s)
      clicks.push({ x: e.clientX, y: e.clientY, t: now });
      clicks = clicks.filter(c => now - c.t < 1000);
      
      if (clicks.length >= 3) {
        const isRage = clicks.every(c => 
          Math.abs(c.x - clicks[0].x) < 20 && Math.abs(c.y - clicks[0].y) < 20
        );
        if (isRage) {
          const tag = e.target.tagName.toLowerCase();
          track('click.rage', clicks.length, tag);
          clicks = [];
        }
      }
      
      // 3. Dead Click Detection
      const style = window.getComputedStyle(e.target);
      if (style.cursor === 'pointer' && !e.target.href && !e.target.onclick && 
          e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        const tag = e.target.tagName.toLowerCase();
        track('click.dead', 1, tag);
      }
    }, true);
    
    // Click coverage tracking
    setInterval(() => {
      track('click.coverage', clickedElements.size);
    }, 60000);
  }

  // E. ENHANCED SCROLL TRACKING
  if (CONFIG.trackScroll) {
    const marks = [10, 25, 50, 75, 90, 100];
    const reached = new Set();
    let scrollTimer;
    let maxScroll = 0;
    let scrollCount = 0;
    let lastScrollTime = Date.now();
    
    window.addEventListener('scroll', () => {
      scrollCount++;
      const timeSinceLastScroll = Date.now() - lastScrollTime;
      lastScrollTime = Date.now();
      
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const scrollTop = window.scrollY;
        const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
        const pct = Math.round((scrollTop / scrollHeight) * 100);
        
        maxScroll = Math.max(maxScroll, pct);
        
        marks.forEach(m => {
          if (pct >= m && !reached.has(m)) {
            reached.add(m);
            const timeToMilestone = Math.round((Date.now() - pageLoadTime) / 1000);
            track(`scroll.milestone_${m}`, timeToMilestone);
            track('scroll.count_at_milestone', scrollCount, `milestone_${m}`);
          }
        });
        
        // Scroll depth heartbeat
        if (scrollCount % 20 === 0) {
          track('scroll.depth', maxScroll);
          track('scroll.count', scrollCount);
        }
      }, 200);
    });
    
    // Report final scroll depth on page leave
    window.addEventListener('beforeunload', () => {
      track('scroll.final_depth', maxScroll);
    });
  }

  // F. ENHANCED PERFORMANCE (Web Vitals + More)
  if (CONFIG.trackPerf && window.PerformanceObserver) {
    const observe = (type, cb) => {
      try { 
        new PerformanceObserver(l => l.getEntries().forEach(cb)).observe({entryTypes:[type], buffered: true}); 
      } catch(e){}
    };
    
    observe('largest-contentful-paint', e => {
      track('perf.lcp_ms', Math.round(e.renderTime || e.loadTime));
    });
    
    observe('first-input', e => {
      track('perf.fid_ms', Math.round(e.processingStart - e.startTime));
    });
    
    observe('layout-shift', e => { 
      if (!e.hadRecentInput) {
        track('perf.cls_x1000', Math.round(e.value * 1000));
      }
    });
    
    // Navigation Timing
    window.addEventListener('load', () => {
      setTimeout(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) {
          track('perf.load_complete_ms', Math.round(nav.loadEventEnd));
          track('perf.dns_ms', Math.round(nav.domainLookupEnd - nav.domainLookupStart));
          track('perf.tcp_ms', Math.round(nav.connectEnd - nav.connectStart));
          track('perf.ttfb_ms', Math.round(nav.responseStart - nav.requestStart));
          track('perf.download_ms', Math.round(nav.responseEnd - nav.responseStart));
          track('perf.dom_parse_ms', Math.round(nav.domContentLoadedEventEnd - nav.responseEnd));
          track('perf.dom_interactive_ms', Math.round(nav.domInteractive - nav.fetchStart));
        }
        
        // Resource timing summary
        const resources = performance.getEntriesByType('resource');
        const byType = {};
        resources.forEach(r => {
          const type = r.initiatorType;
          if (!byType[type]) byType[type] = { count: 0, size: 0, duration: 0 };
          byType[type].count++;
          byType[type].size += r.transferSize || 0;
          byType[type].duration += r.duration;
        });
        
        Object.keys(byType).forEach(type => {
          track(`resource.${type}.count`, byType[type].count);
          track(`resource.${type}.size_kb`, Math.round(byType[type].size / 1024));
          track(`resource.${type}.avg_duration_ms`, Math.round(byType[type].duration / byType[type].count));
        });
      }, 0);
    });
    
    // Long Tasks (> 50ms)
    observe('longtask', e => {
      track('perf.long_task_ms', Math.round(e.duration));
    });
  }

  // G. MOUSE MOVEMENT & ENGAGEMENT
  if (CONFIG.trackMouse) {
    let mouseMovements = 0;
    let lastMouseMove = Date.now();
    let mouseMovementTimer;
    
    document.addEventListener('mousemove', () => {
      mouseMovements++;
      lastMouseMove = Date.now();
      
      clearTimeout(mouseMovementTimer);
      mouseMovementTimer = setTimeout(() => {
        if (mouseMovements > 50) {
          track('mouse.movements', mouseMovements);
          mouseMovements = 0;
        }
      }, 5000);
    });
    
    // Mouse idle detection
    setInterval(() => {
      const idleSeconds = Math.round((Date.now() - lastMouseMove) / 1000);
      if (idleSeconds > 30 && idleSeconds % 30 === 0) {
        track('mouse.idle_sec', idleSeconds);
      }
    }, 30000);
  }

  // H. MEDIA TRACKING (Video/Audio)
  if (CONFIG.trackMedia) {
    const trackMediaEvent = (media, event) => {
      const mediaType = media.tagName.toLowerCase();
      const mediaSrc = (media.src || media.currentSrc || 'unknown').split('/').pop()?.slice(0, 50) || 'unknown';
      const mediaId = hash(mediaSrc);
      const percent = media.duration ? Math.round((media.currentTime / media.duration) * 100) : 0;
      
      track(`media.${event}.${mediaType}`, percent, mediaId);
      track(`media.current_time_sec`, Math.round(media.currentTime) || 0, mediaId);
      track(`media.duration_sec`, Math.round(media.duration) || 0, mediaId);
    };
    
    document.addEventListener('play', (e) => {
      if (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') {
        trackMediaEvent(e.target, 'play');
      }
    }, true);
    
    document.addEventListener('pause', (e) => {
      if (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') {
        trackMediaEvent(e.target, 'pause');
      }
    }, true);
    
    document.addEventListener('ended', (e) => {
      if (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') {
        trackMediaEvent(e.target, 'ended');
      }
    }, true);
    
    document.addEventListener('volumechange', (e) => {
      if (e.target.tagName === 'VIDEO' || e.target.tagName === 'AUDIO') {
        const mediaSrc = (e.target.src || e.target.currentSrc || 'unknown').split('/').pop()?.slice(0, 50) || 'unknown';
        const mediaId = hash(mediaSrc);
        track('media.volume', Math.round(e.target.volume * 100), mediaId);
        track('media.muted', e.target.muted ? 1 : 0, mediaId);
      }
    }, true);
  }

  // I. VISIBILITY & ENGAGEMENT
  if (CONFIG.trackVisibility) {
    let visibilityStartTime = Date.now();
    let totalVisibleTime = 0;
    let visibilityChanges = 0;
    
    document.addEventListener('visibilitychange', () => {
      visibilityChanges++;
      
      if (document.hidden) {
        const visibleDuration = Date.now() - visibilityStartTime;
        totalVisibleTime += visibleDuration;
        
        track('page.hidden_duration_sec', Math.round(visibleDuration / 1000));
        track('page.total_visible_sec', Math.round(totalVisibleTime / 1000));
        track('page.visibility_changes', visibilityChanges);
      } else {
        visibilityStartTime = Date.now();
        track('page.visible', 1);
      }
    });
    
    // Periodic engagement heartbeat
    setInterval(() => {
      if (!document.hidden) {
        const engagementTime = Math.round((Date.now() - visibilityStartTime) / 1000);
        track('engagement.heartbeat_sec', engagementTime);
        track('engagement.total_visible_sec', Math.round(totalVisibleTime / 1000));
      }
    }, 30000);
  }

  // J. COPY/PASTE TRACKING
  document.addEventListener('copy', (e) => {
    const selectedText = window.getSelection()?.toString() || '';
    track('clipboard.copy_length', selectedText.length);
  });
  
  document.addEventListener('paste', (e) => {
    track('clipboard.paste', 1, e.target?.tagName?.toLowerCase() || 'unknown');
  });

  // K. WINDOW RESIZE
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      track('window.resize', 1);
      track('window.width', window.innerWidth);
      track('window.height', window.innerHeight);
    }, 500);
  });

  // L. PRINT TRACKING
  window.addEventListener('beforeprint', () => {
    track('page.print', 1);
  });

  // M. RIGHT CLICK TRACKING
  document.addEventListener('contextmenu', (e) => {
    const elementType = e.target?.tagName?.toLowerCase() || 'unknown';
    track('contextmenu.right_click', 1, elementType);
  });

  // ============================================
  // 6. SESSION SUMMARY (On Exit)
  // ============================================
  window.addEventListener('beforeunload', () => {
    const sessionDuration = Math.round((Date.now() - SESSION_START) / 1000);
    track('session.end', sessionDuration);
    track('session.total_events', QUEUE.length);
  });

  // Expose enhanced API
  window.harbor = { 
    track,
    flush: flushBatch,
    getVisitorId,
    debug: () => ({
      queueSize: QUEUE.length,
      sessionDuration: Math.round((Date.now() - SESSION_START) / 1000),
      config: CONFIG
    })
  };

})();

/**
 * Harbor Web Analytics - Privacy-First Analytics for Harbor Scale
 * Version: 2.0.0
 * Now collecting 50+ metrics
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
    trackMouse: url.searchParams.get('track-mouse') !== 'false',  // NEW
    trackMedia: url.searchParams.get('track-media') !== 'false',  // NEW
    trackVisibility: url.searchParams.get('track-visibility') !== 'false',  // NEW
    
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
  // 3. BATCHED STREAMING ENGINE (100 events/batch)
  // ============================================
  const QUEUE = [];
  let batchTimer = null;
  const SESSION_START = Date.now();

  function track(eventName, value = 1, metadata = {}) {
    const payload = {
      time: new Date().toISOString(),
      ship_id: getVisitorId(),
      cargo_id: eventName,
      value: value,
      url: window.location.pathname,
      session_duration: Math.round((Date.now() - SESSION_START) / 1000),
      ...metadata
    };

    // Enhanced connection info
    const conn = navigator.connection;
    if (conn) {
      payload.conn_type = conn.effectiveType;
      payload.conn_rtt = conn.rtt;
      payload.conn_downlink = conn.downlink;
      payload.conn_save_data = conn.saveData;
    }

    QUEUE.push(payload);
    if (CONFIG.debug) console.log(`[Harbor] Queued (${QUEUE.length}):`, eventName, payload);
    
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
    
    fetch(`${CONFIG.endpoint}/ingest/${CONFIG.harborId}`, {
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
  // 4. ENHANCED DEVICE & ENVIRONMENT CONTEXT
  // ============================================
  function getDeviceContext() {
    return {
      viewport_w: window.innerWidth,
      viewport_h: window.innerHeight,
      screen_w: window.screen.width,
      screen_h: window.screen.height,
      dpr: window.devicePixelRatio || 1,
      orientation: window.screen.orientation?.type || 'unknown',
      touch_support: navigator.maxTouchPoints > 0,
      battery_level: null, // Will be enriched async
      battery_charging: null,
      memory: navigator.deviceMemory,
      cores: navigator.hardwareConcurrency,
    };
  }

  // Enrich with battery status (async)
  if (navigator.getBattery) {
    navigator.getBattery().then(battery => {
      track('device_battery', Math.round(battery.level * 100), {
        charging: battery.charging,
        charge_time: battery.chargingTime,
        discharge_time: battery.dischargingTime
      });
    });
  }

  // Track initial device context
  track('session_start', 1, getDeviceContext());

  // ============================================
  // 5. DEEP TRACKING MODULES (ENHANCED)
  // ============================================

  // A. PAGEVIEWS (SPA Aware + Timing)
  let pageLoadTime = Date.now();
  const logPage = () => {
    const timeOnPreviousPage = Date.now() - pageLoadTime;
    pageLoadTime = Date.now();
    
    track('pageview', 1, { 
      ref: document.referrer,
      time_on_prev_page: timeOnPreviousPage > 100 ? Math.round(timeOnPreviousPage / 1000) : 0,
      title: document.title,
      query_params: window.location.search ? 1 : 0,
      hash: window.location.hash ? 1 : 0
    });
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
        
        if (!formStates.has(formId)) {
          formStates.set(formId, {
            started_at: Date.now(),
            fields_focused: new Set(),
            fields_changed: new Set(),
            field_count: form ? form.elements.length : 0
          });
        }
        
        const state = formStates.get(formId);
        state.fields_focused.add(e.target.name || e.target.id || 'unknown');
        
        track('form_focus', Math.round((Date.now() - state.started_at) / 1000), {
          field: e.target.name || e.target.id || 'unknown',
          field_type: e.target.type || e.target.tagName.toLowerCase(),
          form_id: formId,
          fields_focused_count: state.fields_focused.size
        });
      }
    }, true);

    document.addEventListener('change', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        const form = e.target.form;
        const formId = form ? (form.id || form.name || 'form_' + hash(form.outerHTML.slice(0, 100))) : 'no_form';
        
        if (formStates.has(formId)) {
          formStates.get(formId).fields_changed.add(e.target.name || e.target.id || 'unknown');
        }
        
        track('form_change', e.target.value ? e.target.value.length : 0, { 
          field: e.target.name || e.target.id,
          field_type: e.target.type || e.target.tagName.toLowerCase(),
          form_id: formId
        });
      }
    }, true);
    
    document.addEventListener('submit', (e) => {
      const formId = e.target.id || e.target.name || 'form_' + hash(e.target.outerHTML.slice(0, 100));
      const state = formStates.get(formId);
      
      track('form_submit', state ? Math.round((Date.now() - state.started_at) / 1000) : 0, { 
        form_id: formId,
        fields_total: state ? state.field_count : 0,
        fields_focused: state ? state.fields_focused.size : 0,
        fields_changed: state ? state.fields_changed.size : 0,
        completion_rate: state ? Math.round((state.fields_changed.size / state.field_count) * 100) : 0
      });
      
      formStates.delete(formId);
    });
    
    // Form abandonment tracking
    setInterval(() => {
      formStates.forEach((state, formId) => {
        const timeInForm = (Date.now() - state.started_at) / 1000;
        if (timeInForm > 30 && state.fields_changed.size > 0) {
          track('form_abandonment_risk', Math.round(timeInForm), {
            form_id: formId,
            fields_changed: state.fields_changed.size,
            fields_total: state.field_count
          });
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
      
      track('js_error', 1, { 
        msg: e.message.slice(0, 100), 
        file: e.filename, 
        line: e.lineno,
        col: e.colno,
        stack: e.error?.stack?.slice(0, 200),
        occurrence_count: count
      });
    });
    
    window.addEventListener('unhandledrejection', (e) => {
      track('promise_error', 1, { 
        reason: e.reason ? e.reason.toString().slice(0, 100) : 'unknown',
        promise: e.promise ? 'Promise' : 'unknown'
      });
    });
    
    // Console error tracking (non-intrusive)
    const originalError = console.error;
    console.error = function(...args) {
      track('console_error', 1, { msg: args.join(' ').slice(0, 100) });
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
        const elementId = el.id || el.className || el.tagName;
        const elementKey = `${elementId}_${el.textContent?.slice(0, 20)}`;
        clickedElements.add(elementKey);
        
        track('click', Math.round((e.clientX / window.innerWidth) * 100), {
          element_type: el.tagName.toLowerCase(),
          element_id: el.id || 'no_id',
          element_class: el.className ? el.className.split(' ')[0] : 'no_class',
          element_text: el.textContent?.trim().slice(0, 30) || '',
          data_track: el.getAttribute('data-track') || null,
          is_link: el.tagName === 'A' ? 1 : 0,
          is_button: el.tagName === 'BUTTON' || el.type === 'button' ? 1 : 0,
          has_href: el.href ? 1 : 0,
          viewport_y: Math.round((e.clientY / window.innerHeight) * 100)
        });
      }

      // 2. Rage Click Detection (3 clicks in 1s)
      clicks.push({ x: e.clientX, y: e.clientY, t: now });
      clicks = clicks.filter(c => now - c.t < 1000);
      
      if (clicks.length >= 3) {
        const isRage = clicks.every(c => 
          Math.abs(c.x - clicks[0].x) < 20 && Math.abs(c.y - clicks[0].y) < 20
        );
        if (isRage) {
          track('rage_click', clicks.length, { 
            tag: e.target.tagName,
            text: e.target.textContent?.slice(0, 20),
            x: e.clientX,
            y: e.clientY
          });
          clicks = [];
        }
      }
      
      // 3. Dead Click Detection
      const style = window.getComputedStyle(e.target);
      if (style.cursor === 'pointer' && !e.target.href && !e.target.onclick && 
          e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        track('dead_click', 1, { 
          text: e.target.textContent?.slice(0, 20),
          tag: e.target.tagName,
          class: e.target.className
        });
      }
    }, true);
    
    // Click coverage tracking
    setInterval(() => {
      track('click_coverage', clickedElements.size);
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
            track('scroll_milestone', m, {
              scroll_count: scrollCount,
              time_to_milestone: Math.round((Date.now() - pageLoadTime) / 1000),
              scroll_speed_ms: timeSinceLastScroll
            });
          }
        });
        
        // Scroll depth heartbeat
        if (scrollCount % 20 === 0) {
          track('scroll_depth', maxScroll, {
            total_scrolls: scrollCount,
            page_height: Math.round(document.documentElement.scrollHeight)
          });
        }
      }, 200);
    });
    
    // Report final scroll depth on page leave
    window.addEventListener('beforeunload', () => {
      track('final_scroll_depth', maxScroll, { scroll_count: scrollCount });
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
      track('lcp', Math.round(e.renderTime || e.loadTime), {
        element: e.element?.tagName || 'unknown',
        url: e.url || 'none'
      });
    });
    
    observe('first-input', e => {
      track('fid', Math.round(e.processingStart - e.startTime), {
        event_type: e.name,
        target: e.target?.tagName || 'unknown'
      });
    });
    
    observe('layout-shift', e => { 
      if (!e.hadRecentInput) {
        track('cls', Math.round(e.value * 1000), {
          sources: e.sources?.length || 0
        });
      }
    });
    
    // Navigation Timing
    window.addEventListener('load', () => {
      setTimeout(() => {
        const nav = performance.getEntriesByType('navigation')[0];
        if (nav) {
          track('page_load_complete', Math.round(nav.loadEventEnd), {
            dns: Math.round(nav.domainLookupEnd - nav.domainLookupStart),
            tcp: Math.round(nav.connectEnd - nav.connectStart),
            ttfb: Math.round(nav.responseStart - nav.requestStart),
            download: Math.round(nav.responseEnd - nav.responseStart),
            dom_parse: Math.round(nav.domContentLoadedEventEnd - nav.responseEnd),
            dom_interactive: Math.round(nav.domInteractive - nav.fetchStart),
            total_load: Math.round(nav.loadEventEnd - nav.fetchStart)
          });
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
          track(`resource_${type}`, byType[type].count, {
            total_size: Math.round(byType[type].size / 1024), // KB
            avg_duration: Math.round(byType[type].duration / byType[type].count)
          });
        });
      }, 0);
    });
    
    // Long Tasks (> 50ms)
    observe('longtask', e => {
      track('long_task', Math.round(e.duration), {
        attribution: e.attribution?.[0]?.name || 'unknown'
      });
    });
  }

  // G. MOUSE MOVEMENT & ENGAGEMENT
  if (CONFIG.trackMouse) {
    let mouseMovements = 0;
    let mouseIdleTime = 0;
    let lastMouseMove = Date.now();
    let mouseMovementTimer;
    
    document.addEventListener('mousemove', () => {
      mouseMovements++;
      lastMouseMove = Date.now();
      mouseIdleTime = 0;
      
      clearTimeout(mouseMovementTimer);
      mouseMovementTimer = setTimeout(() => {
        if (mouseMovements > 50) {
          track('mouse_activity', mouseMovements, {
            idle_time: Math.round((Date.now() - lastMouseMove) / 1000)
          });
          mouseMovements = 0;
        }
      }, 5000);
    });
    
    // Mouse idle detection
    setInterval(() => {
      const idleSeconds = Math.round((Date.now() - lastMouseMove) / 1000);
      if (idleSeconds > 30 && idleSeconds % 30 === 0) {
        track('mouse_idle', idleSeconds);
      }
    }, 30000);
  }

  // H. MEDIA TRACKING (Video/Audio)
  if (CONFIG.trackMedia) {
    const trackMediaEvent = (media, event) => {
      const mediaId = media.src || media.currentSrc || 'unknown';
      track(`media_${event}`, 1, {
        media_type: media.tagName.toLowerCase(),
        media_src: mediaId.split('/').pop()?.slice(0, 50) || 'unknown',
        duration: Math.round(media.duration) || 0,
        current_time: Math.round(media.currentTime) || 0,
        percent: media.duration ? Math.round((media.currentTime / media.duration) * 100) : 0
      });
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
        track('media_volume_change', Math.round(e.target.volume * 100), {
          muted: e.target.muted ? 1 : 0
        });
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
        
        track('page_hidden', Math.round(visibleDuration / 1000), {
          total_visible_time: Math.round(totalVisibleTime / 1000),
          visibility_changes: visibilityChanges
        });
      } else {
        visibilityStartTime = Date.now();
        track('page_visible', 1);
      }
    });
    
    // Periodic engagement heartbeat
    setInterval(() => {
      if (!document.hidden) {
        const engagementTime = Math.round((Date.now() - visibilityStartTime) / 1000);
        track('engagement_heartbeat', engagementTime, {
          total_visible_time: Math.round(totalVisibleTime / 1000)
        });
      }
    }, 30000);
  }

  // J. COPY/PASTE TRACKING
  document.addEventListener('copy', (e) => {
    const selectedText = window.getSelection()?.toString() || '';
    track('copy', selectedText.length, {
      text_preview: selectedText.slice(0, 30)
    });
  });
  
  document.addEventListener('paste', (e) => {
    track('paste', 1, {
      target: e.target?.tagName || 'unknown'
    });
  });

  // K. WINDOW RESIZE
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      track('window_resize', 1, {
        width: window.innerWidth,
        height: window.innerHeight,
        orientation: window.screen.orientation?.type || 'unknown'
      });
    }, 500);
  });

  // L. PRINT TRACKING
  window.addEventListener('beforeprint', () => {
    track('page_print', 1);
  });

  // M. RIGHT CLICK TRACKING
  document.addEventListener('contextmenu', (e) => {
    track('right_click', 1, {
      element: e.target?.tagName || 'unknown',
      text: e.target?.textContent?.slice(0, 20) || ''
    });
  });

  // ============================================
  // 6. SESSION SUMMARY (On Exit)
  // ============================================
  window.addEventListener('beforeunload', () => {
    const sessionDuration = Math.round((Date.now() - SESSION_START) / 1000);
    track('session_end', sessionDuration, {
      ...getDeviceContext(),
      total_events: QUEUE.length
    });
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

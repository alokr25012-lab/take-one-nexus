const API = (() => {
  const BASE_URL = window.location.origin;
  const TOKEN_KEY = 'take_one_token';
  const USER_KEY = 'take_one_user';
  let activeRequests = 0;

  // PostHog for legacy pages
  (async function initLegacyPostHog() {
    if (typeof window === 'undefined' || window.posthog) return;

    const consentRaw = localStorage.getItem('ton_cookie_consent');
    if (!consentRaw) return;

    try {
      const consent = JSON.parse(consentRaw).preferences;
      if (!consent.analytics) return;

      // Dynamic load PostHog from CDN
      const script = document.createElement('script');
      script.src = 'https://us-assets.i.posthog.com/static/array.js';
      script.async = true;
      script.onload = () => {
        if (window.posthog) {
          window.posthog.init('phc_zHX9qoufwk9jdTkqP8Fef53gyoMnhw2MMiFXGazpWA2F', {
            api_host: 'https://us.i.posthog.com',
            capture_pageview: true, // Auto-track pageview on legacy pages
            persistence: 'localStorage+cookie',
          });
          console.log('[PostHog] Legacy initialized');
        }
      };
      document.head.appendChild(script);
    } catch (e) {
      console.warn('[PostHog] Legacy init failed:', e);
    }
  })();

  // PostHog helper for legacy scripts
  function track(event, props = {}) {
    if (typeof window !== 'undefined' && window.posthog) {
      window.posthog.capture(event, {
        ...props,
        source: 'legacy_api',
        event_timestamp_ist: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      });
    }
  }

  function getActiveRequests() {
    return activeRequests;
  }

  async function request(path, options = {}) {
    const token = localStorage.getItem(TOKEN_KEY);
    const headers = {
      ...(options.headers || {})
    };

    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    // Automatically fetch and include CSRF token for mutating requests (POST, PUT, PATCH, DELETE)
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      try {
        const csrfRes = await fetch(`${BASE_URL}/api/csrf-token`, { credentials: 'include' });
        if (csrfRes.ok) {
          const { csrfToken } = await csrfRes.json();
          if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
          }
        }
      } catch (err) {
        console.warn('[SECURITY] Failed to retrieve CSRF token:', err);
      }
    }

    // Timeout mechanism
    const timeout = options.timeout || 15000; // Default 15s
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    activeRequests++;

    try {
      const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        headers,
        credentials: 'include',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json().catch(() => ({}));
      } else {
        data = { message: await response.text().catch(() => 'Request failed') };
      }

      if (!response.ok) {
        // Handle unauthorized
        if (response.status === 401 && token) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          window.location.reload();
        }
        
        return throwError(path, options, response.status, data);
      }

      return data;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('The request timed out. Please check your internet connection or try again later.');
      }
      throw err;
    } finally {
      activeRequests--;
    }
  }

  function throwError(path, options, status, data) {
    const error = new Error(data.message || `Request failed with status ${status}`);
    error.status = status;
    throw error;
  }


  return {
    getActiveRequests,
    home: {
      get() {
        return request('/api/home');
      }
    },
    scripts: {
      search(query, genre = '') {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (genre) params.set('genre', genre);
        return request(`/api/scripts/search?${params.toString()}`);
      },
      async create(payload) {
        const result = await request('/api/scripts', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (result.success) {
          track('project_created', { title: payload.title, genre: payload.genre });
        }
        return result;
      },
      update(id, payload) {
        return request(`/api/scripts/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      },
      delete(id) {
        return request(`/api/scripts/${id}`, {
          method: 'DELETE'
        });
      },
      createPortfolio(payload) {
        return request('/api/portfolio', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
    },
    portfolio: {
      list(userId) {
        return request(`/api/portfolio?userId=${userId}`);
      },
      create(payload) {
        return request('/api/portfolio', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      },
      update(id, payload) {
        return request(`/api/portfolio/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      },
      delete(id) {
        return request(`/api/portfolio/${id}`, {
          method: 'DELETE'
        });
      }
    },
    ratings: {
      getStatus(ratedUserId) {
        return request(`/api/ratings/status/${ratedUserId}`);
      },
      submit(ratedUserId, rating) {
        return request('/api/ratings', {
          method: 'POST',
          body: JSON.stringify({ ratedUserId, rating })
        });
      },
      delete(ratedUserId) {
        return request(`/api/ratings/${ratedUserId}`, {
          method: 'DELETE'
        });
      },
      getLeaderboard() {
        return request('/api/ratings/leaderboard');
      }
    },
    requests: {
      async create(payload) {
        const result = await request('/api/requests', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (result.success) {
          track('task_created', { 
            project_id: payload.scriptId || payload.projectId,
            role: payload.role 
          });
        }
        return result;
      },
      forUser(id) {
        return request(`/api/requests/user/${id}`);
      },
      async updateStatus(id, status) {
        const result = await request(`/api/requests/${id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status })
        });
        if (result.success && status === 'Accepted') {
          track('task_approved', { request_id: id });
        }
        return result;
      }
    },
    notifications: {
      forUser(id) {
        return request(`/api/notifications/user/${id}`);
      },
      markRead(id) {
        return request(`/api/notifications/${id}/read`, {
          method: 'PATCH'
        });
      },
      markAllRead(id) {
        return request(`/api/notifications/user/${id}/read-all`, {
          method: 'PATCH'
        });
      }
    },
    system: {
      emailStatus() {
        return request('/api/system/email/status');
      },
      sendEmailTest() {
        return request('/api/system/email/test', {
          method: 'POST',
          body: JSON.stringify({})
        });
      }
    },
    moderation: {
      report(payload) {
        return request('/api/moderation/reports', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      },
      listReports(status = '') {
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        return request(`/api/moderation/reports?${params.toString()}`);
      },
      updateReport(id, payload) {
        return request(`/api/moderation/reports/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
      }
    },
    users: {
      async register(payload) {
        const result = await request('/api/users/register', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (result.success) {
          track('signup', { role: payload.role, college: payload.college });
        }
        return result;
      },
      async login(email, password) {
        const result = await request('/api/users/login', {
          method: 'POST',
          body: JSON.stringify({ email, password })
        });
        if (result.success && result.user) {
          track('login', { user_id: result.user.id });
          if (typeof window !== 'undefined' && window.posthog) {
            window.posthog.identify(String(result.user.id), {
              email: result.user.email,
              name: result.user.name
            });
          }
        }
        return result;
      },
      forgotPassword(email) {
        return request('/api/auth/forgot-password', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
      },
      search(params = {}) {
        const query = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
          if (value) query.set(key, value);
        });
        return request(`/api/users/search?${query.toString()}`);
      },
      getProfile(id) {
        return request(`/api/users/${id}`);
      },
      updateProfile(id, payload) {
        return request(`/api/users/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      },
      me() {
        return request('/api/users/me');
      }
    },
    auth: {
      saveToken(token, user) {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        localStorage.setItem('take_one_session_start', Date.now());
      },
      getToken() {
        return localStorage.getItem(TOKEN_KEY);
      },
      getUser() {
        const raw = localStorage.getItem(USER_KEY);
        if (!raw) return null;

        try {
          return JSON.parse(raw);
        } catch (error) {
          localStorage.removeItem(USER_KEY);
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem('take_one_session_start');
          return null;
        }
      },
      isLoggedIn() {
        return Boolean(localStorage.getItem(TOKEN_KEY));
      },
      async validateSession() {
        const token = localStorage.getItem(TOKEN_KEY);
        const user = this.getUser();
        if (!token || !user) {
          return { valid: false, user: null };
        }

        try {
          const response = await request('/api/users/me', { method: 'GET' });
          if (!response?.success || !response?.user) {
            throw new Error(response?.message || 'Session validation failed');
          }

          const mergedUser = {
            ...user,
            ...response.user
          };
          localStorage.setItem(USER_KEY, JSON.stringify(mergedUser));
          return { valid: true, user: mergedUser };
        } catch (error) {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          localStorage.removeItem('take_one_session_start');
          return { valid: false, user: null };
        }
      },
      async logout() {
        try {
          await request('/api/users/logout', { method: 'POST' });
        } catch (e) {
          // Silent fail on backend logout
        }
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem('take_one_session_start');
        window.location.reload();
      }
    },
    payments: {
      createOrder(payload) {
        return request('/api/payments/create-order', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      },
      verify(payload) {
        return request('/api/payments/verify', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      },
      cancel(payload) {
        return request('/api/payments/cancel', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
    },
    creators: {
      list() {
        return request('/api/creators');
      }
    },
    leaderboard: {
      get() {
        return request('/api/leaderboard');
      }
    }
  };
})();

/**
 * SESSION MANAGEMENT
 * Optimized for performance: Removed 30-minute auto-reload.
 */
(() => {
  const SESSION_MAX_AGE = 10 * 24 * 60 * 60 * 1000; // 10 days

  function checkSessionExpiry() {
    const sessionStart = localStorage.getItem('take_one_session_start');
    if (sessionStart) {
      if (Date.now() - parseInt(sessionStart, 10) > SESSION_MAX_AGE) {
        if (typeof API !== 'undefined' && API.auth) {
          API.auth.logout();
        } else {
          localStorage.clear();
          window.location.reload();
        }
        return true;
      }
    }
    return false;
  }

  // Initialize
  if (typeof window !== 'undefined') {
    checkSessionExpiry();
    
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkSessionExpiry();
      }
    });
  }
})();

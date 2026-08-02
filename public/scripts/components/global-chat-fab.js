(function () {
  if (window.__takeOneChatFabLoaded) return;
  window.__takeOneChatFabLoaded = true;

  const params = new URLSearchParams(window.location.search);
  const authMode = params.get('auth');

  if (authMode === 'login' || authMode === 'register') return;

  const TOKEN_KEY = 'take_one_token';
  const USER_KEY = 'take_one_user';
  const LAST_CONVERSATION_KEY = 'take_one_last_conversation';

  function getChatTarget() {
    const lastConversation = localStorage.getItem(LAST_CONVERSATION_KEY);
    return lastConversation ? `/chat?conversationId=${encodeURIComponent(lastConversation)}` : '/chat';
  }

  function hasLocalSession() {
    return Boolean(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(USER_KEY));
  }

  async function fetchSession() {
    try {
      const response = await fetch('/api/users/me', {
        credentials: 'same-origin'
      });
      const json = await response.json();

      if (response.ok && json.success && json.user) {
        // Merge into existing user data so no fields (avatar_url, etc.) are ever lost
        const existingRaw = localStorage.getItem(USER_KEY);
        const existing = existingRaw ? JSON.parse(existingRaw) : {};
        localStorage.setItem(USER_KEY, JSON.stringify({ ...existing, ...json.user }));
        return true;
      }
    } catch (error) {
      console.warn('Could not verify chat session', error);
    }

    return false;
  }

  async function setupPusher(userId, key, cluster, badge) {
    if (window.__takeOneFabPusherSetup) return;
    window.__takeOneFabPusherSetup = true;

    if (!window.Pusher) {
      await new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://js.pusher.com/8.2.0/pusher.min.js';
        script.onload = resolve;
        document.head.appendChild(script);
      });
    }

    if (window.Pusher && key && cluster) {
      const pusher = new Pusher(key, {
        cluster,
        authorizer: (channel) => {
          return {
            authorize: (socketId, callback) => {
              const token = localStorage.getItem(TOKEN_KEY);
              fetch('/api/chat/pusher/auth', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                body: JSON.stringify({
                  socket_id: socketId,
                  channel_name: channel.name
                })
              })
              .then(response => response.json())
              .then(data => {
                if (data.auth) {
                  callback(null, data);
                } else {
                  callback(new Error(data.message || 'Authorization failed'), null);
                }
              })
              .catch(err => {
                callback(err, null);
              });
            }
          };
        }
      });
      const channel = pusher.subscribe(`user-${userId}`);
      channel.bind('message-notification', () => {
        // Fetch exact count from server for accuracy
        updateConversationCount(badge);
      });
    }
  }

  async function updateConversationCount(badge) {
    if (!hasLocalSession()) return;

    try {
      const response = await fetch('/api/chat/unread-count', {
        credentials: 'same-origin'
      });
      const json = await response.json();
      const count = json.success && typeof json.count === 'number' ? json.count : 0;

      if (response.ok && json.success) {
        if (count > 0) {
          badge.textContent = count > 9 ? '9+' : String(count);
          badge.classList.add('is-visible');
        } else {
          badge.classList.remove('is-visible');
        }

        // Setup real-time listener if keys provided
        const userDataStr = localStorage.getItem(USER_KEY);
        if (userDataStr && json.pusherKey && json.pusherCluster) {
          try {
            const user = JSON.parse(userDataStr);
            setupPusher(user.id, json.pusherKey, json.pusherCluster, badge);
          } catch (e) {}
        }
      }
    } catch (error) {
      console.warn('Could not load chat unread count', error);
    }
  }

  // ─── GLOBAL COMMUNITY FEED ────────────────────────────────────
  
  let feedPage = 1;
  let feedLoading = false;
  let feedHasMore = true;
  let feedPanel = null;
  let feedList = null;

  function getDisplayName(user) {
    if (!user) return 'Unknown';
    const pref = (user.display_preference || '').toLowerCase();
    if (pref === 'screen name only' && user.screen_name) return user.screen_name;
    if (pref === 'both' && user.screen_name) return `${user.name} (${user.screen_name})`;
    return user.name || 'Creator';
  }

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function getFallbackAvatar(name) {
    const initials = (name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 40 40"><rect width="40" height="40" fill="#1c2330"/><text x="50%" y="54%" font-family="monospace" font-size="14" fill="#ff4d1a" text-anchor="middle" dominant-baseline="middle" font-weight="bold">${initials}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function buildPostCard(post) {
    const card = document.createElement('div');
    card.className = 'gf-post-card';
    card.setAttribute('data-post-id', post.id);

    const mediaUrls = Array.isArray(post.media_urls) ? post.media_urls : (typeof post.media_urls === 'string' ? JSON.parse(post.media_urls) : []);
    const authorName = getDisplayName(post.author);
    const authorAvatar = (post.author && post.author.avatar_url) ? post.author.avatar_url : getFallbackAvatar(authorName);
    const communityAvatar = (post.community && post.community.avatar_url) ? post.community.avatar_url : getFallbackAvatar(post.community ? post.community.name : 'C');
    const likeCount = post.like_count || post.likes?.length || 0;
    const commentCount = post.comment_count || post.comments?.length || 0;
    const isLiked = Boolean(post.liked_by_me);

    // Build media gallery
    let mediaHtml = '';
    if (mediaUrls.length === 1) {
      const img = document.createElement('img');
      img.className = 'gf-media-single';
      img.alt = 'Post image';
      img.loading = 'lazy';
      img.src = mediaUrls[0];
      img.onerror = function() { this.src = getFallbackAvatar('?'); };
      const mediaDiv = document.createElement('div');
      mediaDiv.className = 'gf-media';
      mediaDiv.appendChild(img);
      mediaHtml = mediaDiv.outerHTML;
    } else if (mediaUrls.length > 1) {
      const mediaDiv = document.createElement('div');
      mediaDiv.className = `gf-media gf-media-grid gf-grid-${Math.min(mediaUrls.length, 4)}`;
      mediaUrls.slice(0, 4).forEach((url, i) => {
        const img = document.createElement('img');
        img.alt = 'Post image';
        img.loading = 'lazy';
        img.src = url;
        img.onerror = function() { this.src = getFallbackAvatar('?'); };
        if (i === 3 && mediaUrls.length > 4) {
          const overlay = document.createElement('div');
          overlay.className = 'gf-media-more';
          const span = document.createElement('span');
          span.textContent = `+${mediaUrls.length - 4}`;
          overlay.appendChild(img);
          overlay.appendChild(span);
          mediaDiv.appendChild(overlay);
        } else {
          mediaDiv.appendChild(img);
        }
      });
      mediaHtml = mediaDiv.outerHTML;
    }

    // Build comments preview (safe DOM construction)
    let commentsPreviewHtml = '';
    const previewComments = (post.comments || []).slice(0, 2);
    if (previewComments.length > 0) {
      const commentsDivOuter = document.createElement('div');
      commentsDivOuter.className = 'gf-comments-preview';
      previewComments.forEach(c => {
        const commentName = getDisplayName(c.user);
        const div = document.createElement('div');
        div.className = 'gf-comment-item';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'gf-comment-author';
        nameSpan.textContent = commentName;
        const contentSpan = document.createElement('span');
        contentSpan.className = 'gf-comment-text';
        contentSpan.textContent = c.content;
        div.appendChild(nameSpan);
        div.appendChild(document.createTextNode(' '));
        div.appendChild(contentSpan);
        commentsDivOuter.appendChild(div);
      });
      commentsPreviewHtml = commentsDivOuter.outerHTML;
    }

    // Use safe DOM construction for user-controlled text (caption)
    card.innerHTML = `
      <div class="gf-post-header">
        <div class="gf-community-tag">
          <img class="gf-community-avatar" src="${communityAvatar}" alt="" onerror="this.src='${getFallbackAvatar('C')}'" />
          <a class="gf-community-name" href="/chat" data-community-id="${post.community ? post.community.id : ''}">${post.community ? post.community.name : 'Community'}</a>
        </div>
        <div class="gf-author-row">
          <img class="gf-author-avatar" src="${authorAvatar}" alt="" onerror="this.src='${getFallbackAvatar(authorName)}'" />
          <div class="gf-author-info">
            <span class="gf-author-name"></span>
            <span class="gf-post-time">${timeAgo(post.created_at)}</span>
          </div>
        </div>
      </div>
      ${mediaHtml}
      <div class="gf-post-body">
        <p class="gf-caption"></p>
      </div>
      <div class="gf-post-actions">
        <button class="gf-action-btn gf-like-btn ${isLiked ? 'is-liked' : ''}" data-post-id="${post.id}" data-community-id="${post.community ? post.community.id : 0}" aria-label="Like post">
          <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
          <span class="gf-like-count">${likeCount}</span>
        </button>
        <button class="gf-action-btn gf-comment-btn" aria-label="View comments">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>${commentCount}</span>
        </button>
        <button class="gf-action-btn gf-share-btn" data-url="${encodeURIComponent(window.location.origin + '/chat')}" aria-label="Share post">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          <span>Share</span>
        </button>
      </div>
      ${commentsPreviewHtml}
      <div class="gf-add-comment" data-post-id="${post.id}" data-community-id="${post.community ? post.community.id : 0}">
        <input class="gf-comment-input" placeholder="Add a comment..." maxlength="300" />
        <button class="gf-comment-submit">Post</button>
      </div>
    `;

    // Set user-controlled text safely via textContent (XSS protection)
    card.querySelector('.gf-author-name').textContent = authorName;
    if (post.caption) {
      card.querySelector('.gf-caption').textContent = post.caption;
    }

    // Bind like button
    const likeBtn = card.querySelector('.gf-like-btn');
    likeBtn.addEventListener('click', () => handleLike(likeBtn, post));

    // Bind share button
    const shareBtn = card.querySelector('.gf-share-btn');
    shareBtn.addEventListener('click', () => handleShare(post));

    // Bind community name link
    const commLink = card.querySelector('.gf-community-name');
    commLink.addEventListener('click', (e) => {
      e.preventDefault();
      closeFeedPanel();
      window.location.href = '/chat';
    });

    // Bind comment submit
    const commentInput = card.querySelector('.gf-comment-input');
    const commentSubmit = card.querySelector('.gf-comment-submit');
    commentSubmit.addEventListener('click', () => handleComment(post, commentInput, card));
    commentInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleComment(post, commentInput, card);
      }
    });

    return card;
  }

  async function handleLike(btn, post) {
    if (!hasLocalSession()) return;
    const communityId = btn.getAttribute('data-community-id');
    const postId = btn.getAttribute('data-post-id');
    const isLiked = btn.classList.contains('is-liked');
    const countEl = btn.querySelector('.gf-like-count');

    // Optimistic update
    btn.classList.toggle('is-liked');
    btn.querySelector('svg').setAttribute('fill', isLiked ? 'none' : 'currentColor');
    const currentCount = parseInt(countEl.textContent, 10) || 0;
    countEl.textContent = isLiked ? Math.max(0, currentCount - 1) : currentCount + 1;

    try {
      const res = await fetch(`/api/community/${communityId}/posts/${postId}/like`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) {
        // Revert on failure
        btn.classList.toggle('is-liked');
        btn.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
        countEl.textContent = currentCount;
      }
    } catch {
      btn.classList.toggle('is-liked');
      btn.querySelector('svg').setAttribute('fill', isLiked ? 'currentColor' : 'none');
      countEl.textContent = currentCount;
    }
  }

  async function handleComment(post, input, card) {
    const content = input.value.trim();
    if (!content) return;
    if (!hasLocalSession()) {
      if (typeof showToast === 'function') showToast('Login required to comment ✦');
      return;
    }

    const communityId = post.community ? post.community.id : 0;
    input.value = '';
    input.disabled = true;

    try {
      const res = await fetch(`/api/community/${communityId}/posts/${post.id}/comment`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
      const json = await res.json();
      if (json.success && json.data) {
        // Append new comment to the preview area safely
        let preview = card.querySelector('.gf-comments-preview');
        if (!preview) {
          preview = document.createElement('div');
          preview.className = 'gf-comments-preview';
          card.querySelector('.gf-post-actions').after(preview);
        }
        const commentDiv = document.createElement('div');
        commentDiv.className = 'gf-comment-item';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'gf-comment-author';
        nameSpan.textContent = getDisplayName(json.data.user);
        const textSpan = document.createElement('span');
        textSpan.className = 'gf-comment-text';
        textSpan.textContent = json.data.content;
        commentDiv.appendChild(nameSpan);
        commentDiv.appendChild(document.createTextNode(' '));
        commentDiv.appendChild(textSpan);
        preview.appendChild(commentDiv);

        // Update comment count
        const countEl = card.querySelector('.gf-comment-btn span');
        if (countEl) countEl.textContent = parseInt(countEl.textContent || '0', 10) + 1;
      }
    } catch (err) {
      console.warn('Comment failed:', err);
    } finally {
      input.disabled = false;
    }
  }

  function handleShare(post) {
    const url = window.location.origin + '/chat';
    if (navigator.share) {
      navigator.share({ title: 'Check out this community post on TAKE ONE', url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => {
        if (typeof showToast === 'function') showToast('Link copied ✦');
      }).catch(() => {});
    }
  }

  async function loadMorePosts() {
    if (feedLoading || !feedHasMore) return;
    feedLoading = true;

    const spinner = feedPanel ? feedPanel.querySelector('.gf-spinner') : null;
    if (spinner) spinner.style.display = 'block';

    try {
      const res = await fetch(`/api/community/posts/global-feed?page=${feedPage}&limit=8`, {
        credentials: 'same-origin'
      });
      const json = await res.json();

      if (json.success && json.data) {
        json.data.forEach(post => {
          const card = buildPostCard(post);
          feedList.appendChild(card);
          // Animate in
          requestAnimationFrame(() => {
            requestAnimationFrame(() => card.classList.add('is-visible'));
          });
        });
        feedHasMore = json.pagination.hasMore;
        feedPage++;

        if (!feedHasMore) {
          const end = document.createElement('div');
          end.className = 'gf-end-message';
          end.textContent = '— You\'ve seen it all —';
          feedList.appendChild(end);
        }
      }
    } catch (err) {
      console.warn('Feed load failed:', err);
    } finally {
      feedLoading = false;
      if (spinner) spinner.style.display = 'none';
    }
  }

  function buildFeedPanel() {
    const panel = document.createElement('div');
    panel.className = 'gf-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Global Community Feed');

    const header = document.createElement('div');
    header.className = 'gf-panel-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'gf-panel-title';
    titleWrap.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="gf-panel-icon">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="17" x2="12" y2="21"></line>
      </svg>
    `;
    const titleText = document.createElement('span');
    titleText.textContent = 'Community Feed';
    titleWrap.appendChild(titleText);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'gf-panel-close';
    closeBtn.setAttribute('aria-label', 'Close feed');
    closeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    closeBtn.addEventListener('click', closeFeedPanel);

    header.appendChild(titleWrap);
    header.appendChild(closeBtn);

    const list = document.createElement('div');
    list.className = 'gf-post-list';

    const spinner = document.createElement('div');
    spinner.className = 'gf-spinner';
    spinner.innerHTML = `<div class="gf-spinner-inner"></div><span>Loading feed…</span>`;

    const empty = document.createElement('div');
    empty.className = 'gf-empty';
    empty.textContent = 'No posts in the community yet. Be the first!';
    empty.style.display = 'none';

    panel.appendChild(header);
    panel.appendChild(list);
    panel.appendChild(spinner);
    panel.appendChild(empty);

    document.body.appendChild(panel);

    // Infinite scroll
    list.addEventListener('scroll', () => {
      if (list.scrollTop + list.clientHeight >= list.scrollHeight - 200) {
        loadMorePosts();
      }
    });

    return { panel, list, spinner, empty };
  }

  function openFeedPanel() {
    if (!feedPanel) {
      const built = buildFeedPanel();
      feedPanel = built.panel;
      feedList = built.list;
    }

    document.body.classList.add('gf-panel-open');
    feedPanel.classList.add('is-open');

    // Reset and load fresh if no posts loaded yet
    if (feedList.children.length === 0) {
      feedPage = 1;
      feedHasMore = true;
      loadMorePosts();
    }
  }

  function closeFeedPanel() {
    if (feedPanel) {
      feedPanel.classList.remove('is-open');
      document.body.classList.remove('gf-panel-open');
    }
  }

  // Close panel on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && feedPanel && feedPanel.classList.contains('is-open')) {
      closeFeedPanel();
    }
  });

  // ─── BUILD BUTTONS ────────────────────────────────────────────

  function buildFeedButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'takeone-feed-fab';
    button.setAttribute('aria-label', 'Open Community Feed');
    button.innerHTML = `
      <span class="takeone-feed-fab-tooltip" role="tooltip">Community Feed</span>
      <span class="takeone-feed-fab-ripple" aria-hidden="true"></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
        <line x1="8" y1="21" x2="16" y2="21"></line>
        <line x1="12" y1="17" x2="12" y2="21"></line>
      </svg>
      <span class="takeone-feed-fab-label">Feed</span>
    `;

    if (window.location.pathname.startsWith('/chat')) {
      button.classList.add('is-chat-page');
    }

    button.addEventListener('click', async () => {
      button.classList.remove('is-rippling');
      void button.offsetWidth;
      button.classList.add('is-rippling');

      if (typeof window !== 'undefined' && window.posthog) {
        window.posthog.capture('feed_fab_clicked', {
          pathname: window.location.pathname,
          timestamp_ist: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        });
      }

      if (hasLocalSession() || await fetchSession()) {
        openFeedPanel();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('Login Required to View the Feed ✦');
      }
      const loginModal = document.getElementById('loginModal');
      if (typeof openTakeOneModal === 'function' && loginModal) {
        openTakeOneModal(loginModal);
      } else {
        window.location.href = `/?auth=login`;
      }
    });

    document.body.appendChild(button);
    requestAnimationFrame(() => button.classList.add('is-visible'));
    return button;
  }

  function buildButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'takeone-chat-fab';
    button.setAttribute('aria-label', 'Open Secure Signal');
    button.innerHTML = `
      <span class="takeone-chat-fab-tooltip" role="tooltip">Open Secure Signal</span>
      <span class="takeone-chat-fab-badge" aria-hidden="true"></span>
      <span class="takeone-chat-fab-ripple" aria-hidden="true"></span>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a8.5 8.5 0 0 1-9 8.45 9.8 9.8 0 0 1-4.18-.96L3 21l1.54-4.56A8.2 8.2 0 0 1 3 12a8.5 8.5 0 0 1 9-8.45A8.5 8.5 0 0 1 21 12Z"></path>
        <path d="M8.5 11.5h7"></path>
        <path d="M8.5 15h4.8"></path>
      </svg>
      <span class="takeone-chat-fab-label">Signal</span>
    `;

    if (window.location.pathname.startsWith('/chat')) {
      button.classList.add('is-chat-page');
    }

    button.addEventListener('click', async () => {
      button.classList.remove('is-rippling');
      void button.offsetWidth;
      button.classList.add('is-rippling');

      // Track interaction
      if (typeof window !== 'undefined' && window.posthog) {
        window.posthog.capture('chat_fab_clicked', {
          pathname: window.location.pathname,
          timestamp_ist: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        });
      }

      if (hasLocalSession() || await fetchSession()) {
        window.location.href = getChatTarget();
        return;
      }

      if (typeof showToast === 'function') {
        showToast('Login Required to Access Chat ✦');
      } else {
        alert('Login Required to Access Chat ✦');
      }
      
      const loginModal = document.getElementById('loginModal');
      if (typeof openTakeOneModal === 'function' && loginModal) {
        openTakeOneModal(loginModal);
      } else {
        window.location.href = `/?auth=login&next=${encodeURIComponent(getChatTarget())}`;
      }
    });

    document.body.appendChild(button);
    requestAnimationFrame(() => button.classList.add('is-visible'));
    updateConversationCount(button.querySelector('.takeone-chat-fab-badge'));
    return button;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      buildButton();
      buildFeedButton();
    }, { once: true });
  } else {
    buildButton();
    buildFeedButton();
  }
})();

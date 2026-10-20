(() => {
  const VISITOR_KEY = 'beerlao_visitor_id';
  const UTM_KEY = 'beerlao_first_touch';
  const SESSION_KEY = 'beerlao_session_id';

  const makeId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  let visitorId = localStorage.getItem(VISITOR_KEY);
  if (!visitorId) {
    visitorId = makeId();
    localStorage.setItem(VISITOR_KEY, visitorId);
  }
  let sessionId = sessionStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = makeId();
    sessionStorage.setItem(SESSION_KEY, sessionId);
  }

  const params = new URLSearchParams(location.search);
  const normalizeSource = (value) => {
    const raw = String(value || '').trim().toLowerCase().replace(/^www\./, '');
    if (!raw) return '';
    const aliases = [
      ['facebook.com', 'facebook'], ['facebook', 'facebook'], ['fb', 'facebook'], ['meta', 'facebook'],
      ['tiktok.com', 'tiktok'], ['tiktok', 'tiktok'], ['tt', 'tiktok'],
      ['instagram.com', 'instagram'], ['instagram', 'instagram'], ['ins', 'instagram'], ['ig', 'instagram'], ['insta', 'instagram'],
      ['google.com', 'google'], ['google', 'google'], ['adwords', 'google'],
      ['bing.com', 'bing'], ['bing', 'bing'], ['microsoft', 'bing'],
      ['yandex.com', 'yandex'], ['yandex', 'yandex'],
      ['douyin.com', 'douyin'], ['douyin', 'douyin'],
      ['baidu.com', 'baidu'], ['baidu', 'baidu'],
      ['weixin.qq.com', 'wechat'], ['wechat', 'wechat'], ['weixin', 'wechat'], ['wx', 'wechat'],
      ['xhslink.com', 'xiaohongshu'], ['xiaohongshu', 'xiaohongshu'], ['xhs', 'xiaohongshu'],
    ];
    for (const [needle, source] of aliases) if (raw.includes(needle)) return source;
    return raw;
  };
  const referrerSource = () => {
    try {
      const host = new URL(document.referrer).hostname.toLowerCase();
      return normalizeSource(host);
    } catch { return ''; }
  };
  const clickIdSource = () => {
    if (params.get('fbclid')) return 'facebook';
    if (params.get('ttclid')) return 'tiktok';
    if (params.get('gclid') || params.get('gbraid') || params.get('wbraid')) return 'google';
    if (params.get('msclkid')) return 'bing';
    if (params.get('yclid')) return 'yandex';
    return '';
  };
  const taggedSource = normalizeSource(params.get('utm_source') || params.get('source') || '');
  const current = {
    source: taggedSource || clickIdSource() || referrerSource(),
    campaign: params.get('utm_campaign') || '',
    medium: params.get('utm_medium') || '',
  };
  let attribution = {};
  try { attribution = JSON.parse(localStorage.getItem(UTM_KEY) || '{}'); } catch {}
  if (!attribution.source && current.source) {
    attribution = { ...current, landedAt: new Date().toISOString() };
    localStorage.setItem(UTM_KEY, JSON.stringify(attribution));
  }
  const source = attribution.source || current.source || 'direct';
  const campaign = attribution.campaign || current.campaign || '';

  function track(type, extra = {}) {
    const payload = {
      type,
      visitorId,
      sessionId,
      source,
      campaign,
      path: location.pathname,
      referrer: document.referrer,
      ...extra,
    };
    fetch('/api/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {});
  }

  track('page_view');

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-track-cta]');
    if (target) track('cta_click', { label: target.dataset.trackCta || target.textContent.trim().slice(0, 40) });
  });

  let scrolled = false;
  addEventListener('scroll', () => {
    if (scrolled) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    if (max > 0 && scrollY / max >= 0.75) {
      scrolled = true;
      track('scroll_75');
    }
  }, { passive: true });

  window.BeerlaoTrack = { visitorId, sessionId, source, campaign, track };
})();


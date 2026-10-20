(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { view: 'overview', stats: null, leads: [], days: 30, source: 'all', status: 'all', busy: false };
  const sourceNames = { all: '全部来源', direct: '直接访问', douyin: '抖音', tiktok: 'TikTok', facebook: 'Facebook', instagram: 'Instagram', is: 'IS', google: 'Google', bing: 'Bing', yandex: 'Yandex', baidu: '百度', wechat: '微信', xiaohongshu: '小红书' };
  const statusNames = { new: '新线索', contacted: '已联系', quoted: '已报价', won: '已成交', lost: '已流失' };
  const titles = {
    overview: ['投放概览', 'Beerlao 老挝啤酒 · 中国区整箱咨询。访问、点击与留资均来自本页面的实际事件。'],
    leads: ['线索管理', '查看每一条留资，更新联系、报价和成交状态。'],
    sources: ['来源明细', '比较不同投放来源带来的访问、点击和留资效率。'],
  };

  const int = (value) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(Number(value) || 0);
  const pct = (value) => `${(Number(value) || 0).toFixed(1)}%`;
  const shortDate = (iso) => {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dateTime = (iso) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const sourceName = (source) => sourceNames[source] || source || '直接访问';
  const statusName = (status) => statusNames[status] || status;

  function apiUrl(path) {
    const base = new URL(location.href);
    base.username = '';
    base.password = '';
    base.pathname = '/';
    base.search = '';
    base.hash = '';
    return new URL(path, base).href;
  }

  async function api(path, options = {}) {
    const response = await fetch(apiUrl(path), { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `请求失败 (${response.status})`);
    return body;
  }

  function setView(view) {
    state.view = view;
    $$('.rail-nav button').forEach((button) => { if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    $$('[data-view-panel]').forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
    $('#page-title').textContent = titles[view][0];
    $('#page-sub').textContent = titles[view][1];
    if (view === 'leads') loadLeads();
    if (view === 'sources' && state.stats) renderSourcesTable();
  }

  function renderKpis(stats) {
    $('#kpi-visitors').textContent = int(stats.metrics.visitors);
    $('#kpi-clicks').textContent = int(stats.metrics.ctaClicks);
    $('#kpi-leads').textContent = int(stats.metrics.leads);
    $('#kpi-rate').innerHTML = `${(Number(stats.metrics.conversionRate) || 0).toFixed(1)}<small>%</small>`;
    $('#funnel-window').textContent = `最近 ${stats.range.days} 天`;
    $('#freshness').textContent = `更新于 ${dateTime(stats.updatedAt).slice(11)}`;
    $('#demo-banner').hidden = !stats.demo;
  }

  function renderFunnel(stats) {
    const visitors = Math.max(1, stats.metrics.visitors);
    const clicks = stats.metrics.ctaClicks;
    const leads = stats.metrics.leads;
    $('#funnel-visitors').style.width = stats.metrics.visitors ? '100%' : '0%';
    $('#funnel-clicks').style.width = `${Math.min(100, (clicks / visitors) * 100)}%`;
    $('#funnel-leads').style.width = `${Math.min(100, (leads / visitors) * 100)}%`;
    $('#funnel-visitors-value').textContent = int(stats.metrics.visitors);
    $('#funnel-clicks-value').textContent = int(clicks);
    $('#funnel-leads-value').textContent = int(leads);
    $('#funnel-note').textContent = stats.metrics.visitors ? '统计口径：窗口内去重访客与有效留资。' : '还没有访问数据。';
    $('#funnel-click-rate').textContent = pct(stats.metrics.clickRate);
    $('#funnel-conversion-rate').textContent = pct(stats.metrics.conversionRate);
  }

  function renderSourceList(stats) {
    const root = $('#source-list');
    if (!stats.sources.length) {
      root.innerHTML = '<div class="empty-state">还没有来源数据。</div>';
      return;
    }
    root.innerHTML = stats.sources.slice(0, 5).map((item) => `
      <div class="source-row">
        <div class="source-name"><span class="source-dot" aria-hidden="true"></span><span>${sourceName(item.source)}</span></div>
        <div class="source-stats">${int(item.visitors)} 访问 · ${int(item.leads)} 留资</div>
      </div>`).join('');
  }

  function renderCharts(stats) {
    if (!window.Charts) return;
    const labels = stats.series.map((item) => shortDate(item.date));
    Charts.line($('#visitors-chart'), {
      labels,
      series: [{ name: '访问', values: stats.series.map((item) => item.visitors) }],
      format: Charts.fmt.int,
      xAt: labels.length > 14 ? [0, Math.floor((labels.length - 1) / 3), Math.floor((labels.length - 1) * 2 / 3), labels.length - 1] : undefined,
    });
    Charts.bars($('#leads-chart'), {
      labels,
      values: stats.series.map((item) => item.leads),
      format: Charts.fmt.int,
      xAt: labels.length > 14 ? [0, Math.floor((labels.length - 1) / 3), Math.floor((labels.length - 1) * 2 / 3), labels.length - 1] : undefined,
    });
  }

  function statusSelect(lead) {
    return `<select class="status-select" data-status="${lead.status}" data-lead-status="${lead.id}" aria-label="更新 ${lead.name} 的状态">${Object.entries(statusNames).map(([value, label]) => `<option value="${value}" ${value === lead.status ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  }

  function leadRows(leads) {
    if (!leads.length) return '<tr><td colspan="6"><div class="empty-state">还没有线索。</div></td></tr>';
    return leads.map((lead) => `
      <tr>
        <td class="num">${dateTime(lead.createdAt)}</td>
        <td><div class="lead-identity"><b>${lead.name}</b><span>${lead.phoneMasked || ''}</span></div></td>
        <td class="cell-optional">${lead.city}</td>
        <td class="n">${int(lead.quantity)} 箱</td>
        <td class="cell-optional">${sourceName(lead.source)}</td>
        <td>${statusSelect(lead)}</td>
      </tr>`).join('');
  }

  function renderRecent(stats) {
    $('#recent-body').innerHTML = leadRows(stats.recentLeads);
  }

  function renderSourceFilter(stats) {
    const select = $('#source');
    const current = select.value || state.source;
    select.innerHTML = `<option value="all">全部来源</option>${stats.sources.map((item) => `<option value="${item.source}">${sourceName(item.source)}</option>`).join('')}`;
    select.value = [...select.options].some((option) => option.value === current) ? current : 'all';
    state.source = select.value;
  }

  function renderSourcesTable() {
    const stats = state.stats;
    const root = $('#sources-body');
    if (!stats || !stats.sources.length) {
      root.innerHTML = '<tr><td colspan="5"><div class="empty-state">还没有来源数据。</div></td></tr>';
      return;
    }
    root.innerHTML = stats.sources.map((item) => `
      <tr>
        <td>${sourceName(item.source)}</td>
        <td class="n">${int(item.visitors)}</td>
        <td class="n">${int(item.clicks)}</td>
        <td class="n">${int(item.leads)}</td>
        <td class="n">${pct(item.conversionRate)}</td>
      </tr>`).join('');
  }

  async function loadStats() {
    $('#freshness').textContent = '正在载入…';
    const stats = await api(`/api/stats?days=${state.days}&source=${encodeURIComponent(state.source)}`);
    state.stats = stats;
    renderKpis(stats);
    renderFunnel(stats);
    renderSourceList(stats);
    renderCharts(stats);
    renderRecent(stats);
    renderSourceFilter(stats);
    if (state.view === 'sources') renderSourcesTable();
  }

  async function loadLeads() {
    if (!state.stats) return;
    const result = await api(`/api/leads?days=${state.days}&source=${encodeURIComponent(state.source)}&status=${encodeURIComponent(state.status)}`);
    state.leads = result.leads;
    $('#leads-body').innerHTML = leadRows(result.leads);
    $('#leads-empty').hidden = result.leads.length > 0;
  }

  async function refreshAll() {
    if (state.busy) return;
    state.busy = true;
    const button = $('#refresh');
    button.disabled = true;
    button.textContent = '刷新中…';
    try {
      await loadStats();
      if (!state.stats) throw new Error('数据加载失败');
      if (state.view === 'leads') await loadLeads();
    } catch (error) {
      $('#freshness').textContent = error.message;
    } finally {
      state.busy = false;
      button.disabled = false;
      button.textContent = '刷新数据';
    }
  }

  async function seedDemo() {
    await api('/api/admin/demo', { method: 'POST', body: JSON.stringify({ action: 'seed' }) });
    await refreshAll();
  }

  async function clearDemo() {
    if (!confirm('清空当前所有演示数据？真实线索和事件不会被删除。')) return;
    await api('/api/admin/demo', { method: 'POST', body: JSON.stringify({ action: 'clear' }) });
    await refreshAll();
  }

  document.addEventListener('click', (event) => {
    const nav = event.target.closest('[data-view]');
    if (nav) setView(nav.dataset.view);
    const jump = event.target.closest('[data-view-jump]');
    if (jump) setView(jump.dataset.viewJump);
    if (event.target.closest('#refresh')) refreshAll();
    if (event.target.closest('#seed-demo')) seedDemo().catch((error) => { $('#freshness').textContent = error.message; });
    if (event.target.closest('#clear-demo')) clearDemo().catch((error) => { $('#freshness').textContent = error.message; });
  });

  document.addEventListener('change', async (event) => {
    if (event.target.id === 'range') {
      state.days = Number(event.target.value);
      await refreshAll();
    }
    if (event.target.id === 'source') {
      state.source = event.target.value;
      await refreshAll();
    }
    if (event.target.id === 'lead-status') {
      state.status = event.target.value;
      await loadLeads();
    }
    if (event.target.matches('[data-lead-status]')) {
      const select = event.target;
      try {
        await api(`/api/leads/${encodeURIComponent(select.dataset.leadStatus)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: select.value }),
        });
        select.dataset.status = select.value;
        await loadStats();
        if (state.view === 'leads') await loadLeads();
      } catch (error) {
        $('#freshness').textContent = error.message;
      }
    }
  });

  setView('overview');
  refreshAll();
})();







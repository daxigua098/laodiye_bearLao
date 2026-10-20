(() => {
  const form = document.querySelector('#lead-form');
  if (!form) return;
  const status = form.querySelector('.form-status');
  const submit = form.querySelector('button[type="submit"]');
  const success = document.querySelector('#lead-success');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.textContent = '提交中…';
    status.textContent = '';
    status.className = 'form-status';

    const data = new FormData(form);
    const track = window.BeerlaoTrack || {};
    const payload = {
      name: String(data.get('name') || ''),
      phone: String(data.get('phone') || ''),
      city: String(data.get('city') || ''),
      quantity: Number(data.get('quantity') || 1),
      consent: data.get('consent') === 'on',
      visitorId: track.visitorId || '',
      sessionId: track.sessionId || '',
      source: track.source || 'direct',
      campaign: track.campaign || '',
    };

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || '提交失败，请稍后再试');
      form.hidden = true;
      if (success) success.hidden = false;
      track.track?.('cta_click', { label: 'lead_submit_success' });
    } catch (error) {
      status.textContent = error.message || '提交失败，请稍后再试';
      status.className = 'form-status error';
      submit.disabled = false;
      submit.textContent = '提交咨询';
    }
  });
})();

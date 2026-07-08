(() => {
  'use strict';

  // Example-name placeholder — picked fresh on every page load.
  const nameInput = document.getElementById('cf-name');
  if (nameInput) {
    nameInput.placeholder = Math.random() < 0.5 ? 'John Doe' : 'Jane Doe';
  }

  // Contact form — posts JSON to the Cloudflare Worker.
  // Keep in sync with the <form action> in index.html (the no-JS fallback).
  const ENDPOINT = 'https://contact-form.jaredsburrows.workers.dev/';

  const form = document.getElementById('contact-form');
  if (!form) return;
  const submit = document.getElementById('cf-submit');
  const status = document.getElementById('cf-status');

  const setStatus = (kind, html) => {
    status.className = `form-status${kind ? ` ${kind}` : ''}`;
    status.innerHTML = html;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    submit.disabled = true;
    submit.textContent = 'Sending…';
    setStatus('', '');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        message: form.message.value.trim(),
        company: form.company.value,
      }),
      signal: controller.signal,
    }).catch(() => null);

    clearTimeout(timer);
    if (response && response.ok) {
      form.reset();
      setStatus('ok', "Message sent — thanks. I'll get back to you soon.");
    } else {
      setStatus('error',
        'Something went wrong. Email <a href="mailto:contact@burrowsapps.com">contact@burrowsapps.com</a> '
        + 'or reach out on <a href="https://www.linkedin.com/company/burrows-applications" target="_blank" rel="noopener">LinkedIn</a>.');
    }
    submit.disabled = false;
    submit.textContent = 'Send message';
  });
})();

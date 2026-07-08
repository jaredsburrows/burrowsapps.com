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

  // Inline per-field errors — JS takes over from the native bubbles;
  // without JS the `required` attributes still guard the POST fallback.
  form.noValidate = true;

  const FIELDS = ['name', 'email', 'message'];

  const messageFor = (input) => {
    if (input.validity.valueMissing) {
      if (input.name === 'name') return 'Please enter your name.';
      if (input.name === 'email') return 'Please enter your email address.';
      return 'Please enter a message.';
    }
    if (input.validity.typeMismatch || input.validity.patternMismatch) {
      return 'Please enter a valid email address.';
    }
    return input.validationMessage;
  };

  const setFieldError = (input, message) => {
    const error = document.getElementById(`${input.id}-error`);
    input.closest('.field').classList.toggle('invalid', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    error.textContent = message;
    error.hidden = !message;
  };

  const validate = () => {
    let firstInvalid = null;
    for (const name of FIELDS) {
      const input = form.elements[name];
      const message = input.validity.valid ? '' : messageFor(input);
      setFieldError(input, message);
      if (message && !firstInvalid) firstInvalid = input;
    }
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  };

  for (const name of FIELDS) {
    const input = form.elements[name];
    input.addEventListener('input', () => setFieldError(input, ''));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validate()) return;

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

(() => {
  'use strict';

  const nameInput = document.getElementById('cf-name');
  if (nameInput) {
    nameInput.placeholder = Math.random() < 0.5 ? 'John Doe' : 'Jane Doe';
  }

  const form = document.getElementById('contact-form');
  if (!form) return;

  // Single source of truth: the <form action> in index.html (also the no-JS fallback).
  const ENDPOINT = form.action;
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

  // Set while a send is in flight. The disabled button stops a second human
  // submit; this also stops the WebMCP tool, which never clicks the button.
  let sending = false;

  // Shared by the human submit handler and the WebMCP tool below.
  const send = async () => {
    sending = true;
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
    const sent = Boolean(response && response.ok);
    if (sent) {
      form.reset();
      setStatus('ok', "Message sent — thanks. I'll get back to you soon.");
    } else {
      setStatus('error',
        'Something went wrong. Email <a href="mailto:contact@burrowsapps.com">contact@burrowsapps.com</a> '
        + 'or reach out on <a href="https://linkedin.com/company/burrows-applications" target="_blank" rel="noopener">LinkedIn</a>.');
    }
    submit.disabled = false;
    submit.textContent = 'Send message';
    sending = false;
    return sent;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !validate()) return;
    await send();
  });

  // WebMCP (https://webmachinelearning.github.io/webmcp/): lets an AI agent in
  // the visitor's browser use this form as a tool. Does nothing where the API is
  // absent. document.modelContext is the current entry point; older Chrome
  // builds used navigator.modelContext.
  const runTool = async (input) => {
    // Checked before the fields are filled, so a second call cannot overwrite
    // the message that is being sent.
    if (sending) {
      return { status: 'busy', message: 'Another message is being sent. Wait for it to finish, then try again.' };
    }
    const values = input && typeof input === 'object' ? input : {};
    for (const name of FIELDS) {
      form.elements[name].value = typeof values[name] === 'string' ? values[name] : '';
    }
    const valid = validate();
    const errors = {};
    for (const name of FIELDS) {
      const field = form.elements[name];
      if (!field.validity.valid) {
        errors[name] = messageFor(field);
      } else if (field.maxLength > 0 && field.value.length > field.maxLength) {
        // maxlength is not enforced on values set from script.
        errors[name] = `Must be at most ${field.maxLength} characters.`;
        setFieldError(field, errors[name]);
      }
    }
    if (!valid || Object.keys(errors).length > 0) {
      return { status: 'invalid', message: 'The message was not sent. Fix the listed fields and try again.', errors };
    }
    return (await send())
      ? { status: 'sent', message: 'Message sent. Burrows Applications will reply to the email address provided.' }
      : { status: 'failed', message: 'The message could not be sent. Email contact@burrowsapps.com instead.' };
  };

  try {
    const modelContext = document.modelContext || navigator.modelContext;
    if (modelContext && typeof modelContext.registerTool === 'function') {
      const registration = modelContext.registerTool({
        name: 'send_contact_message',
        title: 'Send a message to Burrows Applications',
        description: 'Send a message to Burrows Applications, a mobile and web app development company, '
          + 'through the contact form on this page. Use it for project inquiries. The message is emailed '
          + 'to the owner, who replies to the email address provided.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: "The sender's name.", minLength: 1, maxLength: 200 },
            email: { type: 'string', format: 'email', description: 'Email address the reply should go to.', maxLength: 254 },
            message: { type: 'string', description: 'What the sender wants to discuss, such as the project and timeline.', minLength: 1, maxLength: 5000 },
          },
          required: ['name', 'email', 'message'],
          additionalProperties: false,
        },
        annotations: { readOnlyHint: false, consequentialHint: true },
        execute: (input) => runTool(input),
      });
      // Current spec: registerTool returns a Promise. Older builds return undefined.
      if (registration && typeof registration.catch === 'function') registration.catch(() => {});
    }
  } catch {
    // An agent API must never break the page for people.
  }
})();

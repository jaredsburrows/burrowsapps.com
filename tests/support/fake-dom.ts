// Hand-rolled stand-in for the parts of the DOM that static/js/home.js uses,
// so the browser script can run under node:vm without a dependency.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

export const HOME_JS = readFileSync(new URL("../../static/js/home.js", import.meta.url), "utf8");
export const ENDPOINT = "https://burrowsapps.com/api/contact";
// What the fake Turnstile widget puts in its hidden field until a test changes it.
export const TURNSTILE_TOKEN = "fake-turnstile-token";

// The pattern attribute on #cf-email in index.html. Browsers anchor it and
// match the whole value.
const EMAIL_PATTERN = new RegExp("^(?:[^@\\s]+@[^@\\s]+\\.[^@\\s]{2,})$", "v");
// A loose stand-in for the browser's type=email check.
const EMAIL_TYPE = /^[^@\s]+@[^@\s]+$/;

type Listener = (event: unknown) => unknown;

export type FakeValidity = {
  valueMissing: boolean;
  typeMismatch: boolean;
  patternMismatch: boolean;
  valid: boolean;
};

export type FakeField = {
  id: string;
  name: string;
  value: string;
  placeholder: string;
  maxLength: number;
  validationMessage: string;
  invalid: boolean;
  attributes: Record<string, string>;
  focused: number;
  readonly validity: FakeValidity;
  addEventListener(type: string, listener: Listener): void;
  setAttribute(name: string, value: string): void;
  focus(): void;
  closest(selector: string): { classList: { toggle(name: string, force: boolean): void } };
};

export type FakeElement = { id: string; textContent: string; innerHTML: string; className: string; disabled: boolean };

export type FetchCall = { url: string; init: { method: string; headers: Record<string, string>; body: string }; fields: Record<string, string> };

export type FetchBehavior = "ok" | "not-ok" | "reject";

export type FakeDomOptions = {
  documentModelContext?: unknown;
  navigatorModelContext?: unknown;
  // false leaves window.turnstile undefined, as before api.js has loaded.
  turnstileLoaded?: boolean;
};

export type FakeDom = {
  form: {
    action: string;
    noValidate: boolean;
    elements: Record<string, FakeField>;
    submitListeners: Listener[];
    resets: number;
  };
  fields: Record<"name" | "email" | "message" | "company", FakeField>;
  // The hidden field the Turnstile widget renders into the form.
  turnstileField: { name: string; value: string };
  // Containers passed to window.turnstile.reset, in call order.
  turnstileResets: unknown[];
  submit: FakeElement;
  status: FakeElement;
  errors: Record<string, FakeElement>;
  fetchCalls: FetchCall[];
  fetchBehavior: FetchBehavior;
  // When set, every fetch waits for this promise before it settles, so a test
  // can keep a send in flight.
  fetchGate: Promise<void> | null;
  run(): void;
  submitForm(): Promise<void>;
};

const createField = (id: string, name: string, maxLength: number, kind: "text" | "email" | "hidden"): FakeField => {
  const required = kind !== "hidden";
  const field: FakeField = {
    id,
    name,
    value: "",
    placeholder: "",
    maxLength,
    validationMessage: "",
    invalid: false,
    attributes: {},
    focused: 0,
    get validity(): FakeValidity {
      const valueMissing = required && field.value === "";
      const typeMismatch = kind === "email" && field.value !== "" && !EMAIL_TYPE.test(field.value);
      const patternMismatch = kind === "email" && field.value !== "" && !EMAIL_PATTERN.test(field.value);
      return { valueMissing, typeMismatch, patternMismatch, valid: !valueMissing && !typeMismatch && !patternMismatch };
    },
    addEventListener() {},
    setAttribute(attribute, value) {
      field.attributes[attribute] = value;
    },
    focus() {
      field.focused += 1;
    },
    closest() {
      return {
        classList: {
          toggle(_name, force) {
            field.invalid = force;
          },
        },
      };
    },
  };
  return field;
};

const createElement = (id: string): FakeElement => ({ id, textContent: "", innerHTML: "", className: "", disabled: false });

export function createFakeDom(options: FakeDomOptions = {}): FakeDom {
  const fields = {
    name: createField("cf-name", "name", 200, "text"),
    email: createField("cf-email", "email", 254, "email"),
    message: createField("cf-message", "message", 5000, "text"),
    company: createField("cf-company", "company", -1, "hidden"),
  };
  const submit = createElement("cf-submit");
  submit.textContent = "Send message";
  const status = createElement("cf-status");
  const errors: Record<string, FakeElement> = {
    "cf-name-error": createElement("cf-name-error"),
    "cf-email-error": createElement("cf-email-error"),
    "cf-message-error": createElement("cf-message-error"),
  };

  const turnstileField = { name: "cf-turnstile-response", value: TURNSTILE_TOKEN };

  const form = {
    action: ENDPOINT,
    noValidate: false,
    elements: { ...fields, "cf-turnstile-response": turnstileField } as unknown as Record<string, FakeField>,
    submitListeners: [] as Listener[],
    resets: 0,
    ...fields,
    addEventListener(type: string, listener: Listener) {
      if (type === "submit") form.submitListeners.push(listener);
    },
    reset() {
      form.resets += 1;
      for (const field of Object.values(fields)) field.value = "";
    },
  };

  const byId: Record<string, unknown> = {
    "cf-name": fields.name,
    "contact-form": form,
    "cf-submit": submit,
    "cf-status": status,
    ...errors,
  };

  const dom: FakeDom = {
    form,
    fields,
    submit,
    status,
    errors,
    turnstileField,
    turnstileResets: [],
    fetchCalls: [],
    fetchBehavior: "ok",
    fetchGate: null,
    run() {
      const document: Record<string, unknown> = { getElementById: (id: string) => byId[id] ?? null };
      if ("documentModelContext" in options) document.modelContext = options.documentModelContext;
      const navigator: Record<string, unknown> = {};
      if ("navigatorModelContext" in options) navigator.modelContext = options.navigatorModelContext;
      const fetch = async (url: string, init: FetchCall["init"]) => {
        dom.fetchCalls.push({
          url,
          init,
          fields: { name: fields.name.value, email: fields.email.value, message: fields.message.value },
        });
        if (dom.fetchGate) await dom.fetchGate;
        if (dom.fetchBehavior === "reject") throw new TypeError("Failed to fetch");
        return { ok: dom.fetchBehavior === "ok" };
      };
      const window: Record<string, unknown> = {};
      if (options.turnstileLoaded !== false) {
        window.turnstile = {
          // A reset throws the used token away and the managed widget solves a
          // new one straight after; the fake does both at once.
          reset(container: unknown) {
            dom.turnstileResets.push(container);
            turnstileField.value = `${TURNSTILE_TOKEN}-${dom.turnstileResets.length}`;
          },
        };
      }
      runInNewContext(HOME_JS, { window, document, navigator, fetch, AbortController, setTimeout, clearTimeout });
    },
    async submitForm() {
      for (const listener of form.submitListeners) await listener({ preventDefault() {} });
    },
  };
  return dom;
}

// Values from the vm context carry another realm's prototypes; a JSON round
// trip makes them comparable with assert.deepEqual.
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));

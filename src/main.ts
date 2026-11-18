import { ApiError, createApi } from './api.ts';
import type { Specialization, User } from './types.ts';
import {
  FALLBACK_SPECIALIZATIONS,
  validateLogin,
  validateProfile,
  validateRegistration,
} from './validation.ts';

type FieldElement = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
type ViewName = 'loading' | 'auth' | 'profile';
type TabName = 'login' | 'register';

// Разметка статична, поэтому отсутствие элемента — ошибка в index.html.
function $<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Элемент ${selector} не найден на странице.`);
  return el;
}

function findField(form: HTMLFormElement, name: string): FieldElement | null {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement
    ? el
    : null;
}

function field(form: HTMLFormElement, name: string): FieldElement {
  const el = findField(form, name);
  if (!el) throw new Error(`Поле ${name} не найдено в форме #${form.id}.`);
  return el;
}

const views: Record<ViewName, HTMLElement> = {
  loading: $('#view-loading'),
  auth: $('#view-auth'),
  profile: $('#view-profile'),
};
const loginForm = $<HTMLFormElement>('#login-form');
const registerForm = $<HTMLFormElement>('#register-form');
const profileForm = $<HTMLFormElement>('#profile-form');
const tabs: Record<TabName, HTMLButtonElement> = {
  login: $<HTMLButtonElement>('#tab-login'),
  register: $<HTMLButtonElement>('#tab-register'),
};

let specializations: Specialization[] = FALLBACK_SPECIALIZATIONS;

const api = createApi({
  onSessionExpired: () => {
    showAuth();
    showBanner('Сессия истекла. Войдите снова.', true);
  },
});

// ---------- Отображение ----------

function showView(name: ViewName): void {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

function showBanner(text: string, isError = false): void {
  const banner = $('#banner');
  banner.textContent = text;
  banner.classList.toggle('is-error', isError);
  banner.hidden = !text;
}

function showAuth(): void {
  $('#session').hidden = true;
  showView('auth');
}

function specializationLabel(value: string | undefined): string {
  return specializations.find((item) => item.value === value)?.label ?? '—';
}

function renderUser(user: User): void {
  const profile = user.profile ?? {};
  const displayName = profile.first_name || user.username;

  $('#session-user').textContent = `@${user.username}`;
  $('#session').hidden = false;

  $('#member-avatar').textContent = displayName.charAt(0) || '?';
  $('#profile-title').textContent = displayName;
  $('#member-username').textContent = `@${user.username}`;
  $('#member-specialization').textContent =
    profile.specialization_display || specializationLabel(profile.specialization);
  $('#member-fee').textContent = profile.fee ? `${profile.fee} ₽` : '—';

  const bio = $('#member-bio');
  bio.textContent = profile.bio || 'Пока ничего о себе не рассказал(а).';
  bio.classList.toggle('is-empty', !profile.bio);

  field(profileForm, 'firstName').value = profile.first_name ?? '';
  field(profileForm, 'specialization').value = profile.specialization ?? '';
  field(profileForm, 'fee').value = profile.fee ?? '';
  field(profileForm, 'bio').value = profile.bio ?? '';

  showView('profile');
}

function renderSpecializationOptions(): void {
  const select = field(profileForm, 'specialization') as HTMLSelectElement;
  const current = select.value;
  select.replaceChildren(
    new Option('Не выбрана', ''),
    ...specializations.map((item) => new Option(item.label, item.value)),
  );
  select.value = current;
}

// ---------- Ошибки форм ----------

// Ключи ошибок сервера (snake_case) переводим в имена полей формы.
const SERVER_FIELD_MAP: Record<string, string> = { first_name: 'firstName' };

function formErrorSlot(form: HTMLFormElement): HTMLElement {
  const slot = form.querySelector<HTMLElement>('[data-form-error]');
  if (!slot) throw new Error(`В форме #${form.id} нет блока для общей ошибки.`);
  return slot;
}

function clearErrors(form: HTMLFormElement): void {
  form.querySelectorAll('[data-error-for]').forEach((el) => (el.textContent = ''));
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  formErrorSlot(form).textContent = '';
}

function showErrors(
  form: HTMLFormElement,
  fieldErrors: Partial<Record<string, string>>,
  formError = '',
): void {
  let firstInvalid: FieldElement | null = null;
  for (const [rawKey, message] of Object.entries(fieldErrors)) {
    if (!message) continue;
    const key = SERVER_FIELD_MAP[rawKey] ?? rawKey;
    const slot = form.querySelector(`[data-error-for="${CSS.escape(key)}"]`);
    const input = findField(form, key);
    if (!slot || !input) {
      formError = [formError, message].filter(Boolean).join(' ');
      continue;
    }
    slot.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    firstInvalid ??= input;
  }
  formErrorSlot(form).textContent = formError;
  firstInvalid?.focus();
}

// Блокирует кнопку на время запроса, чтобы не было повторной отправки.
async function withPending(form: HTMLFormElement, pendingText: string, action: () => Promise<void>): Promise<void> {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (!button || button.disabled) return;
  const idleText = button.textContent;
  button.disabled = true;
  button.textContent = pendingText;
  try {
    await action();
  } catch (err) {
    showErrors(form, err instanceof ApiError ? err.fieldErrors : {}, err instanceof Error ? err.message : '');
  } finally {
    button.disabled = false;
    button.textContent = idleText;
  }
}

// ---------- Вкладки ----------

function selectTab(name: TabName, focus = false): void {
  for (const [key, tab] of Object.entries(tabs)) {
    const active = key === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  loginForm.hidden = name !== 'login';
  registerForm.hidden = name !== 'register';
  if (focus) tabs[name].focus();
}

tabs.login.addEventListener('click', () => selectTab('login'));
tabs.register.addEventListener('click', () => selectTab('register'));
$('[role="tablist"]').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  selectTab(tabs.login.getAttribute('aria-selected') === 'true' ? 'register' : 'login', true);
});

// ---------- Обработчики ----------

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearErrors(loginForm);
  showBanner('');
  const values = {
    username: field(loginForm, 'username').value.trim(),
    password: field(loginForm, 'password').value,
  };
  const errors = validateLogin(values);
  if (Object.keys(errors).length) return showErrors(loginForm, errors);

  void withPending(loginForm, 'Входим…', async () => {
    const user = await api.login(values.username, values.password);
    loginForm.reset();
    renderUser(user);
  });
});

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearErrors(registerForm);
  showBanner('');
  const values = {
    username: field(registerForm, 'username').value.trim(),
    password: field(registerForm, 'password').value,
    passwordConfirm: field(registerForm, 'passwordConfirm').value,
  };
  const errors = validateRegistration(values);
  if (Object.keys(errors).length) return showErrors(registerForm, errors);

  void withPending(registerForm, 'Создаём аккаунт…', async () => {
    const user = await api.register(values.username, values.password);
    registerForm.reset();
    renderUser(user);
    showBanner('Аккаунт создан. Заполните профиль участника.');
  });
});

profileForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearErrors(profileForm);
  showBanner('');
  const { errors, payload } = validateProfile(
    {
      firstName: field(profileForm, 'firstName').value,
      specialization: field(profileForm, 'specialization').value,
      bio: field(profileForm, 'bio').value,
      fee: field(profileForm, 'fee').value,
    },
    specializations,
  );
  if (Object.keys(errors).length) return showErrors(profileForm, errors);

  void withPending(profileForm, 'Сохраняем…', async () => {
    const user = await api.updateProfile(payload);
    renderUser(user);
    showBanner('Профиль сохранён.');
  });
});

const logoutButton = $<HTMLButtonElement>('#logout-btn');
logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  await api.logout();
  logoutButton.disabled = false;
  showBanner('Вы вышли из аккаунта.');
  selectTab('login');
  showAuth();
});

// ---------- Старт ----------

async function loadSpecializations(): Promise<void> {
  try {
    const list = await api.getSpecializations();
    if (list.length) specializations = list;
  } catch {
    // Список встроен в код как запасной вариант, поэтому страница работает и без него.
  }
  renderSpecializationOptions();
}

async function start(): Promise<void> {
  renderSpecializationOptions();
  const specializationsLoaded = loadSpecializations();
  try {
    const user = await api.restoreSession();
    await specializationsLoaded;
    if (user) renderUser(user);
    else showAuth();
  } catch (err) {
    showAuth();
    showBanner(err instanceof Error ? err.message : 'Не удалось загрузить страницу.', true);
  }
}

void start();

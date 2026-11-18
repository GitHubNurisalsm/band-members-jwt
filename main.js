import { createApi } from './api.js';
import {
  FALLBACK_SPECIALIZATIONS,
  validateLogin,
  validateProfile,
  validateRegistration,
} from './validation.js';

const $ = (selector) => document.querySelector(selector);

const views = {
  loading: $('#view-loading'),
  auth: $('#view-auth'),
  profile: $('#view-profile'),
};
const loginForm = $('#login-form');
const registerForm = $('#register-form');
const profileForm = $('#profile-form');
const tabs = { login: $('#tab-login'), register: $('#tab-register') };

let specializations = FALLBACK_SPECIALIZATIONS;

const api = createApi({
  onSessionExpired: () => {
    showAuth();
    showBanner('Сессия истекла. Войдите снова.', true);
  },
});

// ---------- Отображение ----------

function showView(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
}

function showBanner(text, isError = false) {
  const banner = $('#banner');
  banner.textContent = text;
  banner.classList.toggle('is-error', isError);
  banner.hidden = !text;
}

function showAuth() {
  $('#session').hidden = true;
  showView('auth');
}

function specializationLabel(value) {
  return specializations.find((item) => item.value === value)?.label ?? '—';
}

function renderUser(user) {
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

  profileForm.elements.firstName.value = profile.first_name ?? '';
  profileForm.elements.specialization.value = profile.specialization ?? '';
  profileForm.elements.fee.value = profile.fee ?? '';
  profileForm.elements.bio.value = profile.bio ?? '';

  showView('profile');
}

function renderSpecializationOptions() {
  const select = profileForm.elements.specialization;
  const current = select.value;
  select.replaceChildren(
    new Option('Не выбрана', ''),
    ...specializations.map((item) => new Option(item.label, item.value)),
  );
  select.value = current;
}

// ---------- Ошибки форм ----------

// Ключи ошибок сервера (snake_case) переводим в имена полей формы.
const SERVER_FIELD_MAP = { first_name: 'firstName' };

function clearErrors(form) {
  form.querySelectorAll('[data-error-for]').forEach((el) => (el.textContent = ''));
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelector('[data-form-error]').textContent = '';
}

function showErrors(form, fieldErrors, formError = '') {
  let firstInvalid = null;
  for (const [rawKey, message] of Object.entries(fieldErrors)) {
    const key = SERVER_FIELD_MAP[rawKey] ?? rawKey;
    const slot = form.querySelector(`[data-error-for="${key}"]`);
    const input = form.elements[key];
    if (!slot || !input) {
      formError = [formError, message].filter(Boolean).join(' ');
      continue;
    }
    slot.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    firstInvalid ??= input;
  }
  form.querySelector('[data-form-error]').textContent = formError;
  firstInvalid?.focus();
}

// Блокирует кнопку на время запроса, чтобы не было повторной отправки.
async function withPending(form, pendingText, action) {
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const idleText = button.textContent;
  button.disabled = true;
  button.textContent = pendingText;
  try {
    await action();
  } catch (err) {
    showErrors(form, err.fieldErrors ?? {}, err.message);
  } finally {
    button.disabled = false;
    button.textContent = idleText;
  }
}

// ---------- Вкладки ----------

function selectTab(name, focus = false) {
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
    username: loginForm.elements.username.value.trim(),
    password: loginForm.elements.password.value,
  };
  const errors = validateLogin(values);
  if (Object.keys(errors).length) return showErrors(loginForm, errors);

  return withPending(loginForm, 'Входим…', async () => {
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
    username: registerForm.elements.username.value.trim(),
    password: registerForm.elements.password.value,
    passwordConfirm: registerForm.elements.passwordConfirm.value,
  };
  const errors = validateRegistration(values);
  if (Object.keys(errors).length) return showErrors(registerForm, errors);

  return withPending(registerForm, 'Создаём аккаунт…', async () => {
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
      firstName: profileForm.elements.firstName.value,
      specialization: profileForm.elements.specialization.value,
      bio: profileForm.elements.bio.value,
      fee: profileForm.elements.fee.value,
    },
    specializations,
  );
  if (Object.keys(errors).length) return showErrors(profileForm, errors);

  return withPending(profileForm, 'Сохраняем…', async () => {
    const user = await api.updateProfile(payload);
    renderUser(user);
    showBanner('Профиль сохранён.');
  });
});

$('#logout-btn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  await api.logout();
  button.disabled = false;
  showBanner('Вы вышли из аккаунта.');
  selectTab('login');
  showAuth();
});

// ---------- Старт ----------

async function loadSpecializations() {
  try {
    const list = await api.getSpecializations();
    if (list.length) specializations = list;
  } catch {
    // Список встроен в код как запасной вариант, поэтому страница работает и без него.
  }
  renderSpecializationOptions();
}

async function start() {
  renderSpecializationOptions();
  const specializationsLoaded = loadSpecializations();
  try {
    const user = await api.restoreSession();
    await specializationsLoaded;
    if (user) renderUser(user);
    else showAuth();
  } catch (err) {
    showAuth();
    showBanner(err.message, true);
  }
}

start();

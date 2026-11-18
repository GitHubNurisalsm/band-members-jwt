// Клиент Band Members API с JWT.
// access-токен хранится только в памяти (не в localStorage), чтобы XSS не мог
// украсть долгоживущую сессию. refresh-токен лежит в HttpOnly cookie, его
// ставит и читает сервер, а JS его не видит.

export const API_BASE = 'https://inai-col3.fishrungames.com/api';

export class ApiError extends Error {
  constructor(status, data) {
    super(extractMessage(status, data));
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.fieldErrors = extractFieldErrors(data);
  }
}

function extractMessage(status, data) {
  if (status === 0) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (data && typeof data.detail === 'string') return data.detail;
  if (data && Array.isArray(data.non_field_errors)) return data.non_field_errors.join(' ');
  if (data && typeof data === 'object' && Object.keys(extractFieldErrors(data)).length) {
    return 'Проверьте поля формы.';
  }
  if (status >= 500) return 'Ошибка сервера. Попробуйте позже.';
  return `Запрос не выполнен (код ${status}).`;
}

// DRF отдаёт ошибки полей в виде { field: ["msg", ...] }.
function extractFieldErrors(data) {
  const result = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return result;
  for (const [key, value] of Object.entries(data)) {
    if (key === 'detail' || key === 'non_field_errors') continue;
    if (Array.isArray(value)) result[key] = value.join(' ');
    else if (typeof value === 'string') result[key] = value;
    else if (value && typeof value === 'object') Object.assign(result, extractFieldErrors(value));
  }
  return result;
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Не JSON: например, HTML-страница ошибки nginx. Показывать её пользователю
    // нельзя, текст ошибки возьмётся из HTTP-статуса.
    return null;
  }
}

export function createApi({
  baseUrl = API_BASE,
  fetchImpl = (...args) => globalThis.fetch(...args),
  onSessionExpired = () => {},
} = {}) {
  let accessToken = null;
  let refreshPromise = null;

  async function send(path, { method = 'GET', body, withAuth = false } = {}) {
    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let res;
    try {
      res = await fetchImpl(baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Без этого браузер не отправит и не сохранит cookie с refresh-токеном.
        credentials: 'include',
      });
    } catch {
      throw new ApiError(0, null);
    }
    return { res, data: await parseBody(res) };
  }

  // Несколько запросов могут одновременно получить 401. Тогда выполняется
  // только один refresh, остальные ждут его результат.
  function refresh() {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const { res, data } = await send('/token/refresh/', { method: 'POST' });
        if (!res.ok || !data || typeof data.access !== 'string') {
          accessToken = null;
          throw new ApiError(res.status, data);
        }
        accessToken = data.access;
        return accessToken;
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  async function refreshOrExpire() {
    try {
      await refresh();
    } catch (err) {
      if (err.status === 401 || err.status === 403) onSessionExpired();
      throw err;
    }
  }

  // Запрос с access-токеном: при 401 один раз обновляем токен и повторяем.
  async function authed(path, options = {}) {
    if (!accessToken) await refreshOrExpire();

    let { res, data } = await send(path, { ...options, withAuth: true });
    if (res.status === 401) {
      await refreshOrExpire();
      ({ res, data } = await send(path, { ...options, withAuth: true }));
      if (res.status === 401) {
        accessToken = null;
        onSessionExpired();
      }
    }
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  }

  async function authenticate(path, username, password) {
    const { res, data } = await send(path, { method: 'POST', body: { username, password } });
    if (!res.ok || !data || typeof data.access !== 'string') throw new ApiError(res.status, data);
    accessToken = data.access;
    return data.user ?? (await authed('/profile/'));
  }

  return {
    register: (username, password) => authenticate('/register/', username, password),
    login: (username, password) => authenticate('/login/', username, password),

    // Вызывается при загрузке страницы: если cookie с refresh-токеном ещё
    // действует, восстанавливаем сессию без повторного ввода пароля.
    async restoreSession() {
      try {
        await refresh();
      } catch (err) {
        if (err.status === 401 || err.status === 403) return null;
        throw err;
      }
      return authed('/profile/');
    },

    getProfile: () => authed('/profile/'),
    updateProfile: (fields) => authed('/profile/', { method: 'PATCH', body: fields }),

    async getSpecializations() {
      const { res, data } = await send('/specializations/');
      if (!res.ok || !Array.isArray(data)) throw new ApiError(res.status, data);
      return data;
    },

    // Локальный выход выполняется всегда, даже если сервер недоступен.
    async logout() {
      try {
        await send('/logout/', { method: 'POST', withAuth: true });
      } catch {
        // Сеть недоступна: cookie останется до истечения срока, но в этой
        // вкладке access-токен всё равно удаляется.
      } finally {
        accessToken = null;
      }
    },

    isAuthenticated: () => accessToken !== null,
  };
}

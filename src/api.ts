// Клиент Band Members API с JWT.
// access-токен хранится только в памяти (не в localStorage), чтобы XSS не мог
// украсть долгоживущую сессию. refresh-токен лежит в HttpOnly cookie, его
// ставит и читает сервер, а JS его не видит.

import type { FieldErrors, ProfileUpdate, Specialization, User } from './types.ts';

export const API_BASE = 'https://inai-col3.fishrungames.com/api';

export type FetchImpl = (url: string, init: RequestInit) => Promise<Response>;

export interface ApiOptions {
  baseUrl?: string;
  fetchImpl?: FetchImpl;
  onSessionExpired?: () => void;
}

interface SendOptions {
  method?: string;
  body?: unknown;
  withAuth?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly fieldErrors: FieldErrors;

  constructor(status: number, data: unknown) {
    super(extractMessage(status, data));
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
    this.fieldErrors = extractFieldErrors(data);
  }
}

function extractMessage(status: number, data: unknown): string {
  if (status === 0) return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  if (isRecord(data) && typeof data.detail === 'string') return data.detail;
  if (isRecord(data) && Array.isArray(data.non_field_errors)) return data.non_field_errors.join(' ');
  if (Object.keys(extractFieldErrors(data)).length) return 'Проверьте поля формы.';
  if (status >= 500) return 'Ошибка сервера. Попробуйте позже.';
  return `Запрос не выполнен (код ${status}).`;
}

// DRF отдаёт ошибки полей в виде { field: ["msg", ...] }.
function extractFieldErrors(data: unknown): FieldErrors {
  const result: FieldErrors = {};
  if (!isRecord(data)) return result;
  for (const [key, value] of Object.entries(data)) {
    if (key === 'detail' || key === 'non_field_errors') continue;
    if (Array.isArray(value)) result[key] = value.join(' ');
    else if (typeof value === 'string') result[key] = value;
    else if (isRecord(value)) Object.assign(result, extractFieldErrors(value));
  }
  return result;
}

async function parseBody(res: Response): Promise<unknown> {
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

function isAuthFailure(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 401 || err.status === 403);
}

export function createApi({
  baseUrl = API_BASE,
  fetchImpl = (url, init) => globalThis.fetch(url, init),
  onSessionExpired = () => {},
}: ApiOptions = {}) {
  let accessToken: string | null = null;
  let refreshPromise: Promise<string> | null = null;

  async function send(
    path: string,
    { method = 'GET', body, withAuth = false }: SendOptions = {},
  ): Promise<{ res: Response; data: unknown }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let res: Response;
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
  function refresh(): Promise<string> {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const { res, data } = await send('/token/refresh/', { method: 'POST' });
        if (!res.ok || !isRecord(data) || typeof data.access !== 'string') {
          accessToken = null;
          throw new ApiError(res.status, data);
        }
        accessToken = data.access;
        return data.access;
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  async function refreshOrExpire(): Promise<void> {
    try {
      await refresh();
    } catch (err) {
      if (isAuthFailure(err)) onSessionExpired();
      throw err;
    }
  }

  // Запрос с access-токеном: при 401 один раз обновляем токен и повторяем.
  // Форма ответа на клиенте не проверяется: тип T — это ожидание по схеме API.
  async function authed<T>(path: string, options: SendOptions = {}): Promise<T> {
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
    return data as T;
  }

  async function authenticate(path: string, username: string, password: string): Promise<User> {
    const { res, data } = await send(path, { method: 'POST', body: { username, password } });
    if (!res.ok || !isRecord(data) || typeof data.access !== 'string') throw new ApiError(res.status, data);
    accessToken = data.access;
    return (data.user as User | undefined) ?? (await authed<User>('/profile/'));
  }

  return {
    register: (username: string, password: string) => authenticate('/register/', username, password),
    login: (username: string, password: string) => authenticate('/login/', username, password),

    // Вызывается при загрузке страницы: если cookie с refresh-токеном ещё
    // действует, восстанавливаем сессию без повторного ввода пароля.
    async restoreSession(): Promise<User | null> {
      try {
        await refresh();
      } catch (err) {
        if (isAuthFailure(err)) return null;
        throw err;
      }
      return authed<User>('/profile/');
    },

    getProfile: () => authed<User>('/profile/'),
    updateProfile: (fields: ProfileUpdate) => authed<User>('/profile/', { method: 'PATCH', body: fields }),

    async getSpecializations(): Promise<Specialization[]> {
      const { res, data } = await send('/specializations/');
      if (!res.ok || !Array.isArray(data)) throw new ApiError(res.status, data);
      return data as Specialization[];
    },

    // Локальный выход выполняется всегда, даже если сервер недоступен.
    async logout(): Promise<void> {
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

export type Api = ReturnType<typeof createApi>;

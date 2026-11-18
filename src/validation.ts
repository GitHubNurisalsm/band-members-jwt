// Клиентская валидация повторяет ограничения из OpenAPI-схемы бекенда.
// Это нужно только для удобства пользователя: окончательно данные проверяет сервер.

import type { ProfileUpdate, Specialization } from './types.ts';

export const USERNAME_MAX = 150;
export const PASSWORD_MIN = 6;
export const FIRST_NAME_MAX = 100;

// В Django \w работает с Unicode, поэтому разрешаем буквы любого алфавита.
const USERNAME_RE = /^[\p{L}\p{N}_.@+-]+$/u;
// Ставка (fee) — decimal(10, 2): до 8 цифр до точки и до 2 после. Отрицательной быть не может.
const FEE_RE = /^\d{1,8}(?:[.,]\d{1,2})?$/;

export const FALLBACK_SPECIALIZATIONS: Specialization[] = [
  { value: 'vocals', label: 'Вокал' },
  { value: 'guitar', label: 'Гитара' },
  { value: 'bass', label: 'Бас-гитара' },
  { value: 'drums', label: 'Ударные' },
  { value: 'keys', label: 'Клавишные' },
  { value: 'other', label: 'Другое' },
];

export interface LoginValues {
  username: string;
  password: string;
}

export interface RegistrationValues extends LoginValues {
  passwordConfirm: string;
}

export interface ProfileFormValues {
  firstName: string;
  specialization: string;
  bio: string;
  fee: string;
}

// Ключи совпадают с атрибутом name полей формы.
export type FormErrors<T> = Partial<Record<keyof T, string>>;

export function validateUsername(username: string): string | null {
  const value = username.trim();
  if (!value) return 'Введите имя пользователя.';
  if (value.length > USERNAME_MAX) return `Не больше ${USERNAME_MAX} символов.`;
  if (!USERNAME_RE.test(value)) return 'Только буквы, цифры и символы @ . + - _';
  return null;
}

export function validateLogin({ username, password }: LoginValues): FormErrors<LoginValues> {
  const errors: FormErrors<LoginValues> = {};
  if (!username.trim()) errors.username = 'Введите имя пользователя.';
  if (!password) errors.password = 'Введите пароль.';
  return errors;
}

export function validateRegistration({
  username,
  password,
  passwordConfirm,
}: RegistrationValues): FormErrors<RegistrationValues> {
  const errors: FormErrors<RegistrationValues> = {};
  const usernameError = validateUsername(username);
  if (usernameError) errors.username = usernameError;
  if (password.length < PASSWORD_MIN) errors.password = `Минимум ${PASSWORD_MIN} символов.`;
  if (password !== passwordConfirm) errors.passwordConfirm = 'Пароли не совпадают.';
  return errors;
}

// Возвращает { errors, payload }. В payload попадают только корректные поля в
// формате, который ожидает PATCH /api/profile/.
export function validateProfile(
  { firstName, specialization, bio, fee }: ProfileFormValues,
  allowedSpecializations: readonly Specialization[],
): { errors: FormErrors<ProfileFormValues>; payload: ProfileUpdate } {
  const errors: FormErrors<ProfileFormValues> = {};
  const payload: ProfileUpdate = {};

  const name = firstName.trim();
  if (name.length > FIRST_NAME_MAX) errors.firstName = `Не больше ${FIRST_NAME_MAX} символов.`;
  else payload.first_name = name;

  if (specialization) {
    const allowed = allowedSpecializations.map((item) => item.value);
    if (!allowed.includes(specialization)) errors.specialization = 'Выберите специализацию из списка.';
    else payload.specialization = specialization;
  }

  payload.bio = bio.trim();

  const feeValue = fee.trim();
  if (feeValue) {
    if (!FEE_RE.test(feeValue)) errors.fee = 'Число ≥ 0, до 8 цифр и до 2 знаков после точки.';
    else payload.fee = feeValue.replace(',', '.');
  }

  return { errors, payload };
}

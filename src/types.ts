// Формы данных Band Members API в том виде, в котором их использует фронтенд.
// Сервер присылает JSON без проверки схемы на клиенте, поэтому поля, которых
// может не быть в ответе, помечены как необязательные.

export interface Specialization {
  value: string;
  label: string;
}

export interface Profile {
  first_name?: string;
  specialization?: string;
  specialization_display?: string;
  bio?: string;
  fee?: string | null;
}

export interface User {
  id: number;
  username: string;
  profile?: Profile;
}

// Тело PATCH /api/profile/.
export interface ProfileUpdate {
  first_name?: string;
  specialization?: string;
  bio?: string;
  fee?: string;
}

export type FieldErrors = Record<string, string>;

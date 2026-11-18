import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_SPECIALIZATIONS,
  validateLogin,
  validateProfile,
  validateRegistration,
  validateUsername,
} from '../validation.js';

const profile = (overrides = {}) => ({ firstName: '', specialization: '', bio: '', fee: '', ...overrides });

test('username: допустимые символы как в Django, включая кириллицу', () => {
  assert.equal(validateUsername('brian.may+1@queen_-'), null);
  assert.equal(validateUsername('Фредди'), null);
  assert.match(validateUsername('john deacon'), /Только/);
  assert.match(validateUsername('   '), /Введите/);
  assert.equal(validateUsername('a'.repeat(150)), null);
  assert.match(validateUsername('a'.repeat(151)), /150/);
});

test('регистрация: пароль минимум 6 символов и совпадение подтверждения', () => {
  assert.deepEqual(validateRegistration({ username: 'roger', password: '123456', passwordConfirm: '123456' }), {});
  const errors = validateRegistration({ username: 'roger', password: '12345', passwordConfirm: '54321' });
  assert.ok(errors.password);
  assert.ok(errors.passwordConfirm);
});

test('вход: пустые поля', () => {
  assert.deepEqual(Object.keys(validateLogin({ username: ' ', password: '' })).sort(), ['password', 'username']);
});

test('профиль: пустая ставка не отправляется, остальные поля обрезаются', () => {
  const { errors, payload } = validateProfile(
    profile({ firstName: '  Брайан ', specialization: 'guitar', bio: ' соло ' }),
    FALLBACK_SPECIALIZATIONS,
  );
  assert.deepEqual(errors, {});
  assert.deepEqual(payload, { first_name: 'Брайан', specialization: 'guitar', bio: 'соло' });
});

test('профиль: ставка decimal(10,2), запятая заменяется точкой', () => {
  const ok = (fee) => validateProfile(profile({ fee }), FALLBACK_SPECIALIZATIONS);
  assert.equal(ok('1500').payload.fee, '1500');
  assert.equal(ok('1500,5').payload.fee, '1500.5');
  assert.equal(ok('99999999.99').payload.fee, '99999999.99');
  for (const bad of ['-10', '1.234', '123456789', 'abc', '1e3']) {
    assert.ok(ok(bad).errors.fee, `должно быть отклонено: ${bad}`);
  }
});

test('профиль: имя не длиннее 100 символов, специализация только из списка', () => {
  const { errors } = validateProfile(
    profile({ firstName: 'x'.repeat(101), specialization: 'triangle' }),
    FALLBACK_SPECIALIZATIONS,
  );
  assert.ok(errors.firstName);
  assert.ok(errors.specialization);
});

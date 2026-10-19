import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import app from '../src/app.js';
import User from '../src/models/User.js';
import AuditLog from '../src/models/AuditLog.js';
import { login } from '../src/controllers/authController.js';
import { env } from '../src/config/env.js';
import { provisionedUser } from '../src/services/accountProvisioningService.js';
const chain = value => ({ select() { return this; }, then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } });
const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test('Faculty provisioned credentials, conservative recommendation, equivalent denials and safe audits', async () => {
  const originals = [User.findOne, User.findById, AuditLog.create];
  let user, queries = [], events = [];
  User.findOne = query => { queries.push(query); return chain(user); };
  User.findById = () => chain(user);
  AuditLog.create = async event => { events.push(event); return event; };
  const attempt = async (password, identifier = ' FACULTY@HAU.EDU.PH ') => { const res = response(); await login({ params: { role: 'faculty' }, body: { identifier, password } }, res); return res; };
  try {
    for (const source of ['csv', 'manual']) {
      user = (await provisionedUser({ valid: true, role: 'faculty', institutional_id: '123-abc', first_name: 'Ana', last_name: 'Reyes', middle_name: '', official_email: 'faculty@hau.edu.ph' }, { source, creator: new mongoose.Types.ObjectId() })).toObject();
      user.id = String(user._id);
      const success = await attempt('123-abc');
      assert.equal(success.statusCode, 200); assert.equal(success.body.recommendPasswordChange, true);
      assert.deepEqual(queries.at(-1), { email: 'faculty@hau.edu.ph' });
      const payload = jwt.verify(success.body.token, env.jwtSecret);
      assert.equal(payload.exp - payload.iat, 8 * 60 * 60); assert.deepEqual(Object.keys(payload).sort(), ['exp', 'iat', 'sub']);
      assert.equal(events.at(-1).action, 'login');
      assert.equal(success.body.user.institutionalId, undefined); assert.equal(success.body.user.password, undefined);
    }
    const denied = async password => {
      const result = await attempt(password); assert.equal(result.statusCode, 401);
      assert.deepEqual(result.body, { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.' });
      assert.equal(events.at(-1).action, 'login_failed'); assert.equal(events.at(-1).actorRole, 'system');
      assert.deepEqual(events.at(-1).metadata, { role: 'faculty' });
      assert.doesNotMatch(JSON.stringify(events.at(-1)), /123-abc|faculty@|hash|password|token/i);
    };
    await denied('wrong'); await denied(' 123-abc');
    for (const role of ['student', 'dean']) { user.role = role; await denied('123-abc'); } user.role = 'faculty';
    for (const status of ['Inactive', 'Disabled', undefined]) { user.accountStatus = status; await denied('123-abc'); } user.accountStatus = 'Active';
    for (const state of ['Pending', 'Rejected', 'unknown']) { user.registrationStatus = state; await denied('123-abc'); }
    for (const state of [null, undefined, 'Approved']) { user.registrationStatus = state; assert.equal((await attempt('123-abc')).statusCode, 200); }
    user.accountSource = 'self_registration'; assert.equal((await attempt('123-abc')).body.recommendPasswordChange, false);
    user.passwordResetAt = new Date(); user.passwordChangedAt = user.passwordResetAt;
    assert.equal((await attempt('123-abc')).body.recommendPasswordChange, true);
    user.institutionalId = ' invalid '; assert.equal((await attempt('123-abc')).body.recommendPasswordChange, false);
    user.institutionalId = '123-abc'; user.password = await bcrypt.hash(' exact password ', 4);
    assert.equal((await attempt(' exact password ')).body.recommendPasswordChange, false); await denied('exact password');
    user = null; await denied('wrong'); await denied({});
  } finally { [User.findOne, User.findById, AuditLog.create] = originals; }
});

test('Faculty HTTP safety, refresh without bcrypt, logout and unchanged Student errors', async () => {
  const originals = [User.findOne, User.findById, AuditLog.create, bcrypt.compare];
  const id = new mongoose.Types.ObjectId();
  const user = { _id: id, id: String(id), role: 'faculty', accountStatus: 'Active' };
  const events = [];
  User.findOne = () => chain(null); User.findById = () => chain(user); AuditLog.create = async event => { events.push(event); };
  bcrypt.compare = () => { throw new Error('Unexpected refresh comparison'); };
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/auth`;
  const request = (path, method = 'POST', body = '{}', token) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Connection: 'close', ...(token && { Authorization: `Bearer ${token}` }) }, ...(method !== 'GET' && { body }) });
  try {
    for (const body of ['{}', '{"password":"SECRET"', JSON.stringify({ password: 'SECRET', identifier: 'unknown' })]) {
      const res = await request('/login/faculty', 'POST', body); assert.ok([400, 401].includes(res.status)); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.doesNotMatch(await res.text(), /SECRET/);
    }
    User.findOne = () => { throw new Error('PRIVATE_DATABASE_DETAIL'); };
    let res = await request('/login/faculty', 'POST', '{"identifier":"x","password":"SECRET"}'); assert.equal(res.status, 503); assert.doesNotMatch(await res.text(), /PRIVATE|SECRET/);
    User.findOne = () => chain(null);
    res = await request('/login/student', 'POST', '{"identifier":"x","password":"x"}'); assert.equal(res.status, 404); assert.match((await res.json()).message, /No Student account/);
    const token = jwt.sign({ sub: String(id) }, env.jwtSecret);
    res = await request('/me', 'GET', undefined, token); assert.equal(res.status, 200); assert.equal((await res.json()).recommendPasswordChange, undefined);
    res = await request('/logout', 'POST', '{}', token); assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store'); assert.equal(events.at(-1).action, 'logout');
    for (let i = 0; i < 46; i++) await request('/login/faculty');
    res = await request('/login/faculty'); assert.equal(res.status, 429); assert.equal(res.headers.get('cache-control'), 'no-store');
  } finally { await new Promise(resolve => server.close(resolve)); [User.findOne, User.findById, AuditLog.create, bcrypt.compare] = originals; }
});

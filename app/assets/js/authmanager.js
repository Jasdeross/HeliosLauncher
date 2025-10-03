/**
 * AuthManager (Custom Only)
 *
 * Этот модуль реализует авторизацию через твой backend:
 *   POST /api/auth/register  {username, password, email?}
 *   POST /api/auth/login     {username, password, device?}
 *   GET  /api/auth/me        (Authorization: Bearer <access>)
 *   POST /api/auth/refresh   {refresh}
 *   POST /api/auth/logout    {refresh}
 *
 * Данные аккаунта храним в ConfigManager как type: 'custom' с access/refresh токенами.
 *
 * @module authmanager
 */

// Requirements
const ConfigManager   = require('./configmanager')
const { LoggerUtil }  = require('helios-core')
const Lang            = require('./langloader')
const crypto          = require('crypto')

const log = LoggerUtil.getLogger('AuthManager')

// --------------------------------- Helpers ---------------------------------

function apiBase(){
    // адрес бэкенда берём из конфига
    return ConfigManager.getAuthAPI ? ConfigManager.getAuthAPI() : 'http://localhost:5000'
}

async function api(path, method = 'GET', body = null, token = null){
    const headers = { 'Content-Type': 'application/json' }
    if(token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${apiBase()}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    })
    let data = {}
    try { data = await res.json() } catch { /* ignore non-json */ }
    if(!res.ok){
        const msg = data?.error || `HTTP ${res.status}`
        throw new Error(msg)
    }
    return data
}

/**
 * Offline UUID в стиле ваниллы (OfflinePlayer:NAME → md5 → UUID)
 * @param {string} name
 * @returns {string}
 */
function offlineUUID(name){
    const md5 = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest('hex')
    return `${md5.substr(0,8)}-${md5.substr(8,4)}-${md5.substr(12,4)}-${md5.substr(16,4)}-${md5.substr(20)}`
}

// --------------------------------- API calls ---------------------------------

async function apiRegister(username, password, email = null){
    return api('/api/auth/register', 'POST', { username, password, email })
}

async function apiLogin(username, password){
    return api('/api/auth/login', 'POST', { username, password, device: 'Helios-Launcher' })
}

async function apiMe(access){
    return api('/api/auth/me', 'GET', null, access)
}

async function apiRefresh(refresh){
    return api('/api/auth/refresh', 'POST', { refresh })
}

async function apiLogout(refresh){
    // не обязательно звать при локальном выходе, но оставим
    try { await api('/api/auth/logout', 'POST', { refresh }) } catch { /* swallow */ }
}

// ------------------------------- Public API ---------------------------------

/**
 * Зарегистрировать пользователя на твоём бэкенде.
 * @param {string} username
 * @param {string} password
 * @param {string|null} email
 * @returns {Promise<void>}
 */
exports.registerAccount = async function(username, password, email = null){
    if(!username || !password){
        throw new Error(Lang?.queryJS?.('auth.custom.error.missingCreds') || 'Введите логин и пароль.')
    }
    await apiRegister(username.trim(), password, email?.trim() || null)
}

/**
 * Залогинить пользователя и сохранить аккаунт (type: 'custom') в конфиг.
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Object>} сохранённый аккаунт
 */
exports.addCustomAccount = async function(username, password){
    if(!username || !password){
        throw new Error(Lang?.queryJS?.('auth.custom.error.missingCreds') || 'Введите логин и пароль.')
    }
    const { access, refresh, user } = await apiLogin(username.trim(), password)
    const nick = user?.username || username.trim()
    const uuid = offlineUUID(nick)

    const acc = ConfigManager.addCustomAuthAccount(uuid, access, refresh, nick)
    // clientToken Mojang нам не нужен — пропускаем
    ConfigManager.save()
    return acc
}

/**
 * Удалить аккаунт локально (и опционально отписать refresh на сервере).
 * @param {string} uuid
 * @returns {Promise<void>}
 */
exports.removeAccount = async function(uuid){
    try{
        const acc = ConfigManager.getAuthAccount(uuid)
        if(acc?.refreshToken){
            await apiLogout(acc.refreshToken)
        }
    }catch(e){
        log.warn('Logout request failed (ignored):', e.message)
    }
    ConfigManager.removeAuthAccount(uuid)
    ConfigManager.save()
}

/**
 * Обновить access токен, если он протух (через refresh).
 * Обновлённый токен сохраняется в конфиг.
 * @returns {Promise<boolean>} true, если токен валиден/обновлён; false, если не удалось.
 */
async function ensureSelectedAccess(){
    const current = ConfigManager.getSelectedAccount()
    if(!current || current.type !== 'custom'){
        return false
    }
    // 1) Пытаемся проверить access.
    try{
        await apiMe(current.accessToken)
        return true
    }catch(e){
        // 2) Пытаемся обновить через refresh.
        if(!current.refreshToken){
            log.info('No refresh token, re-login required.')
            return false
        }
        try{
            const ref = await apiRefresh(current.refreshToken)
            ConfigManager.updateCustomAuthAccount(current.uuid, ref.access, undefined)
            ConfigManager.save()
            return true
        }catch(err){
            log.warn('Refresh failed:', err.message)
            return false
        }
    }
}

/**
 * Валидировать выбранный аккаунт. Если access протух — обновить.
 * @returns {Promise<boolean>}
 */
exports.validateSelected = async function(){
    return ensureSelectedAccess()
}

// ---------------------------------------------------------------------------
// Ниже — совместимостьные заглушки для старого кода (если где-то ещё дергаются
// Mojang/Microsoft методы, чтобы билд не падал). Можно удалить, если UI переписан.
// ---------------------------------------------------------------------------

exports.addMojangAccount = async function(){
    throw new Error('Mojang auth disabled in this build.')
}
exports.removeMojangAccount = async function(){
    throw new Error('Mojang auth disabled in this build.')
}
exports.addMicrosoftAccount = async function(){
    throw new Error('Microsoft auth disabled in this build.')
}
exports.removeMicrosoftAccount = async function(){
    throw new Error('Microsoft auth disabled in this build.')
}

const fs   = require('fs-extra')
const { LoggerUtil } = require('helios-core')
const os   = require('os')
const path = require('path')

const logger = LoggerUtil.getLogger('ConfigManager')

const sysRoot = process.env.APPDATA || (process.platform == 'darwin'
    ? process.env.HOME + '/Library/Application Support'
    : process.env.HOME)

const dataPath    = path.join(sysRoot, '.helioslauncher')
const launcherDir = require('@electron/remote').app.getPath('userData')

/**
 * Retrieve the absolute path of the launcher directory.
 * 
 * @returns {string} The absolute path of the launcher directory.
 */
exports.getLauncherDirectory = function(){
    return launcherDir
}

/**
 * Get the launcher's data directory. This is where all files related
 * to game launch are installed (common, instances, java, etc).
 * 
 * @returns {string} The absolute path of the launcher's data directory.
 */
exports.getDataDirectory = function(def = false){
    return !def ? config.settings.launcher.dataDirectory : DEFAULT_CONFIG.settings.launcher.dataDirectory
}

/**
 * Set the new data directory.
 * 
 * @param {string} dataDirectory The new data directory.
 */
exports.setDataDirectory = function(dataDirectory){
    config.settings.launcher.dataDirectory = dataDirectory
}

const configPath       = path.join(exports.getLauncherDirectory(), 'config.json')
const configPathLEGACY = path.join(dataPath, 'config.json')
const firstLaunch      = !fs.existsSync(configPath) && !fs.existsSync(configPathLEGACY)

/**
 * Absolute min/max RAM helpers (for sliders/UI).
 */
exports.getAbsoluteMinRAM = function(ram){
    if(ram?.minimum != null){
        return ram.minimum/1024
    } else {
        const mem = os.totalmem()
        return mem >= (6*1073741824) ? 3 : 2
    }
}

exports.getAbsoluteMaxRAM = function(ram){
    const mem = os.totalmem()
    const gT16 = mem-(16*1073741824)
    return Math.floor((mem-(gT16 > 0 ? (Number.parseInt(gT16/8) + (16*1073741824)/4) : mem/4))/1073741824)
}

function resolveSelectedRAM(ram) {
    if(ram?.recommended != null){
        return `${ram.recommended}M`
    } else {
        const mem = os.totalmem()
        return mem >= (8*1073741824) ? '4G' : (mem >= (6*1073741824) ? '3G' : '2G')
    }
}

/**
 * Three types of values:
 * Static = Explicitly declared.
 * Dynamic = Calculated by a private function.
 * Resolved = Resolved externally, defaults to null.
 */
const DEFAULT_CONFIG = {
    settings: {
        game: {
            resWidth: 1280,
            resHeight: 720,
            fullscreen: false,
            autoConnect: true,
            launchDetached: true
        },
        launcher: {
            allowPrerelease: false,
            dataDirectory: dataPath,
            // Базовый URL твоего auth API (можно изменить через setAuthAPI)
            authAPI: 'http://localhost:5000'
        }
    },
    newsCache: {
        date: null,
        content: null,
        dismissed: false
    },
    clientToken: null,
    selectedServer: null, // Resolved
    selectedAccount: null,
    // Только кастомные аккаунты: { [uuid]: {type:'custom', uuid, displayName, accessToken?, refreshToken?} }
    authenticationDatabase: {},
    modConfigurations: [],
    javaConfig: {}
}

let config = null

// ------------------------------ Persistence ------------------------------

/**
 * Save the current configuration to a file.
 */
exports.save = function(){
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'UTF-8')
}

/**
 * Load the configuration into memory. If a configuration file exists,
 * that will be read and saved. Otherwise, a default configuration will
 * be generated. Note that "resolved" values default to null and will
 * need to be externally assigned.
 */
exports.load = function(){
    let doLoad = true

    if(!fs.existsSync(configPath)){
        // Create all parent directories.
        fs.ensureDirSync(path.join(configPath, '..'))
        if(fs.existsSync(configPathLEGACY)){
            fs.moveSync(configPathLEGACY, configPath)
        } else {
            doLoad = false
            config = DEFAULT_CONFIG
            exports.save()
        }
    }
    if(doLoad){
        let doValidate = false
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'UTF-8'))
            doValidate = true
        } catch (err){
            logger.error(err)
            logger.info('Configuration file contains malformed JSON or is corrupt.')
            logger.info('Generating a new configuration file.')
            fs.ensureDirSync(path.join(configPath, '..'))
            config = DEFAULT_CONFIG
            exports.save()
        }
        if(doValidate){
            config = validateKeySet(DEFAULT_CONFIG, config)
            // Миграция: убедимся, что есть поле authAPI
            if(!config?.settings?.launcher?.authAPI){
                config.settings.launcher.authAPI = DEFAULT_CONFIG.settings.launcher.authAPI
            }
            exports.save()
        }
    }
    logger.info('Successfully Loaded')
}

/**
 * @returns {boolean} Whether or not the manager has been loaded.
 */
exports.isLoaded = function(){
    return config != null
}

/**
 * Validate that the destination object has at least every field
 * present in the source object. Assign a default value otherwise.
 * 
 * @param {Object} srcObj The source object to reference against.
 * @param {Object} destObj The destination object.
 * @returns {Object} A validated destination object.
 */
function validateKeySet(srcObj, destObj){
    if(srcObj == null){
        srcObj = {}
    }
    const validationBlacklist = ['authenticationDatabase', 'javaConfig']
    const keys = Object.keys(srcObj)
    for(let i=0; i<keys.length; i++){
        if(typeof destObj[keys[i]] === 'undefined'){
            destObj[keys[i]] = srcObj[keys[i]]
        } else if(typeof srcObj[keys[i]] === 'object' && srcObj[keys[i]] != null && !(srcObj[keys[i]] instanceof Array) && validationBlacklist.indexOf(keys[i]) === -1){
            destObj[keys[i]] = validateKeySet(srcObj[keys[i]], destObj[keys[i]])
        }
    }
    return destObj
}

// ------------------------------ App State ------------------------------

/**
 * Check to see if this is the first time the user has launched the
 * application. This is determined by the existance of the data path.
 * 
 * @returns {boolean} True if this is the first launch, otherwise false.
 */
exports.isFirstLaunch = function(){
    return firstLaunch
}

/**
 * Returns the name of the folder in the OS temp directory which we
 * will use to extract and store native dependencies for game launch.
 * 
 * @returns {string} The name of the folder.
 */
exports.getTempNativeFolder = function(){
    return 'WCNatives'
}

// ------------------------------ News Cache ------------------------------

exports.getNewsCache = function(){
    return config.newsCache
}

exports.setNewsCache = function(newsCache){
    config.newsCache = newsCache
}

exports.setNewsCacheDismissed = function(dismissed){
    config.newsCache.dismissed = dismissed
}

// ------------------------------ Paths ------------------------------

exports.getCommonDirectory = function(){
    return path.join(exports.getDataDirectory(), 'common')
}

exports.getInstanceDirectory = function(){
    return path.join(exports.getDataDirectory(), 'instances')
}

// ------------------------------ Client/Server Selection ------------------------------

exports.getClientToken = function(){
    return config.clientToken
}

exports.setClientToken = function(clientToken){
    config.clientToken = clientToken
}

/**
 * Retrieve the ID of the selected serverpack.
 * 
 * @param {boolean} def Optional. If true, the default value will be returned.
 * @returns {string} The ID of the selected serverpack.
 */
exports.getSelectedServer = function(def = false){
    return !def ? config.selectedServer : DEFAULT_CONFIG.clientToken
}

/**
 * Set the ID of the selected serverpack.
 * 
 * @param {string} serverID The ID of the new selected serverpack.
 */
exports.setSelectedServer = function(serverID){
    config.selectedServer = serverID
}

// ------------------------------ AUTH (Custom Only) ------------------------------

/**
 * Get all stored accounts.
 * @returns {Object<string, Object>}
 */
exports.getAuthAccounts = function(){
    return config.authenticationDatabase
}

/**
 * Get account by uuid, or undefined.
 * @param {string} uuid
 * @returns {Object|undefined}
 */
exports.getAuthAccount = function(uuid){
    return config.authenticationDatabase[uuid]
}

/**
 * Add or replace a **custom** account (наш сервер).
 * 
 * @param {string} uuid Offline UUID (derived from username).
 * @param {string|null} accessToken JWT access (может быть null).
 * @param {string|null} refreshToken JWT refresh (может быть null).
 * @param {string} displayName Ник игрока.
 * @returns {Object} Stored account object.
 */
exports.addCustomAuthAccount = function(uuid, accessToken, refreshToken, displayName){
    config.selectedAccount = uuid
    config.authenticationDatabase[uuid] = {
        type: 'custom',
        accessToken: accessToken || null,
        refreshToken: refreshToken || null,
        uuid: uuid.trim(),
        displayName: displayName.trim()
    }
    return config.authenticationDatabase[uuid]
}

/**
 * Update tokens for a custom account.
 * 
 * @param {string} uuid
 * @param {string|null|undefined} accessToken
 * @param {string|null|undefined} refreshToken
 * @returns {Object|null}
 */
exports.updateCustomAuthAccount = function(uuid, accessToken, refreshToken){
    const acc = config.authenticationDatabase[uuid]
    if(!acc) return null
    acc.type = 'custom'
    if(typeof accessToken  !== 'undefined') acc.accessToken  = accessToken
    if(typeof refreshToken !== 'undefined') acc.refreshToken = refreshToken
    return acc
}

/**
 * Remove an authenticated account. If it was selected, a new one will be selected.
 * @param {string} uuid
 * @returns {boolean}
 */
exports.removeAuthAccount = function(uuid){
    if(config.authenticationDatabase[uuid] != null){
        delete config.authenticationDatabase[uuid]
        if(config.selectedAccount === uuid){
            const keys = Object.keys(config.authenticationDatabase)
            if(keys.length > 0){
                config.selectedAccount = keys[0]
            } else {
                config.selectedAccount = null
                config.clientToken = null
            }
        }
        return true
    }
    return false
}

/**
 * Get currently selected account (object).
 * @returns {Object|null}
 */
exports.getSelectedAccount = function(){
    return config.authenticationDatabase[config.selectedAccount]
}

/**
 * Get selected account UUID (string|null).
 */
exports.getSelectedAccountUUID = function(){
    return config.selectedAccount || null
}

/**
 * Set selected account by uuid.
 * @param {string} uuid
 * @returns {Object|null}
 */
exports.setSelectedAccount = function(uuid){
    const authAcc = config.authenticationDatabase[uuid]
    if(authAcc != null){
        config.selectedAccount = uuid
    }
    return authAcc || null
}

// ------------------------------ Mods Config ------------------------------

/**
 * Get the list of mod configurations for servers.
 * @returns {Array<Object>}
 */
exports.getModConfigurations = function(){
    return config.modConfigurations
}

/**
 * Replace the whole list of mod configurations.
 * @param {Array<Object>} configurations
 */
exports.setModConfigurations = function(configurations){
    config.modConfigurations = configurations
}

/**
 * Get the mod configuration for a specific server id.
 * @param {string} serverid
 * @returns {Object|null}
 */
exports.getModConfiguration = function(serverid){
    const cfgs = config.modConfigurations
    for(let i=0; i<cfgs.length; i++){
        if(cfgs[i].id === serverid){
            return cfgs[i]
        }
    }
    return null
}

/**
 * Set (upsert) the mod configuration for a specific server id.
 * @param {string} serverid
 * @param {Object} configuration
 */
exports.setModConfiguration = function(serverid, configuration){
    const cfgs = config.modConfigurations
    for(let i=0; i<cfgs.length; i++){
        if(cfgs[i].id === serverid){
            cfgs[i] = configuration
            return
        }
    }
    cfgs.push(configuration)
}

// ------------------------------ Java Settings ------------------------------

function defaultJavaConfig(effectiveJavaOptions, ram) {
    if(effectiveJavaOptions.suggestedMajor > 8) {
        return defaultJavaConfig17(ram)
    } else {
        return defaultJavaConfig8(ram)
    }
}

function defaultJavaConfig8(ram) {
    return {
        minRAM: resolveSelectedRAM(ram),
        maxRAM: resolveSelectedRAM(ram),
        executable: null,
        jvmOptions: [
            '-XX:+UseConcMarkSweepGC',
            '-XX:+CMSIncrementalMode',
            '-XX:-UseAdaptiveSizePolicy',
            '-Xmn128M'
        ],
    }
}

function defaultJavaConfig17(ram) {
    return {
        minRAM: resolveSelectedRAM(ram),
        maxRAM: resolveSelectedRAM(ram),
        executable: null,
        jvmOptions: [
            '-XX:+UnlockExperimentalVMOptions',
            '-XX:+UseG1GC',
            '-XX:G1NewSizePercent=20',
            '-XX:G1ReservePercent=20',
            '-XX:MaxGCPauseMillis=50',
            '-XX:G1HeapRegionSize=32M'
        ],
    }
}

/**
 * Ensure a java config property is set for the given server.
 * 
 * @param {string} serverid The server id.
 * @param {*} effectiveJavaOptions { suggestedMajor, ... }
 * @param {*} ram Object with minima/recommended if available.
 */
exports.ensureJavaConfig = function(serverid, effectiveJavaOptions, ram) {
    if(!Object.prototype.hasOwnProperty.call(config.javaConfig, serverid)) {
        config.javaConfig[serverid] = defaultJavaConfig(effectiveJavaOptions, ram)
    }
}

exports.getMinRAM = function(serverid){
    return config.javaConfig[serverid].minRAM
}

exports.setMinRAM = function(serverid, minRAM){
    config.javaConfig[serverid].minRAM = minRAM
}

exports.getMaxRAM = function(serverid){
    return config.javaConfig[serverid].maxRAM
}

exports.setMaxRAM = function(serverid, maxRAM){
    config.javaConfig[serverid].maxRAM = maxRAM
}

exports.getJavaExecutable = function(serverid){
    return config.javaConfig[serverid].executable
}

exports.setJavaExecutable = function(serverid, executable){
    config.javaConfig[serverid].executable = executable
}

exports.getJVMOptions = function(serverid){
    return config.javaConfig[serverid].jvmOptions
}

exports.setJVMOptions = function(serverid, jvmOptions){
    config.javaConfig[serverid].jvmOptions = jvmOptions
}

// ------------------------------ Game Settings ------------------------------

exports.getGameWidth = function(def = false){
    return !def ? config.settings.game.resWidth : DEFAULT_CONFIG.settings.game.resWidth
}

exports.setGameWidth = function(resWidth){
    config.settings.game.resWidth = Number.parseInt(resWidth)
}

exports.validateGameWidth = function(resWidth){
    const nVal = Number.parseInt(resWidth)
    return Number.isInteger(nVal) && nVal >= 0
}

exports.getGameHeight = function(def = false){
    return !def ? config.settings.game.resHeight : DEFAULT_CONFIG.settings.game.resHeight
}

exports.setGameHeight = function(resHeight){
    config.settings.game.resHeight = Number.parseInt(resHeight)
}

exports.validateGameHeight = function(resHeight){
    const nVal = Number.parseInt(resHeight)
    return Number.isInteger(nVal) && nVal >= 0
}

exports.getFullscreen = function(def = false){
    return !def ? config.settings.game.fullscreen : DEFAULT_CONFIG.settings.game.fullscreen
}

exports.setFullscreen = function(fullscreen){
    config.settings.game.fullscreen = fullscreen
}

exports.getAutoConnect = function(def = false){
    return !def ? config.settings.game.autoConnect : DEFAULT_CONFIG.settings.game.autoConnect
}

exports.setAutoConnect = function(autoConnect){
    config.settings.game.autoConnect = autoConnect
}

exports.getLaunchDetached = function(def = false){
    return !def ? config.settings.game.launchDetached : DEFAULT_CONFIG.settings.game.launchDetached
}

exports.setLaunchDetached = function(launchDetached){
    config.settings.game.launchDetached = launchDetached
}

// ------------------------------ Launcher Settings ------------------------------

exports.getAllowPrerelease = function(def = false){
    return !def ? config.settings.launcher.allowPrerelease : DEFAULT_CONFIG.settings.launcher.allowPrerelease
}

exports.setAllowPrerelease = function(allowPrerelease){
    config.settings.launcher.allowPrerelease = allowPrerelease
}

/**
 * Get Auth API base URL (for our custom backend).
 * @param {boolean} def Optional: return default.
 * @returns {string}
 */
exports.getAuthAPI = function(def = false){
    return !def ? config.settings.launcher.authAPI : DEFAULT_CONFIG.settings.launcher.authAPI
}

/**
 * Set Auth API base URL.
 * @param {string} url
 */
exports.setAuthAPI = function(url){
    config.settings.launcher.authAPI = String(url || '').trim()
}

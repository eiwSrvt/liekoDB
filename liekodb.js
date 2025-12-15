const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

const http = require("http");
const https = require("https");
const { URL } = require("url");

class QueryEngine {
    constructor() {
        this.queryCache = new Map();
        this.cacheHits = 0;
        this.cacheSize = 1000;
    }

    applyFilters(data, filter) {
        if (!filter || Object.keys(filter).length === 0) return data;

        const cacheKey = JSON.stringify(filter) + data.length;
        if (this.queryCache.has(cacheKey)) {
            this.cacheHits++;
            return this.queryCache.get(cacheKey);
        }

        const results = data.filter(item => this.matchesFilter(item, filter));

        if (this.queryCache.size >= this.cacheSize) {
            const firstKey = this.queryCache.keys().next().value;
            this.queryCache.delete(firstKey);
        }
        this.queryCache.set(cacheKey, results);

        return results;
    }

    compareValue(actual, expected) {
        return actual === expected;
    }

    matchesFilter(item, filter) {
        if (!filter) return true;
        if (filter.$and) return filter.$and.every(f => this.matchesFilter(item, f));
        if (filter.$or) return filter.$or.some(f => this.matchesFilter(item, f));
        if (filter.$nor) return !filter.$nor.some(f => this.matchesFilter(item, f));
        if (filter.$not) return !this.matchesFilter(item, filter.$not);

        for (const key of Object.keys(filter)) {
            if (key.startsWith('$')) continue;

            const expected = filter[key];
            const value = this.getValue(item, key);

            if (
                typeof expected === 'object' &&
                expected !== null &&
                !Array.isArray(expected)
            ) {
                if (!this.matchesOperators(value, expected)) return false;
            } else {
                if (Array.isArray(value)) {
                    if (!value.includes(expected)) return false;
                } else if (value !== expected) {
                    return false;
                }
            }
        }

        return true;
    }

    getValue(item, path) {
        if (!path.includes('.')) return item[path];

        const parts = path.split('.');
        let cur = item;

        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];

            if (Array.isArray(cur)) {
                const idx = parseInt(p, 10);
                if (!isNaN(idx) && idx >= 0 && idx < cur.length) {
                    cur = cur[idx];
                    continue;
                }

                const remainingPath = parts.slice(i).join('.');
                let results = [];

                for (let el of cur) {
                    const v = this.getValue(el, remainingPath);
                    if (v !== undefined) {
                        if (Array.isArray(v)) {
                            results.push(...v);
                        } else {
                            results.push(v);
                        }
                    }
                }

                return results.length > 0 ? results : undefined;
            }

            if (cur == null || typeof cur !== 'object') return undefined;
            cur = cur[p];
        }

        return cur;
    }

    matchesOperators(actual, ops) {
        for (const [op, expected] of Object.entries(ops)) {
            if (op === '$options') continue;

            if (actual === undefined) {
                switch (op) {
                    case '$exists':
                        if (expected === true) return false;
                        if (expected === false) return true;
                        break;
                    case '$ne':
                        return true;
                    default:
                        return false;
                }
                continue;
            }

            switch (op) {
                case '$eq':
                    if (Array.isArray(actual)) {
                        if (!actual.includes(expected)) return false;
                    } else if (actual !== expected) return false;
                    break;

                case '$ne':
                    if (Array.isArray(actual)) {
                        if (actual.includes(expected)) return false;
                    } else if (actual === expected) return false;
                    break;

                case '$gt':
                    if (Array.isArray(actual)) {
                        if (!actual.some(v => v > expected)) return false;
                    } else if (!(actual > expected)) return false;
                    break;

                case '$gte':
                    if (Array.isArray(actual)) {
                        if (!actual.some(v => v >= expected)) return false;
                    } else if (!(actual >= expected)) return false;
                    break;

                case '$lt':
                    if (Array.isArray(actual)) {
                        if (!actual.some(v => v < expected)) return false;
                    } else if (!(actual < expected)) return false;
                    break;

                case '$lte':
                    if (Array.isArray(actual)) {
                        if (!actual.some(v => v <= expected)) return false;
                    } else if (!(actual <= expected)) return false;
                    break;

                case '$in':
                    if (Array.isArray(actual)) {
                        if (!actual.some(v => expected.includes(v))) return false;
                    } else {
                        if (!expected.includes(actual)) return false;
                    }
                    break;

                case '$nin':
                    if (Array.isArray(actual)) {
                        if (actual.some(v => expected.includes(v))) return false;
                    } else {
                        if (expected.includes(actual)) return false;
                    }
                    break;

                case '$exists':
                    if (expected === true && actual === undefined) return false;
                    if (expected === false && actual !== undefined) return false;
                    break;

                case '$not':
                    return !this.matchesOperators(actual, expected);

                case '$regex':
                    try {
                        const pattern = expected instanceof RegExp ? expected : new RegExp(expected, ops.$options || '');
                        if (Array.isArray(actual)) {
                            if (!actual.some(v => pattern.test(String(v)))) return false;
                        } else {
                            if (!pattern.test(String(actual))) return false;
                        }
                    } catch (e) {
                        console.warn('Invalid regex pattern:', expected);
                        return false;
                    }
                    break;

                case '$mod':
                    if (!Array.isArray(expected) || expected.length !== 2) {
                        console.warn("Invalid $mod operator:", expected);
                        return false;
                    }
                    const [div, rem] = expected;
                    if (Array.isArray(actual)) {
                        if (!actual.some(v => typeof v === 'number' && v % div === rem)) return false;
                    } else {
                        if (typeof actual !== 'number') return false;
                        if (actual % div !== rem) return false;
                    }
                    break;

                default:
                    if (this.debug) console.warn("Unknown operator:", op);
                    continue;
            }
        }
        return true;
    }

    count(data, filters = {}) {
        if (!filters || Object.keys(filters).length === 0) {
            return data.length;
        }
        return this.applyFilters(data, filters).length;
    }

    sortResults(data, sortSpec) {
        return data.sort((a, b) => {
            for (const [field, direction] of Object.entries(sortSpec)) {
                const aVal = this.getValue(a, field);
                const bVal = this.getValue(b, field);

                if (aVal < bVal) return direction === 1 ? -1 : 1;
                if (aVal > bVal) return direction === 1 ? 1 : -1;
            }
            return 0;
        });
    }

    selectFields(data, projection) {
        return data.map(doc => {
            const result = {};
            for (const [field, include] of Object.entries(projection)) {
                if (include === 1 || include === true) {
                    result[field] = this.getValue(doc, field);
                }
            }
            return result;
        });
    }

    applyUpdateToDoc(doc, update) {
        if (!update) return;

        const applyNestedOperation = (obj, path, operation, value) => {
            const parts = path.split('.');
            let current = obj;

            for (let i = 0; i < parts.length - 1; i++) {
                const part = parts[i];
                if (current[part] === undefined || typeof current[part] !== 'object') {
                    current[part] = {};
                }
                current = current[part];
            }

            const lastPart = parts[parts.length - 1];

            switch (operation) {
                case 'set':
                    current[lastPart] = value;
                    break;
                case 'unset':
                    delete current[lastPart];
                    break;
                case 'inc':
                    current[lastPart] = (typeof current[lastPart] === 'number' ? current[lastPart] : 0) + value;
                    break;
                case 'push':
                    if (!Array.isArray(current[lastPart])) current[lastPart] = [];
                    current[lastPart].push(value);
                    break;
                case 'addToSet':
                    if (!Array.isArray(current[lastPart])) current[lastPart] = [];
                    if (!current[lastPart].includes(value)) {
                        current[lastPart].push(value);
                    }
                    break;
                case 'pull':
                    if (Array.isArray(current[lastPart])) {
                        current[lastPart] = current[lastPart].filter(item => item !== value);
                    }
                    break;
            }
        };

        const hasRootLevelOperators =
            '$set' in update ||
            '$unset' in update ||
            '$inc' in update ||
            '$push' in update ||
            '$pull' in update ||
            '$addToSet' in update;

        if (hasRootLevelOperators) {
            if (update.$set) {
                for (const [k, v] of Object.entries(update.$set)) {
                    if (k.includes('.')) {
                        applyNestedOperation(doc, k, 'set', v);
                    } else {
                        doc[k] = v;
                    }
                }
            }

            if (update.$unset) {
                for (const k of Object.keys(update.$unset)) {
                    if (k.includes('.')) {
                        applyNestedOperation(doc, k, 'unset', null);
                    } else {
                        delete doc[k];
                    }
                }
            }

            if (update.$inc) {
                for (const [k, v] of Object.entries(update.$inc)) {
                    if (k.includes('.')) {
                        applyNestedOperation(doc, k, 'inc', v);
                    } else {
                        doc[k] = (typeof doc[k] === 'number' ? doc[k] : 0) + v;
                    }
                }
            }

            if (update.$push) {
                for (const [k, v] of Object.entries(update.$push)) {
                    if (k.includes('.')) {
                        applyNestedOperation(doc, k, 'push', v);
                    } else {
                        if (!Array.isArray(doc[k])) doc[k] = [];
                        doc[k].push(v);
                    }
                }
            }

            if (update.$addToSet) {
                for (const [k, v] of Object.entries(update.$addToSet)) {
                    if (k.includes('.')) {
                        applyNestedOperation(doc, k, 'addToSet', v);
                    } else {
                        if (!Array.isArray(doc[k])) doc[k] = [];
                        if (v && typeof v === 'object' && v.$each) {
                            for (const item of v.$each) {
                                if (!doc[k].includes(item)) {
                                    doc[k].push(item);
                                }
                            }
                        } else {
                            if (!doc[k].includes(v)) {
                                doc[k].push(v);
                            }
                        }
                    }
                }
            }

            if (update.$pull) {
                for (const [k, v] of Object.entries(update.$pull)) {
                    if (k.includes('.')) {
                        applyNestedOperation(doc, k, 'pull', v);
                    } else {
                        if (Array.isArray(doc[k])) {
                            doc[k] = doc[k].filter(item => {
                                if (typeof v === 'object' && v.$in) {
                                    return !v.$in.includes(item);
                                }
                                return item !== v;
                            });
                        }
                    }
                }
            }
        } else {
            Object.assign(doc, update);
        }

        doc.updatedAt = new Date().toISOString();
    }
}

class HTTPAdapter {
    constructor(opts = {}) {
        this.poolSize = opts.poolSize || 10;
        this.requestQueue = [];
        this.activeRequests = 0;
        this.maxRetries = opts.maxRetries || 3;
        this.timeout = opts.timeout || 15000;
        this.databaseUrl = opts.databaseUrl || "http://127.0.0.1:8050";
        this.token = opts.token || null;
        this.parsedBaseUrl = new URL(this.databaseUrl);
        this.isHttps = this.parsedBaseUrl.protocol === "https:";
        this.hostname = this.parsedBaseUrl.hostname === 'localhost' ? '127.0.0.1' : this.parsedBaseUrl.hostname;

        const agentOptions = {
            keepAlive: true,
            keepAliveMsecs: 1000,
            maxSockets: this.poolSize,
            maxFreeSockets: this.poolSize,
            timeout: this.timeout,
            scheduling: 'lifo'
        };

        this.httpAgent = new http.Agent(agentOptions);
        this.httpsAgent = new https.Agent(agentOptions);
        
        const setupSocket = (socket) => {
            socket.setNoDelay(true);
            socket.setKeepAlive(true, 1000);
        };
        
        this.httpAgent.on('socket', setupSocket);
        this.httpsAgent.on('socket', setupSocket);

        this.baseHeaders = {
            "Content-Type": "application/json"
        };
        
        if (this.token) {
            this.baseHeaders.Authorization = `Bearer ${this.token}`;
        }

        if (opts.warmup !== false) {
            this._warmupConnection();
        }
    }

    async _warmupConnection() {
        try {
            const warmupPromises = [];
            
            for (let i = 0; i < 2; i++) {
                const promise = new Promise((resolve) => {
                    const timer = setTimeout(() => {
                        resolve();
                    }, 100);
                    
                    const req = (this.isHttps ? https : http).request({
                        method: 'HEAD',
                        hostname: this.hostname,
                        port: this.parsedBaseUrl.port,
                        path: '/ping',
                        agent: this.isHttps ? this.httpsAgent : this.httpAgent,
                        timeout: 100
                    });
                    
                    req.on('error', () => {
                        clearTimeout(timer);
                        resolve();
                    });
                    
                    req.on('response', (res) => {
                        res.resume();
                        clearTimeout(timer);
                        resolve();
                    });
                    
                    req.end();
                });
                
                warmupPromises.push(promise);
            }
            
            await Promise.race([
                Promise.all(warmupPromises),
                new Promise(resolve => setTimeout(resolve, 200))
            ]);
        } catch (e) {}
    }

    async request(method, endpoint, data = {}) {
        return new Promise((resolve, reject) => {
            this._enqueue({ method, endpoint, data, resolve, reject, retries: 0 });
        });
    }

    _enqueue(req) {
        this.requestQueue.push(req);
        this._processQueue();
    }

    _processQueue() {
        if (this.activeRequests >= this.poolSize || this.requestQueue.length === 0) return;

        const req = this.requestQueue.shift();
        this.activeRequests++;

        this._execute(req)
            .then(req.resolve)
            .catch(err => {
                if (req.retries < this.maxRetries && this._retryable(err)) {
                    req.retries++;
                    this.requestQueue.unshift(req);
                } else {
                    req.reject(err);
                }
            })
            .finally(() => {
                this.activeRequests--;
                setImmediate(() => this._processQueue());
            });
    }

    async _execute(req) {
        const pathname = `/api${req.endpoint}`;
        
        const body = (req.method !== "GET" && req.method !== "HEAD")
            ? JSON.stringify(req.data)
            : null;

        const headers = Object.assign({}, this.baseHeaders);
        
        if (body) {
            headers['Content-Length'] = Buffer.byteLength(body);
        }

        const options = {
            method: req.method,
            hostname: this.hostname,
            port: this.parsedBaseUrl.port,
            path: pathname,
            headers: headers,
            agent: this.isHttps ? this.httpsAgent : this.httpAgent,
        };

        return new Promise((resolve, reject) => {
            const start = performance.now();

            const transport = this.isHttps ? https : http;
            const request = transport.request(options);

            let timer = setTimeout(() => {
                request.destroy();
                reject(new Error("Request timeout"));
            }, this.timeout);

            if (body) {
                request.end(body);
            } else {
                request.end();
            }

            request.on("error", err => {
                clearTimeout(timer);
                this._log(req, start, 0, "ERROR", err.message);
                reject(err);
            });

            request.on("response", res => {
                let chunks = [];

                res.on("data", c => chunks.push(c));
                res.on("end", () => {
                    clearTimeout(timer);

                    const raw = Buffer.concat(chunks);
                    const size = raw.length;

                    let parsed = raw.toString();

                    if (res.headers["content-type"]?.includes("application/json")) {
                        try { 
                            parsed = JSON.parse(parsed); 
                        } catch (e) {}
                    }

                    this._log(req, start, size, res.statusCode);

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(parsed);
                    } else {
                        console.error("HTTP Error:", req.method, req.endpoint, res.statusCode, parsed);
                        reject(new Error(`HTTP ${res.statusCode}: ${parsed?.error || parsed}`));
                    }
                });
            });
        });
    }

    _retryable(err) {
        if (!err || !err.message) return false;
        return (
            err.message.includes("timeout") ||
            err.message.includes("ECONNRESET") ||
            err.message.includes("ECONNREFUSED") ||
            err.message.includes("EAI_AGAIN")
        );
    }

    _log(req, start, size, status, error = null) {
        const ms = Math.round((performance.now() - start) * 1000) / 1000;
        const op = req.endpoint.split("/")[2]?.toUpperCase() || "REQUEST";

        if (status === "ERROR") {
            console.log(
                `[HTTP] ${op} ${req.endpoint} | Error: ${error} | Duration: ${ms}ms`
            );
        } else {
            console.log(
                `[HTTP] ${op} | ${req.method} -> ${req.endpoint} | Status: ${status} | Duration: ${ms}ms | Size: ${size}B`
            );
        }
    }

    close() {
        this.httpAgent.destroy();
        this.httpsAgent.destroy();
    }
}

class LocalAdapter {
    constructor(opts = {}) {
        this.storagePath = opts.storagePath || './storage';
        this.queryEngine = new QueryEngine();
        this.debug = opts.debug || false;

        this.collections = new Map();
        this.saveQueue = new Map();
        this.isSaving = new Set();
        this.saveDelay = opts.saveDelay || 50;

        this.collectionName = null;

        try {
            fsSync.mkdirSync(this.storagePath, { recursive: true });
        } catch (e) { }
    }

    _log(...args) {
        if (this.debug) console.log('[LiekoDB]', ...args);
    }

    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    }

    _formatDuration(microseconds) {
        if (microseconds < 1000) return `${microseconds.toFixed(0)}µs`;
        if (microseconds < 1000000) return `${(microseconds / 1000).toFixed(2)}ms`;
        return `${(microseconds / 1000000).toFixed(2)}s`;
    }

    _formatFilters(filters) {
        if (!filters || Object.keys(filters).length === 0) return '{}';
        const formatted = JSON.stringify(filters, null, 0)
            .replace(/"/g, '')
            .replace(/,/g, ', ');
        if (formatted.length > 80) {
            return formatted.substring(0, 77) + '...';
        }
        return formatted;
    }

    _formatOptions(options) {
        if (!options || Object.keys(options).length === 0) return '';
        const parts = [];
        if (options.sort) parts.push(`sort: ${JSON.stringify(options.sort).replace(/"/g, '')}`);
        if (options.limit) parts.push(`limit: ${options.limit}`);
        if (options.skip) parts.push(`skip: ${options.skip}`);
        if (options.fields) parts.push(`fields: ${JSON.stringify(options.fields).replace(/"/g, '')}`);
        return parts.length > 0 ? ` | ${parts.join(', ')}` : '';
    }

    _startTimer() {
        return process.hrtime.bigint();
    }

    _endTimer(start) {
        const end = process.hrtime.bigint();
        return Number(end - start) / 1000;
    }

    _getDataSize(data) {
        try {
            return Buffer.byteLength(JSON.stringify(data), 'utf8');
        } catch (e) {
            return 0;
        }
    }

    _logRequest(operation, collectionName, details, duration, responseSize) {
        if (!this.debug) return;

        const durationFormatted = this._formatDuration(duration);
        const responseSizeFormatted = this._formatBytes(responseSize);

        this._log(
            `${operation.toUpperCase()} ${collectionName} | ` +
            `Duration: ${durationFormatted} | ` +
            `Response Size: ${responseSizeFormatted}` +
            (details ? ` | ${details}` : '')
        );
    }

    generateId() {
        return require('crypto').randomBytes(8).toString('hex');
    }

    listCollections() {
        const collections = new Set();

        for (const [name, col] of this.collections) {
            const filePath = path.join(this.storagePath, `${name}.json`);
            const fileExists = fsSync.existsSync(filePath);

            if (col.data.length > 0 || fileExists) {
                collections.add(name);
            }
        }

        try {
            const files = fsSync.readdirSync(this.storagePath);
            const diskCollections = files.filter(f => f.endsWith('.json')).map(f => path.basename(f, '.json'));
            diskCollections.forEach(name => {
                collections.add(name);
            });
        } catch (e) { }

        return Array.from(collections);
    }

    _getCollection(name) {
        if (this.collections.has(name)) {
            return this.collections.get(name);
        }

        const col = {
            data: [],
            dirty: false,
            lastSave: 0,
            idIndex: new Map()
        };
        this.collections.set(name, col);

        const filePath = path.join(this.storagePath, `${name}.json`);
        if (fsSync.existsSync(filePath)) {
            try {
                const raw = fsSync.readFileSync(filePath, 'utf8');
                const data = JSON.parse(raw) || [];
                col.data = data;

                data.forEach((doc, idx) => {
                    if (doc.id) col.idIndex.set(doc.id, idx);
                });

                col.lastSave = Date.now();
            } catch (e) {
                console.error("Failed to load collection:", e);
            }
        }
        return col;
    }

    _scheduleSave(name) {
        const col = this.collections.get(name);
        if (!col) return;

        col.dirty = true;

        if (this.saveQueue.has(name)) {
            clearTimeout(this.saveQueue.get(name));
        }

        const timeout = setTimeout(async () => {
            await this._flushToDisk(name);
        }, this.saveDelay);

        this.saveQueue.set(name, timeout);
    }

    async _flushToDisk(name) {
        if (this.isSaving.has(name)) return;

        const col = this.collections.get(name);
        if (!col || !col.dirty) return;

        this.isSaving.add(name);
        this.saveQueue.delete(name);

        try {
            const filePath = path.join(this.storagePath, `${name}.json`);
            const tempPath = `${filePath}.tmp`;

            const reorderedRecords = col.data.map(doc => this._reorderDocumentFields(doc));

            await fs.writeFile(tempPath, JSON.stringify(reorderedRecords, null, 2));
            await fs.rename(tempPath, filePath);

            this._log(`Saved ${name}.json (${col.data.length} docs)`);
            col.lastSave = Date.now();
            col.dirty = false;

        } catch (error) {
            this._log('Save error:', error);
            col.dirty = true;
            this._scheduleSave(name);
        } finally {
            this.isSaving.delete(name);
        }
    }

    _reorderDocumentFields(doc) {
        if (!doc || typeof doc !== 'object') return doc;

        const orderedDoc = {};
        const reservedFields = ['id', 'createdAt', 'updatedAt'];

        if (doc.id !== undefined) {
            orderedDoc.id = doc.id;
        }

        const normalFields = Object.keys(doc)
            .filter(key => !reservedFields.includes(key))
            .sort();

        for (const key of normalFields) {
            orderedDoc[key] = doc[key];
        }

        if (doc.createdAt !== undefined) {
            orderedDoc.createdAt = doc.createdAt;
        }
        if (doc.updatedAt !== undefined) {
            orderedDoc.updatedAt = doc.updatedAt;
        }

        return orderedDoc;
    }

    async request(method, endpoint, payload = {}) {
        const parts = endpoint.split("/").filter(Boolean);
        // Payload can contains filters, options, data, update

        this.collectionName = parts[1];
        const param = parts[2];

        if (method === "GET" && !param) return this.find(payload);
        if (method === "GET" && param === "count") return this.count(payload);
        if (method === "GET" && param) return this.findById(param);

        if (method === "POST") return this.insert(payload);

        if (method === "PATCH" && param) return this.updateById(param, payload);
        if (method === "PATCH") return this.update(payload);

        if (method === "DELETE" && param === "drop") return this.dropCollection();
        if (method === "DELETE" && param) return this.deleteById(param);
        if (method === "DELETE") return this.delete(payload);

        throw new Error(`Unsupported endpoint: ${method} ${endpoint}`);
    }

    async count({ filters = {} } = {}) {
        const start = this._startTimer();
        const col = this._getCollection(this.collectionName);
        const result = this.queryEngine.count(col.data, filters);
        const duration = this._endTimer(start);

        const details = `Filters: ${this._formatFilters(filters)} | Count: ${result}`;
        this._logRequest('count', this.collectionName, details, duration, this._getDataSize(result));

        return result;
    }

    async find({ filters = {}, options = {} } = {}) {
        const start = this._startTimer();
        const col = this._getCollection(this.collectionName);
        let results = this.queryEngine.applyFilters(col.data, filters);

        if (options.sort) results = this.queryEngine.sortResults(results, options.sort);
        if (options.skip) results = results.slice(options.skip);

        if (options.limit) {
            const limitValue = typeof options.limit === 'string'
                ? options.limit.toLowerCase()
                : options.limit;

            if (limitValue !== 'all' && !isNaN(limitValue)) {
                results = results.slice(0, parseInt(limitValue, 10));
            }
        }

        if (options.fields) results = this.queryEngine.selectFields(results, options.fields);

        const duration = this._endTimer(start);
        const details = `Filters: ${this._formatFilters(filters)}${this._formatOptions(options)} | Found: ${results.length}`;
        this._logRequest('find', this.collectionName, details, duration, this._getDataSize(results));

        return results;
    }

    async findById(id) {
        const start = this._startTimer();
        const col = this._getCollection(this.collectionName);
        const found = col.data.find(d => (d.id && d.id === id));
        const duration = this._endTimer(start);

        const details = `ID: ${id} | Found: ${found ? 'Yes' : 'No'}`;
        this._logRequest('findById', this.collectionName, details, duration, this._getDataSize(found));

        return found || null;
    }

    async insert({ data }) {
        const start = this._startTimer();
        const col = this._getCollection(this.collectionName);
        const toInsert = Array.isArray(data) ? data : [data];
        const now = new Date().toISOString();
        const inserted = [];
        const updated = [];

        const insertCount = toInsert.length;
        const useSequentialIds = insertCount >= 2;
        let prefix, sequence;
        let allIdsWereGenerated = true;

        if (useSequentialIds) {
            prefix = Date.now().toString(36);
            sequence = 0;
        }

        for (let doc of toInsert) {
            let docId = doc.id;

            if (!docId) {
                if (useSequentialIds) {
                    sequence++;
                    docId = `${prefix}_${sequence.toString()}`;
                } else {
                    docId = this.generateId();
                }
                doc.id = docId;
            } else {
                allIdsWereGenerated = false;
            }

            let existingIndex = col.idIndex.has(docId) ? col.idIndex.get(docId) : -1;

            if (existingIndex !== -1) {
                const existingDoc = col.data[existingIndex];
                const originalCreatedAt = existingDoc.createdAt;
                Object.assign(existingDoc, doc);

                existingDoc.createdAt = originalCreatedAt;
                existingDoc.updatedAt = now;

                col.idIndex.set(docId, existingIndex);
                col.data[existingIndex] = existingDoc;
                updated.push(existingDoc);
            } else {
                doc.id = docId;
                doc.createdAt = doc.createdAt || now;

                const newIndex = col.data.length;
                col.data.push(doc);
                col.idIndex.set(docId, newIndex);
                inserted.push(doc);
            }
        }

        if (inserted.length > 0 || updated.length > 0) {
            col.dirty = true;
            this._scheduleSave(this.collectionName);
        }

        const result = {
            inserted: inserted.length
        };

        if (updated.length > 0) {
            result.updated = updated.length;
        }

        if (inserted.length > 0) {
            if (insertCount > 20) {
                result.firstId = inserted[0].id;
                result.lastId = inserted[inserted.length - 1].id;

                if (allIdsWereGenerated) {
                    result.prefix = prefix + "_";
                }
            } else if (insertCount >= 2) {
                result.insertedIds = inserted.map(doc => doc.id);
            } else {
                result.insertedId = inserted[0].id;
            }
        }

        const duration = this._endTimer(start);
        const details = result.updated !== undefined
            ? `Inserted: ${result.inserted}, Updated: ${result.updated}`
            : `Inserted: ${result.inserted}`;
        this._logRequest('insert', this.collectionName, details, duration, this._getDataSize(result));

        return result;
    }

    async update({ filters, update }) {
        const start = this._startTimer();
        const col = this._getCollection(this.collectionName);

        const normalizedUpdate = update.$set || update.$inc || update.$push || update.$pull || update.$unset || update.$addToSet
            ? update
            : { $set: update };

        let updated = 0;

        for (let i = 0; i < col.data.length; i++) {
            if (this.queryEngine.matchesFilter(col.data[i], filters)) {
                this.queryEngine.applyUpdateToDoc(col.data[i], normalizedUpdate);
                updated++;
            }
        }

        if (updated > 0) {
            col.dirty = true;
            this._scheduleSave(this.collectionName);
        }

        const result = { updated };
        const duration = this._endTimer(start);
        const details = `Filters: ${this._formatFilters(filters)} | Updated: ${updated}`;
        this._logRequest('update', this.collectionName, details, duration, this._getDataSize(result));

        return result;
    }

    async updateById(id, { update }) {
        const start = this._startTimer();
        const col = this._getCollection(this.collectionName);
        const docIndex = col.data.findIndex(d => (d.id && d.id === id));

        if (docIndex === -1) {
            const duration = this._endTimer(start);
            const details = `ID: ${id} | Updated: 0`;
            this._logRequest('updateById', this.collectionName, details, duration, 0);
            return { updated: 0 };
        }

        this.queryEngine.applyUpdateToDoc(col.data[docIndex], update);

        col.dirty = true;
        this._scheduleSave(this.collectionName);

        const result = { updated: 1 };
        const duration = this._endTimer(start);
        const details = `ID: ${id} | Updated: 1`;
        this._logRequest('updateById', this.collectionName, details, duration, this._getDataSize(result));

        return result;
    }

    async paginate(filters = {}, options = {}) {
        const start = this._startTimer();

        const page = Math.max(1, parseInt(options.page) || 1);
        const limit = Math.max(1, parseInt(options.limit) || 10);
        const sort = options.sort || {};

        const skip = (page - 1) * limit;

        const totalItems = await this.count(this.collectionName, filters);
        const totalPages = Math.ceil(totalItems / limit);

        const items = await this.find(this.collectionName, filters, {
            sort,
            skip,
            limit
        });

        const result = {
            data: items,
            pagination: {
                page,
                limit,
                totalItems,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                nextPage: page < totalPages ? page + 1 : null,
                prevPage: page > 1 ? page - 1 : null,
                startIndex: totalItems > 0 ? skip + 1 : 0,
                endIndex: Math.min(skip + limit, totalItems)
            }
        };

        const duration = this._endTimer(start);
        const details = `Filters: ${this._formatFilters(filters)} | Page: ${page}/${totalPages} | Limit: ${limit}`;
        this._logRequest('paginate', this.collectionName, details, duration, this._getDataSize(result));

        return result;
    }

    async delete({ filters = {} }) {
        const start = this._startTimer();
        const col = this._getCollection(this.collectionName);
        const before = col.data.length;

        const idsToDelete = col.data
            .filter(d => this.queryEngine.matchesFilter(d, filters))
            .map(d => d.id)
            .filter(id => id !== undefined);

        col.data = col.data.filter(d => !this.queryEngine.matchesFilter(d, filters));
        const deleted = before - col.data.length;

        if (deleted) {
            idsToDelete.forEach(id => col.idIndex.delete(id));
            col.idIndex.clear();
            col.data.forEach((doc, idx) => {
                if (doc.id) col.idIndex.set(doc.id, idx);
            });

            col.dirty = true;
            this._scheduleSave(this.collectionName);
        }

        const result = { deleted };
        const duration = this._endTimer(start);
        const details = `Filters: ${this._formatFilters(filters)} | Deleted: ${deleted}`;
        this._logRequest('delete', this.collectionName, details, duration, this._getDataSize(result));

        return result;
    }

    async deleteById(id) {
        const start = this._startTimer();
        const col = this._getCollection(this.collectionName);
        const before = col.data.length;

        col.data = col.data.filter(d => !((d.id && d.id === id)));
        const deleted = before - col.data.length;

        if (deleted) {
            col.idIndex.delete(id);
            col.dirty = true;
            this._scheduleSave(this.collectionName);
        }

        const result = { deleted };
        const duration = this._endTimer(start);
        const details = `ID: ${id} | Deleted: ${deleted}`;
        this._logRequest('deleteById', this.collectionName, details, duration, this._getDataSize(result));

        return result;
    }

    async dropCollection() {
        this.collections.delete(this.collectionName);

        if (this.saveQueue.has(this.collectionName)) {
            clearTimeout(this.saveQueue.get(this.collectionName));
            this.saveQueue.delete(this.collectionName);
        }

        const filePath = path.join(this.storagePath, `${this.collectionName}.json`);
        try {
            await fs.unlink(filePath);
        } catch (e) { }

        return { dropped: true };
    }

    async saveCollections() {
        for (const timeout of this.saveQueue.values()) {
            clearTimeout(timeout);
        }
        this.saveQueue.clear();

        const saves = [];
        for (const [name, col] of this.collections) {
            if (col.dirty) {
                saves.push(this._flushToDisk(name));
            }
        }

        await Promise.all(saves);
    }

    async status() {
        const collections = [];
        let totalDocs = 0;
        let dirtyCount = 0;

        for (const [name, col] of this.collections) {
            collections.push({
                name,
                documents: col.data.length,
                dirty: col.dirty,
                lastSave: col.lastSave
            });
            totalDocs += col.data.length;
            if (col.dirty) dirtyCount++;
        }

        return {
            storagePath: this.storagePath,
            collections,
            totalDocuments: totalDocs,
            dirtyCollections: dirtyCount,
            pendingSaves: this.saveQueue.size
        };
    }

    async close() {
        await this.saveCollections();
        return true;
    }
}

class Collection {
    constructor(adapter, name) {
        this.adapter = adapter;
        this.name = name;
    }

    async count(filters = {}) {
        return this.adapter.request('GET', `/collections/${this.name}/count`, {
            filters
        });
    }

    async find(filters = {}, options = {}) {
        return this.adapter.request('GET', `/collections/${this.name}`, {
            filters,
            options
        });
    }

    async findOne(filters = {}, options = {}) {
        const results = await this.find(filters, { ...options, limit: 1 });
        return results && results.length > 0 ? results[0] : null;
    }

    async findById(id, options = {}) {
        return this.adapter.request('GET', `/collections/${this.name}/${id}`, {
            options
        });
    }

    async insert(data) {
        return this.adapter.request('POST', `/collections/${this.name}`, {
            data
        });
    }

    async update(filters, update) {
        return this.adapter.request('PATCH', `/collections/${this.name}`, {
            filters,
            update
        });
    }

    async updateById(id, update) {
        return this.adapter.request('PATCH', `/collections/${this.name}/${id}`, {
            update
        });
    }

    async paginate(filters, options = {}) {
        return this.adapter.request('GET', `/collections/${this.name}/paginate`, {
            filters,
            options
        });
    }

    async delete(filters) {
        if (!filters) {
            throw new Error('Delete operation requires filters to prevent accidental deletion of all documents. {} or use .drop() to delete entire collection.');
        }

        return this.adapter.request('DELETE', `/collections/${this.name}`, {
            filters
        });
    }

    async deleteById(id) {
        if (!id) {
            throw new Error('deleteById operation requires a valid document ID.');
        }
        return this.adapter.request('DELETE', `/collections/${this.name}/${id}`);
    }

    async drop() {
        return this.adapter.request('DELETE', `/collections/${this.name}/drop`);
    }
}

class LiekoDB {
    constructor(options = {}) {
        this.debug = options.debug || false;
        this.adapter = this._createAdapter(options);
    }

    _createAdapter(options) {
        if (options.token) {
            return new HTTPAdapter(options);
        }
        return new LocalAdapter(options);
    }

    _validateCollectionName(name) {
        if (!name || typeof name !== 'string') {
            throw new Error(`Collection name must be a non-empty string, got: ${typeof name}`);
        }

        if (name.length < 1) {
            throw new Error('Collection name cannot be empty');
        }

        if (name.length > 64) {
            throw new Error(`Collection name too long (${name.length} > 64 characters)`);
        }

        const validNameRegex = /^[a-zA-Z0-9_-]+$/;
        if (!validNameRegex.test(name)) {
            throw new Error(
                `Invalid collection name: "${name}". ` +
                `Only alphanumeric characters, underscores (_) and hyphens (-) are allowed.`
            );
        }

        if (/^[0-9_-]/.test(name)) {
            throw new Error('Collection name cannot start with a number, underscore or hyphen');
        }

        const invalidPatterns = [
            /\.\./,
            /\/|\\/,
            /^\./,
            /\s/,
            /[<>:"|?*]/,
        ];

        for (const pattern of invalidPatterns) {
            if (pattern.test(name)) {
                throw new Error(`Collection name contains invalid characters: "${name}"`);
            }
        }

        return true;
    }

    collection(name) {
        this._validateCollectionName(name);
        return new Collection(this.adapter, name);
    }

    async listCollections() {
        return this.adapter.listCollections();
    }

    async dropCollection(name) {
        this._validateCollectionName(name);
        return this.adapter.dropCollection(name);
    }

    async status() {
        return this.adapter.status();
    }

    async close() {
        return this.adapter.close();
    }

    _log(...args) {
        if (this.debug) console.log('[LiekoDB]', ...args);
    }
}

module.exports = LiekoDB;
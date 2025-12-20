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
        if (!projection || Object.keys(projection).length === 0) {
            return data;
        }

        const hasIncludeFields = Object.values(projection).some(v => v === 1 || v === true);
        const hasExcludeFields = Object.values(projection).some(v => v === -1 || v === false);

        // Inclusion (fields: {name: 1, age: 1})
        if (hasIncludeFields && !hasExcludeFields) {
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

        // Exclusion (fields: {name: -1, age: -1})
        if (hasExcludeFields && !hasIncludeFields) {
            return data.map(doc => {
                const result = { ...doc };
                for (const [field, exclude] of Object.entries(projection)) {
                    if (exclude === -1 || exclude === false) {
                        const parts = field.split('.');
                        if (parts.length === 1) {
                            delete result[field];
                        } else {
                            this._removeFieldByPath(result, field);
                        }
                    }
                }
                return result;
            });
        }
        console.warn('Mixed inclusion/exclusion in projection not supported. Returning full documents.');
        return data;
    }

    _removeFieldByPath(obj, path) {
        const parts = path.split('.');
        let current = obj;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] === undefined || typeof current[part] !== 'object') {
                return;
            }
            current = current[part];
        }

        const lastPart = parts[parts.length - 1];
        delete current[lastPart];
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
        } catch (e) { }
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
                        } catch (e) { }
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
        this.saveDelay = opts.saveDelay || 100;

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

    _formatDuration(ms) {
        if (ms < 0.001) return `${(ms * 1000).toFixed(2)} µs`;
        if (ms < 1) return `${(ms * 1000).toFixed(0)} µs`;
        if (ms < 1000) return `${ms.toFixed(2)} ms`;
        return `${(ms / 1000).toFixed(2)} s`;
    }

    /**
     * TODO: when filter is regex, log is only {}
     * {{ email: { '$regex': /@google\.com$/ } }
     * [LiekoDB] FIND users | Duration: 101µs | Response Size: 175 B | Filters: {email:{$regex:{}}} | Found: 1}
     */
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
        const diffNs = end - start;
        return Number(diffNs) / 1_000_000;  // ms
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
            idIndex: new Map(),
            indexes: new Map()
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

    _updateIndexesOnInsert(col, doc, docIdx) {
        for (const index of col.indexes.values()) {
            let node = index.map;

            for (let i = 0; i < index.fields.length; i++) {
                const value = doc[index.fields[i]];
                if (value === undefined) return;

                if (!node.has(value)) {
                    node.set(value, i === index.fields.length - 1 ? [] : new Map());
                }
                node = node.get(value);
            }

            node.push(docIdx);
        }
    }

    _removeFromIndex(index, doc, docIdx) {
        let node = index.map;
        const path = [];

        for (let i = 0; i < index.fields.length; i++) {
            const field = index.fields[i];
            const value = doc[field];

            if (value === undefined || !node.has(value)) {
                return;
            }

            path.push([node, value]);
            node = node.get(value);
        }

        if (Array.isArray(node)) {
            const pos = node.indexOf(docIdx);
            if (pos !== -1) {
                node.splice(pos, 1);

                if (node.length === 0) {
                    for (let i = path.length - 1; i >= 0; i--) {
                        const [parentNode, key] = path[i];
                        if (i === path.length - 1) {
                            parentNode.delete(key);
                        } else {
                            const child = parentNode.get(key);
                            if (child.size === 0) {
                                parentNode.delete(key);
                            } else {
                                break;
                            }
                        }
                    }
                }
            }
        }
    }

    async request(method, endpoint, payload = {}) {
        const parts = endpoint.split("/").filter(Boolean);
        // Payload can contains filters, options, data, update

        this.collectionName = parts[1];
        const param = parts[2];

        if (method === "POST" && param === "indexes") {
            return this.createIndex(payload.index);
        }

        if (method === "GET" && !param) return this.find(payload);
        if (method === "GET" && param === "count") return this.count(payload);
        if (method === "GET" && param === "paginate") return this.paginate(payload.filters, payload.options);
        if (method === "GET" && param) return this.findById(param);

        if (method === "POST") return this.insert(payload);

        if (method === "PATCH" && param) return this.updateById(param, payload);
        if (method === "PATCH") return this.update(payload);

        if (method === "DELETE" && param === "drop") return this.dropCollection();
        if (method === "DELETE" && param) return this.deleteById(param);
        if (method === "DELETE") return this.delete(payload);

        throw new Error(`Unsupported endpoint: ${method} ${endpoint}`);
    }

    async createIndex(indexDef) {
        console.log('Creation of index:', indexDef)
        try {
            const col = this._getCollection(this.collectionName);

            const fields = Object.keys(indexDef);
            if (fields.length === 0) {
                return {
                    success: false,
                    data: null,
                    error: { message: 'Index definition cannot be empty', code: 400 }
                };
            }

            const orders = fields.map(f => indexDef[f]);
            if (!orders.every(o => o === 1 || o === -1)) {
                return {
                    success: false,
                    data: null,
                    error: { message: 'Index order must be 1 or -1', code: 400 }
                };
            }

            const indexKey = fields.map(f => `${f}:${indexDef[f]}`).join('|');
            if (col.indexes.has(indexKey)) {
                return {
                    success: false,
                    data: null,
                    error: { message: 'Index already exists', code: 409 }
                };
            }

            const index = {
                fields,
                orders,
                map: new Map()
            };

            col.data.forEach((doc, docIdx) => {
                let node = index.map;

                for (let i = 0; i < fields.length; i++) {
                    const value = doc[fields[i]];
                    if (value === undefined) return;

                    if (!node.has(value)) {
                        node.set(value, i === fields.length - 1 ? [] : new Map());
                    }
                    node = node.get(value);
                }

                node.push(docIdx);
            });

            col.indexes.set(indexKey, index);

            return {
                success: true,
                data: {
                    fields,
                    orders,
                    size: index.map.size
                },
                error: null
            };

        } catch (error) {
            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Failed to create index',
                    code: 500
                }
            };
        }
    }

    async count({ filters = {} } = {}) {
        const start = this._startTimer();

        try {
            const col = this._getCollection(this.collectionName);

            if (filters && typeof filters !== 'object') {
                throw new Error('Filters must be an object');
            }

            const count = this.queryEngine.count(col.data, filters);

            const duration = this._endTimer(start);
            const details = `Filters: ${this._formatFilters(filters)} | Count: ${count}`;
            this._logRequest('count', this.collectionName, details, duration, this._getDataSize(count));

            return {
                success: true,
                data: count,
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] COUNT ERROR: ${error.message}`);
            this._logRequest('count', this.collectionName, `Error: ${error.message}`);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Failed to count documents',
                    code: 500
                }
            };
        }
    }

    async find({ filters = {}, options = {} } = {}) {
        const start = this._startTimer();

        try {
            const col = this._getCollection(this.collectionName);

            if (filters && typeof filters !== 'object') {
                throw new Error('Filters must be an object');
            }

            const validOperators = ['$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin',
                '$exists', '$regex', '$and', '$or', '$not'];

            const validateFilter = (filter) => {
                for (const key in filter) {
                    if (key.startsWith('$') && !validOperators.includes(key)) {
                        throw new Error(`Invalid query operator: ${key}. Valid operators: ${validOperators.join(', ')}`);
                    }
                    if (filter[key] && typeof filter[key] === 'object') {
                        validateFilter(filter[key]);
                    }
                }
            };

            validateFilter(filters);

            let allResults = this.queryEngine.applyFilters(col.data, filters);
            let data = [...allResults];

            if (options.sort) {
                if (typeof options.sort !== 'object') {
                    throw new Error('Sort must be an object');
                }
                data = this.queryEngine.sortResults(data, options.sort);
            }

            if (options.skip) {
                if (options.skip < 0) {
                    throw new Error('Skip cannot be negative');
                }
                data = data.slice(options.skip);
            }

            if (options.limit) {
                const limitValue = typeof options.limit === 'string'
                    ? options.limit.toLowerCase()
                    : options.limit;

                if (limitValue !== 'all') {
                    const limitNum = parseInt(limitValue, 10);
                    if (isNaN(limitNum)) {
                        throw new Error('Limit must be a number or "all"');
                    }
                    if (limitNum < 0) {
                        throw new Error('Limit cannot be negative');
                    }
                    data = data.slice(0, limitNum);
                }
            }

            if (options.fields) {
                if (typeof options.fields !== 'object') {
                    throw new Error('Fields must be an object');
                }
                data = this.queryEngine.selectFields(data, options.fields);
            }

            const total = allResults.length;
            const returnedCount = data.length;
            const duration = this._endTimer(start);

            if (total === 0) {
                return {
                    success: false,
                    data: [],
                    total: 0,
                    error: { message: 'No documents found matching the criteria', code: 404 }
                };
            }

            const response = {
                success: true,
                data,
                total,
                error: null
            };

            if (options.limit && options.limit !== 'all') {
                const limitNum = parseInt(options.limit, 10);
                const skipNum = options.skip || 0;

                response.pagination = {
                    limit: limitNum,
                    skip: skipNum,
                    page: skipNum > 0 ? Math.floor(skipNum / limitNum) + 1 : 1,
                    totalPages: Math.ceil(total / limitNum),
                    hasMore: (skipNum + returnedCount) < total
                };
            }

            const details = `Filters: ${this._formatFilters(filters)}${this._formatOptions(options)} | Found: ${total} | Returned: ${returnedCount}`;
            this._logRequest('find', this.collectionName, details, duration, this._getDataSize(response));

            return response;

        } catch (error) {
            console.error(`[LiekoDB] FIND ERROR: ${error.message}`);
            this._logRequest('find', this.collectionName, `Error: ${error.message}`);

            return {
                success: false,
                data: [],
                total: 0,
                error: {
                    message: error.message || 'An unexpected error occurred during find',
                    code: 500
                }
            };
        }
    }

    async findById(id) {
        const start = this._startTimer();

        try {
            const col = this._getCollection(this.collectionName);

            let found = null;
            if (col.idIndex?.has(id)) {
                found = col.data[col.idIndex.get(id)];
            } else {
                found = col.data.find(d => d.id === id);
            }

            const duration = this._endTimer(start);
            const details = `ID: ${id} | Found: ${found ? 'Yes' : 'No'}`;
            this._logRequest('find_By_Id', this.collectionName, details, duration, this._getDataSize(found));

            if (!found) {
                return {
                    success: false,
                    data: null,
                    error: { message: 'Document not found', code: 404 }
                };
            }

            return {
                success: true,
                data: found,
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] FIND_BY_ID ERROR: ${error.message}`);
            this._logRequest('findById', this.collectionName, `Error: ${error.message}`);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Internal error during findById',
                    code: 500
                }
            };
        }
    }

    async insert({ data }) {
        const start = this._startTimer();

        try {
            const col = this._getCollection(this.collectionName);
            const toInsert = Array.isArray(data) ? data : [data];
            const now = new Date().toISOString();
            // now to avoid big insert array delay

            const inserted = [];
            const updated = [];

            const insertCount = toInsert.length;
            const useSequentialIds = insertCount >= 2;
            let prefix = null;
            let sequence = 0;
            let allIdsWereGenerated = true;

            if (useSequentialIds) {
                prefix = Date.now().toString(36);
            }

            for (let doc of toInsert) {
                let docId = doc.id;

                if (!docId) {
                    if (useSequentialIds) {
                        sequence++;
                        docId = `${prefix}_${sequence}`;
                    } else {
                        docId = this.generateId();
                    }
                    docId = String(docId);
                    doc.id = docId;
                } else {
                    docId = String(docId);
                    doc.id = docId;
                    allIdsWereGenerated = false;
                }

                const existingIndex = col.idIndex.has(docId) ? col.idIndex.get(docId) : -1;

                if (existingIndex !== -1) {
                    const existingDoc = col.data[existingIndex];
                    const originalCreatedAt = existingDoc.createdAt;

                    Object.assign(existingDoc, doc);
                    existingDoc.createdAt = originalCreatedAt;
                    existingDoc.updatedAt = now;

                    col.data[existingIndex] = existingDoc;
                    updated.push(existingDoc);
                } else {
                    doc.id = docId;
                    doc.createdAt = doc.createdAt || now;

                    const newIndex = col.data.length;
                    col.data.push(doc);
                    col.idIndex.set(docId, newIndex);
                    this._updateIndexesOnInsert(col, doc, newIndex);
                    inserted.push(doc);
                }
            }

            if (inserted.length > 0 || updated.length > 0) {
                col.dirty = true;
                this._scheduleSave(this.collectionName);
            }

            const responseData = {
                insertedCount: inserted.length,
                updatedCount: updated.length
            };

            if (inserted.length > 0) {
                if (inserted.length > 20) {
                    responseData.firstId = inserted[0].id;
                    responseData.lastId = inserted[inserted.length - 1].id;

                    if (allIdsWereGenerated && useSequentialIds) {
                        responseData.prefix = prefix + "_";
                    }
                } else {
                    responseData.insertedIds = inserted.map(d => d.id);
                }
            }

            const duration = this._endTimer(start);
            const details = updated.length > 0
                ? `Inserted: ${inserted.length}, Updated: ${updated.length}`
                : `Inserted: ${inserted.length}`;
            this._logRequest('insert', this.collectionName, details, duration, this._getDataSize(responseData));

            return {
                success: true,
                data: responseData,
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] INSERT ERROR: ${error.message}`);
            this._logRequest('insert', this.collectionName, `Error: ${error.message}`);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Failed to insert documents',
                    code: 500
                }
            };
        }
    }

    async update(payload) {
        const start = this._startTimer();

        try {
            const {
                filters = {},
                update: updateOperations,
                returnType = 'count', // 'count' | 'ids' | 'documents'
                maxReturn = 50
            } = payload;

            const col = this._getCollection(this.collectionName);

            const normalizedUpdate = updateOperations.$set || updateOperations.$inc ||
                updateOperations.$push || updateOperations.$pull ||
                updateOperations.$unset || updateOperations.$addToSet
                ? updateOperations
                : { $set: updateOperations };

            let updated = 0;
            const allUpdatedDocs = [];

            for (let i = 0; i < col.data.length; i++) {
                if (this.queryEngine.matchesFilter(col.data[i], filters)) {
                    const before = returnType !== 'count'
                        ? JSON.parse(JSON.stringify(col.data[i]))
                        : null;

                    this.queryEngine.applyUpdateToDoc(col.data[i], normalizedUpdate);
                    col.data[i].updatedAt = new Date().toISOString();

                    updated++;

                    if (returnType !== 'count') {
                        allUpdatedDocs.push({
                            before,
                            after: col.data[i]
                        });
                    }
                }
            }

            if (updated > 0) {
                col.dirty = true;
                this._scheduleSave(this.collectionName);
            }

            if (updated === 0) {
                const duration = this._endTimer(start);
                this._logRequest('update', this.collectionName, `Filters: ${this._formatFilters(filters)} | Updated: 0 (no match)`, duration);

                return {
                    success: false,
                    data: null,
                    error: { message: 'No documents matched the filters', code: 404 }
                };
            }

            const responseData = {
                updatedCount: updated
            };

            if (returnType === 'ids' && allUpdatedDocs.length > 0) {
                const ids = allUpdatedDocs.map(item => item.after.id);
                responseData.updatedIds = ids.slice(0, maxReturn);
                if (ids.length > maxReturn) {
                    responseData.truncated = true;
                    responseData.total = ids.length;
                    responseData.maxReturn = maxReturn;
                }
            } else if (returnType === 'documents' && allUpdatedDocs.length > 0) {
                const docs = allUpdatedDocs.map(item => item.after);
                responseData.documents = docs.slice(0, maxReturn);
                if (docs.length > maxReturn) {
                    responseData.truncated = true;
                    responseData.total = docs.length;
                    responseData.maxReturn = maxReturn;
                }
            }

            const duration = this._endTimer(start);
            const details = `Filters: ${this._formatFilters(filters)} | Updated: ${updated} | ReturnType: ${returnType}`;
            this._logRequest('update', this.collectionName, details, duration, this._getDataSize(responseData));

            return {
                success: true,
                data: responseData,
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] UPDATE ERROR: ${error.message}`);
            this._logRequest('update', this.collectionName, `Error: ${error.message}`);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Failed to update documents',
                    code: 500
                }
            };
        }
    }

    async updateById(id, payload) {
        const start = this._startTimer();

        try {
            const {
                update: updateOperations,
                returnType = 'document' // 'id' | 'document'
            } = payload;

            const col = this._getCollection(this.collectionName);

            let docIndex = -1;
            if (col.idIndex?.has(id)) {
                docIndex = col.idIndex.get(id);
            } else {
                docIndex = col.data.findIndex(d => d.id === id);
            }

            if (docIndex === -1) {
                const duration = this._endTimer(start);
                this._logRequest('updateById', this.collectionName, `ID: ${id} | Not found`, duration);

                return {
                    success: false,
                    data: null,
                    error: { message: 'Document not found', code: 404 }
                };
            }

            this.queryEngine.applyUpdateToDoc(col.data[docIndex], updateOperations);

            const updatedDocument = col.data[docIndex];

            col.dirty = true;
            this._scheduleSave(this.collectionName);

            const responseData = {
                updatedCount: 1,
                updatedId: id
            };

            if (returnType === 'document') {
                responseData.document = updatedDocument;
            }

            const duration = this._endTimer(start);
            const details = `ID: ${id} | ReturnType: ${returnType} | Updated: 1`;
            this._logRequest('updateById', this.collectionName, details, duration, this._getDataSize(responseData));

            return {
                success: true,
                data: responseData,
                error: null
            };

        } catch (error) {
            const duration = this._endTimer(start);
            console.error(`[LiekoDB] UPDATE_BY_ID ERROR: ${error.message}`);
            this._logRequest('updateById', this.collectionName, `Error: ${error.message}`, duration);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Failed to update document',
                    code: 400
                }
            };
        }
    }

    async paginate(filters = {}, options = {}) {
        const start = this._startTimer();

        try {
            const page = Math.max(1, parseInt(options.page) || 1);
            const limit = Math.max(1, parseInt(options.limit) || 10);

            if (isNaN(page) || isNaN(limit)) {
                const duration = this._endTimer(start);
                this._logRequest('paginate', this.collectionName, 'Invalid page/limit params', duration);

                return {
                    success: false,
                    data: null,
                    total: 0,
                    error: {
                        message: 'Page and limit must be valid numbers',
                        code: 400
                    }
                };
            }

            const skip = (page - 1) * limit;

            const findResult = await this.find({
                filters,
                options: {
                    ...options,
                    skip,
                    limit
                }
            });

            if (!findResult.success) {
                return findResult;
            }

            const { data, total } = findResult;
            const totalItems = total;
            const totalPages = totalItems > 0 ? Math.ceil(totalItems / limit) : 0;

            let error = null;
            if (totalItems === 0) {
                error = { message: 'No documents found', code: 404 };
            } else if (page > totalPages && totalPages > 0) {
                error = {
                    message: `Page ${page} is out of range. Total pages: ${totalPages}`,
                    code: 404
                };
            }

            const pagination = {
                page,
                limit,
                skip,
                total: totalItems,
                totalPages,
                hasMore: page < totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                nextPage: page < totalPages ? page + 1 : null,
                prevPage: page > 1 ? page - 1 : null,
                startIndex: totalItems > 0 && page <= totalPages ? skip + 1 : 0,
                endIndex: page <= totalPages ? Math.min(skip + limit, totalItems) : 0
            };

            const result = {
                success: !error,
                data,
                total: totalItems,
                pagination,
                error
            };

            const duration = this._endTimer(start);
            const details = `Filters: ${this._formatFilters(filters)} | Page: ${page}/${totalPages} | Limit: ${limit} | Found: ${totalItems}`;
            this._logRequest('paginate', this.collectionName, details, duration, this._getDataSize(result));

            return result;

        } catch (error) {
            console.error(`[LiekoDB] PAGINATE ERROR: ${error.message}`);
            this._logRequest('paginate', this.collectionName, `Error: ${error.message}`);

            return {
                success: false,
                data: null,
                total: 0,
                error: {
                    message: error.message || 'An unexpected error occurred during pagination',
                    code: 500
                }
            };
        }
    }

    async delete({ filters = {} }) {
        const start = this._startTimer();

        try {
            const col = this._getCollection(this.collectionName);
            const before = col.data.length;

            const idsToDelete = col.data
                .filter(d => this.queryEngine.matchesFilter(d, filters))
                .map(d => d.id)
                .filter(id => id !== undefined);

            col.data = col.data.filter(d => !this.queryEngine.matchesFilter(d, filters));
            const deleted = before - col.data.length;

            if (deleted > 0) {
                idsToDelete.forEach(id => col.idIndex.delete(id));
                col.idIndex.clear();
                col.data.forEach((doc, idx) => {
                    if (doc.id) col.idIndex.set(doc.id, idx);
                });

                col.dirty = true;
                this._scheduleSave(this.collectionName);
            }

            const duration = this._endTimer(start);
            const details = `Filters: ${this._formatFilters(filters)} | Deleted: ${deleted}`;
            this._logRequest('delete', this.collectionName, details, duration, this._getDataSize({ deleted }));

            if (deleted === 0) {
                return {
                    success: false,
                    data: null,
                    error: { message: 'No documents matched the filters', code: 404 }
                };
            }

            return {
                success: true,
                data: { deletedCount: deleted },
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] DELETE ERROR: ${error.message}`);
            this._logRequest('delete', this.collectionName, `Error: ${error.message}`);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Failed to delete documents',
                    code: 500
                }
            };
        }
    }

    async deleteById(id) {
        const start = this._startTimer();
        try {
            const col = this._getCollection(this.collectionName);
            const docIdx = col.idIndex.get(id);

            if (docIdx === undefined) {
                const duration = this._endTimer(start);
                this._logRequest('delete_By_Id', this.collectionName, `ID: ${id} | Not found`, duration);
                return {
                    success: false,
                    data: null,
                    error: { message: 'Document not found', code: 404 }
                };
            }

            const doc = col.data[docIdx]; // on récupère le doc via son indice

            // Suppression physique
            col.data.splice(docIdx, 1); // plus rapide que filter + reconstruit le tableau

            // Mise à jour de idIndex
            col.idIndex.delete(id);

            // Mise à jour de tous les indexes secondaires
            for (const index of col.indexes.values()) {
                this._removeFromIndex(index, doc, docIdx);
            }

            // Réindexer les indices des documents suivants (car on a décalé avec splice)
            for (let i = docIdx; i < col.data.length; i++) {
                const d = col.data[i];
                if (d.id) {
                    col.idIndex.set(d.id, i);
                }
            }

            col.dirty = true;
            this._scheduleSave(this.collectionName);

            const duration = this._endTimer(start);
            this._logRequest('delete_By_Id', this.collectionName, `ID: ${id} | Deleted`, duration);

            return {
                success: true,
                data: { deletedCount: 1, deletedId: id },
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] DELETE_BY_ID ERROR: ${error.message}`);
            this._logRequest('delete_By_Id', this.collectionName, `Error: ${error.message}`);
            return {
                success: false,
                data: null,
                error: { message: error.message || 'Failed to delete document by ID', code: 500 }
            };
        }
    }

    async dropCollection() {
        const start = this._startTimer();

        try {
            this.collections.delete(this.collectionName);

            if (this.saveQueue.has(this.collectionName)) {
                clearTimeout(this.saveQueue.get(this.collectionName));
                this.saveQueue.delete(this.collectionName);
            }

            const filePath = path.join(this.storagePath, `${this.collectionName}.json`);

            try {
                await fs.unlink(filePath);
            } catch (err) {
                if (err.code === 'ENOENT') {
                    // Idempotent
                } else {
                    this._logRequest('dropCollection', this.collectionName, `Error deleting file: ${err.message}`);

                    return {
                        success: false,
                        data: null,
                        error: {
                            message: `Failed to delete collection file: ${err.message}`,
                            code: err.code === 'EACCES' ? 403 : 500
                        }
                    };
                }
            }

            const duration = this._endTimer(start);
            this._logRequest('dropCollection', this.collectionName, 'Success', duration);

            return {
                success: true,
                data: { dropped: true },
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] DROP_COLLECTION ERROR: ${error.message}`);
            this._logRequest('dropCollection', this.collectionName, `Unexpected error: ${error.message}`);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Unexpected error during dropCollection',
                    code: 500
                }
            };
        }
    }

    async saveCollections() {
        const start = this._startTimer();

        try {
            for (const timeout of this.saveQueue.values()) {
                clearTimeout(timeout);
            }
            this.saveQueue.clear();

            const saves = [];
            const failedCollections = [];

            for (const [name, col] of this.collections) {
                if (col.dirty) {
                    saves.push(
                        this._flushToDisk(name)
                            .catch(err => {
                                failedCollections.push({
                                    collection: name,
                                    error: err.message || 'Failed to save collection'
                                });
                            })
                    );
                }
            }

            await Promise.all(saves);

            const duration = this._endTimer(start);
            const details = failedCollections.length > 0
                ? `Saved ${saves.length - failedCollections.length}/${saves.length} collections | Failed: ${failedCollections.map(f => f.collection).join(', ')}`
                : `Saved ${saves.length} dirty collections`;

            this._logRequest('saveCollections', 'all', details, duration);

            if (failedCollections.length > 0) {
                return {
                    success: false,
                    data: {
                        savedCount: saves.length - failedCollections.length,
                        failedCount: failedCollections.length,
                        failedCollections: failedCollections.map(f => f.collection)
                    },
                    error: {
                        message: `Failed to save ${failedCollections.length} collection(s)`,
                        code: 500,
                        details: failedCollections
                    }
                };
            }

            return {
                success: true,
                data: {
                    savedCount: saves.length,
                    savedCollections: Array.from(this.collections.keys())
                },
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] SAVE_COLLECTIONS ERROR: ${error.message}`);
            this._logRequest('saveCollections', 'all', `Unexpected error: ${error.message}`);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Unexpected error during global save',
                    code: 500
                }
            };
        }
    }

    async saveCollection(name) {
        const start = this._startTimer();

        try {
            if (!this.collections.has(name)) {
                const duration = this._endTimer(start);
                this._logRequest('saveCollection', name, 'Collection does not exist', duration);

                return {
                    success: false,
                    data: null,
                    error: {
                        message: `Collection "${name}" does not exist`,
                        code: 404
                    }
                };
            }

            const col = this.collections.get(name);

            if (!col.dirty) {
                const duration = this._endTimer(start);
                this._logRequest('saveCollection', name, 'No changes (not dirty)', duration);

                return {
                    success: true,
                    data: { saved: false, reason: 'No changes' },
                    error: null
                };
            }

            if (this.saveQueue.has(name)) {
                clearTimeout(this.saveQueue.get(name));
                this.saveQueue.delete(name);
            }

            await this._flushToDisk(name);

            col.dirty = false;

            const duration = this._endTimer(start);
            this._logRequest('saveCollection', name, 'Success', duration);

            return {
                success: true,
                data: {
                    saved: true,
                    collection: name
                },
                error: null
            };

        } catch (error) {
            console.error(`[LiekoDB] SAVE_COLLECTION ERROR: ${error.message}`);
            this._logRequest('saveCollection', name, `Error: ${error.message}`);

            return {
                success: false,
                data: null,
                error: {
                    message: error.message || 'Failed to save collection',
                    code: 500
                }
            };
        }
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

    async createIndex(indexDef) {
        return this.adapter.request(
            'POST',
            `/collections/${this.name}/indexes`,
            { index: indexDef }
        );
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
        const response = await this.adapter.request('GET', `/collections/${this.name}`, {
            filters,
            options: { limit: 1, sort: { createdAt: -1 }, ...options }
        });

        if (!response.success) {
            return { success: false, data: null, error: response.error || { message: 'Request failed', code: 500 } };
        }

        const doc = response.data?.[0];

        return doc
            ? { success: true, data: doc, error: null }
            : { success: false, data: null, error: { message: 'Document not found', code: 404 } };
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

    async update(filters, update, options = {}) {
        return this.adapter.request('PATCH', `/collections/${this.name}`, {
            filters,
            update,
            ...options
        });
    }

    async updateById(id, update, options = {}) {
        return this.adapter.request('PATCH', `/collections/${this.name}/${id}`, {
            update,
            ...options
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
        return this.adapter.request('DELETE', `/collections/${this.name}`);
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
# LiekoDB • The Fastest Local JSON Database Ever Built
[![Performance](https://img.shields.io/badge/Performance-36ms%20%2F%20100k%20docs-green)]()
[![License](https://img.shields.io/badge/License-MIT-blue)]()
[![Node](https://img.shields.io/badge/Node-%3E%3D14.0.0-brightgreen)]()

> **LiekoDB** - Ultra-fast local database for Node.js with MongoDB-like syntax



Perfect for:
- Electron / Tauri apps
- Desktop tools & CLI
- Offline-first web apps
- Game save systems
- Analytics dashboards
- Bots & automation



**100,000 documents in 19.8 ms · 5 million ops/sec · Pure JavaScript · Zero dependencies**

| Documents   | Insert          | Complex Query      | Update (~66%)     | Per Document |
|-------------|-----------------|--------------------|-------------------|--------------|
| 100         | 184 µs          | 45 µs              | 199 µs            | ~2 µs        |
| 1 000       | 356 µs          | 246 µs             | 1.08 ms           | ~350 ns      |
| 10 000      | 2.36 ms         | 1.29 ms            | 9.45 ms           | ~200 ns      |
| 50 000      | 9.99 ms         | 7.49 ms            | 46 ms             | ~200 ns      |
| **100 000** | **19.85 ms**    | **13.02 ms**       | **100 ms**        | **198.5 ns** |
| **250 000** | **69.4 ms**     | **33.5 ms**        | **223 ms**        | **277 ns**   |

> **Peak throughput: 5,037,113 documents/second**  
> **Faster than LokiJS, NeDB, lowdb, SQLite (in-memory), and most embedded DBs**  
> **Real MongoDB-like query engine** (`$gt`, `$in`, `$regex`, nested fields, `$inc`, `$set`)  
> **Zero native dependencies · Runs anywhere Node.js runs**

| Machine                          | 100,000 inserts | Complex query          | Peak throughput       |
|----------------------------------|-----------------|------------------------|-----------------------|
| High-end desktop (NVMe)          | **19.8 ms**     | 13.0 ms                | **5.0 million/sec**   |
| Cheap $5/month KVM VPS (no debug)| **130.2 ms**    | 63.1 ms                | **768 000 docs/sec**  |
| Same VPS with debug logs         | 174 ms          | 51.7 ms                | 575 000 docs/sec      |

Even on the cheapest VPS, LiekoDB is **4–10× faster** than LokiJS, NeDB, lowdb, TaffyDB combined.

(made by examples/perf_test.js)


## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [CRUD Operations](#crud-operations)
  - [Insert](#insert)
  - [Find](#find)
  - [Update](#update)
  - [Pagination](#paginate)
  - [Delete](#delete)
- [Filters and Operators](#filters-and-operators)
- [Advanced Options](#advanced-options)
- [Collection Management](#collection-management)
- [Complete Examples](#complete-examples)
- [API Reference](#api-reference)
- [Best Practices](#best-practices)
- [Limitations](#limitations)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Support](#support)
---

## 🚀 Installation

```bash
npm install liekodb
```

## ⚡ Quick Start

```javascript
const LiekoDB = require('liekodb');

// Initialize database
const db = new LiekoDB({ 
    storagePath: './data',
    debug: true 
});

// Create a collection
const users = db.collection('users');

(async () => {
    // Insert data
    await users.insert({ name: 'Alice', age: 25 });

    // Query
    const allUsers = await users.find();
    console.log(allUsers);

    // Close to guarantee save (recommended but not required)
    await db.close();
})();
```

> **💡 Auto-save behavior**: LiekoDB automatically saves data 50ms after modifications. If your script runs longer than this delay, data will be saved even without calling `close()`. However, calling `close()` is **strongly recommended** to guarantee data persistence, especially in short-lived scripts.

---

## ⚙️ Configuration

### Constructor Options

```javascript
const db = new LiekoDB({
    storagePath: './storage',  // Storage directory (default: './storage')
    debug: false,              // Enable detailed logs (default: false)
    saveDelay: 50              // Auto-save delay in ms (default: 50)
});
```

**About `saveDelay`:**
- After any write operation (insert, update, delete), LiekoDB schedules a save after this delay
- Purpose: Batches multiple operations together for better performance
- If you need immediate saves: Use `await db.close()` after operations
- If you have long-running scripts: Auto-save will trigger automatically
- Shorter delay = more frequent saves but potentially lower performance

### Lifecycle Management

```javascript
// Recommended: Always close DB before exiting for guaranteed save
process.on('SIGINT', async () => {
    await db.close();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await db.close();
    process.exit(0);
});
```

**Understanding Auto-save vs Manual Close:**

```javascript
// ✅ Will save automatically (if process stays alive > 50ms)
(async () => {
    await users.insert({ name: 'Alice' });
    // Data will be saved after 50ms delay
})();

// ❌ Will NOT save (process exits immediately)
(async () => {
    await users.insert({ name: 'Alice' });
})();
process.exit(); // Exits before 50ms save delay!

// ✅ Guaranteed save with close()
(async () => {
    await users.insert({ name: 'Alice' });
    await db.close(); // Forces immediate save
    process.exit();   // Safe to exit now
})();
```

**Rule of thumb**: 
- Long-running apps (servers, daemons): `close()` optional
- Short scripts: Always use `close()` before exit
- Production apps: Always use `close()` in signal handlers

---

## 📝 CRUD Operations

### Insert

#### Insert a Document

```javascript
const result = await users.insert({
    name: 'Alice',
    age: 25,
    email: 'alice@example.com'
});

console.log(result);
// { inserted: 1, insertedId: 'd9c4ed3e56a8279b' }
```

#### Insert Multiple Documents

```javascript
await users.insert([
    { name: 'Bob', age: 30 },
    { name: 'Charlie', age: 35 },
    { name: 'Diana', age: 28 }
]);
/*
{
  inserted: 3,
  insertedIds: [ 'mil5b3k6_0001', 'mil5b3k6_0002', 'mil5b3k6_0003' ]
}
*/


const usersToInsert = [];
    for (let i = 0; i < 30; i++) {
        usersToInsert.push({
            name: 'User_' + i,
            age: 1 + (i % 50)
        });
    }
await users.insert(usersToInsert);
/*
{
  inserted: 30,
  firstId: 'mil5hxei_1',
  lastId: 'mil5hxei_30',
  prefix: 'mil5hxei_'
}

If insert is more than 20, you get firstId and lastId
*/
```

#### Insert with Custom ID

```javascript
await users.insert({
    id: 'user_123',
    name: 'Alice',
    age: 25
});
//{ inserted: 1, insertedId: 'user_123' }


await users.insert([
    { id: 1, name: 'Alice', age: 30 },
    { id: 2, name: 'Bob', age: 25 },
    { id: 3, name: 'Charlie', age: 35 }
]);
// { inserted: 3, insertedIds: [ 1, 2, 3 ] }

// If insert count is less than 20, you can get users.insertedIds
// else you get firstId and lastId

const usersToInsert = [];
for (let i = 0; i < 30; i++) {
    usersToInsert.push({
        id: 'user_' + i,
        name: 'User_' + i,
        age: 1 + (i % 50)
    });
}
await users.insert(usersToInsert);
// { inserted: 30, firstId: 'user_0', lastId: 'user_29' }
```

> **Note**: If you insert a document with an existing `id`, it will be **updated** instead of duplicated (upsert behavior).

#### Automatic Timestamps

Each document automatically receives:
- `createdAt`: Creation date (ISO 8601)
- `updatedAt`: Last modification date (only when updated record)

```javascript
{
    id: 'a1b2c3d4',
    name: 'Alice',
    age: 25,
    createdAt: '2024-01-15T10:30:00.000Z',
    updatedAt: '2024-01-15T10:30:00.000Z'
}
```

---

### Find

#### Find All Documents

```javascript
const allUsers = await users.find();
```

#### Find with Filter

```javascript
const adults = await users.find({ age: { $gte: 18 } });
```

#### Find One Document

```javascript
const user = await users.findOne({ name: 'Alice' });
```

#### Find by ID

```javascript
const user = await users.findById('a1b2c3d4');
```

#### Count Documents

```javascript
// Count all
const total = await users.count();

// Count with filter
const adults = await users.count({ age: { $gte: 18 } });
```

---

### Update

#### Update with Filter

```javascript
await users.update(
    { age: { $lt: 18 } },           // Filter
    { $set: { status: 'minor' } }   // Modification
);
```

#### Update by ID

```javascript
await users.updateById('a1b2c3d4', {
    $set: { age: 26 }
});
```

#### Update Operators

##### `$set` - Set a Value

```javascript
await users.update(
    { name: 'Alice' },
    { $set: { email: 'newemail@example.com' } }
);
```

##### `$inc` - Increment a Number

```javascript
await users.update(
    { name: 'Alice' },
    { $inc: { age: 1 } }  // age += 1
);
```

##### `$push` - Add to Array

```javascript
await users.update(
    { name: 'Alice' },
    { $push: { tags: 'vip' } }
);
```

##### `$addToSet` - Add Without Duplicate

```javascript
await users.update(
    { name: 'Alice' },
    { $addToSet: { tags: 'premium' } }  // Won't add if already exists
);
```

##### `$pull` - Remove from Array

```javascript
await users.update(
    { name: 'Alice' },
    { $pull: { tags: 'guest' } }
);
```

##### `$unset` - Delete a Field

```javascript
await users.update(
    { name: 'Alice' },
    { $unset: { tempField: 1 } }
);
```

#### Updates on Nested Fields

```javascript
await users.update(
    { name: 'Alice' },
    { $set: { 'address.city': 'Paris' } }
);
```

#### Multiple Updates

```javascript
await users.update(
    { status: 'active' },
    { 
        $set: { verified: true },
        $inc: { loginCount: 1 },
        $push: { history: new Date() }
    }
);
```

### Paginate - Simplified Pagination

The `paginate()` method provides a complete pagination solution in a single call, returning both data and metadata.

#### Basic Pagination

```javascript
const result = await users.paginate({}, { 
    page: 1, 
    limit: 10 
});

console.log(result);
/*
{
  data: [
    { id: '...', name: 'Alice', age: 25 },
    { id: '...', name: 'Bob', age: 30 },
    ...
  ],
  pagination: {
    page: 1,
    limit: 10,
    totalItems: 50,
    totalPages: 5,
    hasNext: true,
    hasPrev: false,
    nextPage: 2,
    prevPage: null,
    startIndex: 1,
    endIndex: 10
  }
}
*/
```

#### Pagination with Filters

```javascript
// Get page 2 of electronics products
const result = await products.paginate(
    { category: 'Electronics' },
    { page: 2, limit: 20 }
);

console.log(`Showing ${result.pagination.startIndex}-${result.pagination.endIndex} of ${result.pagination.totalItems}`);
// "Showing 21-40 of 156"
```

#### Pagination with Sorting

```javascript
// Most expensive products first
const result = await products.paginate(
    { stock: { $gt: 0 } },
    { 
        page: 1, 
        limit: 10,
        sort: { price: -1 }
    }
);
```

#### Navigation Logic

```javascript
let currentPage = 1;
let result = await users.paginate({}, { page: currentPage, limit: 10 });

// Next page button
if (result.pagination.hasNext) {
    result = await users.paginate({}, { page: result.pagination.nextPage, limit: 10 });
}

// Previous page button
if (result.pagination.hasPrev) {
    result = await users.paginate({}, { page: result.pagination.prevPage, limit: 10 });
}
```

#### REST API Example

```javascript
// Express.js route
app.get('/api/products', async (req, res) => {
    const { page = 1, limit = 20, category, minPrice } = req.query;
    
    const filters = {};
    if (category) filters.category = category;
    if (minPrice) filters.price = { $gte: parseInt(minPrice) };
    
    const result = await products.paginate(filters, {
        page: parseInt(page),
        limit: parseInt(limit),
        sort: { createdAt: -1 }
    });
    
    res.json({
        success: true,
        ...result
    });
});
```

**Response:**
```json
{
  "success": true,
  "data": [...],
  "pagination": {
    "page": 2,
    "limit": 20,
    "totalItems": 156,
    "totalPages": 8,
    "hasNext": true,
    "hasPrev": true,
    "nextPage": 3,
    "prevPage": 1,
    "startIndex": 21,
    "endIndex": 40
  }
}
```

#### Complete Example

```javascript
const LiekoDB = require('liekodb');
const db = new LiekoDB({ storagePath: './data' });
const products = db.collection('products');

(async () => {
    // Insert test data
    const testProducts = Array.from({ length: 50 }, (_, i) => ({
        name: `Product ${i + 1}`,
        price: Math.floor(Math.random() * 1000),
        category: ['Electronics', 'Books', 'Toys'][i % 3]
    }));
    await products.insert(testProducts);

    // Get first page
    let result = await products.paginate({}, { page: 1, limit: 10 });
    
    console.log(`Page ${result.pagination.page} of ${result.pagination.totalPages}`);
    console.log(`Items: ${result.data.length}`);
    console.log(`Total: ${result.pagination.totalItems}`);
    
    // Navigate to next page
    if (result.pagination.hasNext) {
        result = await products.paginate({}, { 
            page: result.pagination.nextPage, 
            limit: 10 
        });
        console.log(`Now on page ${result.pagination.page}`);
    }

    await db.close();
})();
```

#### Pagination Metadata

| Field | Type | Description |
|-------|------|-------------|
| `page` | number | Current page number |
| `limit` | number | Items per page |
| `totalItems` | number | Total number of matching documents |
| `totalPages` | number | Total number of pages |
| `hasNext` | boolean | Whether there's a next page |
| `hasPrev` | boolean | Whether there's a previous page |
| `nextPage` | number\|null | Next page number or null |
| `prevPage` | number\|null | Previous page number or null |
| `startIndex` | number | Index of first item on page (1-based) |
| `endIndex` | number | Index of last item on page (1-based) |

**Manual Pagination (Alternative):**

If you prefer more control, you can still use `find()` with `skip` and `limit`:

```javascript
const page = 2;
const pageSize = 10;

const totalItems = await products.count({ category: 'Electronics' });
const totalPages = Math.ceil(totalItems / pageSize);

const results = await products.find(
    { category: 'Electronics' },
    {
        skip: (page - 1) * pageSize,
        limit: pageSize,
        sort: { price: -1 }
    }
);
```

---

### Delete

#### Delete with Filter

```javascript
const result = await users.delete({ age: { $lt: 18 } });
console.log(result); // { deleted: 3 }
```

#### Delete by ID

```javascript
await users.deleteById('a1b2c3d4');
```

#### Delete All Documents

```javascript
await users.delete({}); // ⚠️ Deletes everything!
```

---

## 🔍 Filters and Operators

### Comparison Operators

#### `$eq` - Equality (implicit)

```javascript
await users.find({ age: 25 });
// Equivalent to: { age: { $eq: 25 } }
```

#### `$ne` - Not Equal

```javascript
await users.find({ name: { $ne: 'Alice' } });
```

#### `$gt` / `$gte` - Greater Than (or Equal)

```javascript
await users.find({ age: { $gt: 18 } });   // age > 18
await users.find({ age: { $gte: 18 } });  // age >= 18
```

#### `$lt` / `$lte` - Less Than (or Equal)

```javascript
await users.find({ age: { $lt: 65 } });   // age < 65
await users.find({ age: { $lte: 65 } });  // age <= 65
```

#### `$in` - In Array

```javascript
await users.find({ 
    status: { $in: ['active', 'pending'] } 
});
```

#### `$nin` - Not In Array

```javascript
await users.find({ 
    status: { $nin: ['banned', 'deleted'] } 
});
```

### Logical Operators

#### `$and` - Logical AND

```javascript
await users.find({
    $and: [
        { age: { $gte: 18 } },
        { status: 'active' }
    ]
});
```

#### `$or` - Logical OR

```javascript
await users.find({
    $or: [
        { age: { $lt: 18 } },
        { status: 'minor' }
    ]
});
```

#### `$nor` - Logical NOR

```javascript
await users.find({
    $nor: [
        { age: { $lt: 18 } },
        { status: 'banned' }
    ]
});
// Returns documents that are NEITHER minors NOR banned
```

#### `$not` - Logical NOT

```javascript
await users.find({
    age: { $not: { $gte: 18 } }
});
// Equivalent to: age < 18
```

### Advanced Operators

#### `$exists` - Field Exists

```javascript
await users.find({ email: { $exists: true } });   // Has email
await users.find({ email: { $exists: false } });  // No email
```

#### `$regex` - Regular Expression

```javascript
// Starts with 'A'
await users.find({ name: { $regex: '^A' } });

// Contains 'alice' (case insensitive)
await users.find({ 
    email: { $regex: 'alice', $options: 'i' } 
});

// Ends with '.com'
await users.find({ email: { $regex: '\\.com$' } });
```

#### `$mod` - Modulo

```javascript
// Even numbers (divisible by 2)
await users.find({ age: { $mod: [2, 0] } });

// Age % 5 = 1
await users.find({ age: { $mod: [5, 1] } });
```

### Filters on Nested Fields

```javascript
await users.find({ 'address.city': 'Paris' });
await users.find({ 'address.country': 'France' });
await users.find({ 
    'metrics.logins': { $gte: 100 } 
});
```

### Filters on Arrays

```javascript
// Array contains a value
await users.find({ tags: 'vip' });

// Array contains one of the values
await users.find({ 
    tags: { $in: ['vip', 'premium'] } 
});

// At least one value > 100
await users.find({ 
    scores: { $gt: 100 } 
});
```

---

## 🎯 Advanced Options

### Sort - Sorting Results

```javascript
// Ascending sort
await users.find({}, { sort: { age: 1 } });

// Descending sort
await users.find({}, { sort: { age: -1 } });

// Multiple sort
await users.find({}, { 
    sort: { 
        status: 1,    // First by status
        age: -1       // Then by age descending
    } 
});
```

### Limit - Limit Results

```javascript
// Return only 10 results
await users.find({}, { limit: 10 });

// All results
await users.find({}, { limit: 'all' });
```

### Skip - Skip Results

```javascript
// Skip first 20
await users.find({}, { skip: 20 });
```

### Fields - Projection

Select only certain fields:

```javascript
// Inclusion (most common)
await users.find({}, { fields: { name: 1, age: 1 } });
// → Returns only name and age (id is NOT included automatically)


// Inclusion + explicitly include id (very useful for APIs)
await users.find({}, { fields: { id: 1, name: 1, email: 1 } });
// → { id: "abc123", name: "Alice", email: "alice@example.com" }


// Exclusion (e.g. hide sensitive fields)
await users.find({}, { fields: { password: 0, token: 0 } });
// → Returns all fields EXCEPT password and token (id IS included by default in exclusion mode)


await users.find({});
// → Full document including id, createdAt, updatedAt, etc.
```

### Combining Options

```javascript
await users.find(
    { status: 'active' },           // Filter
    {
        sort: { createdAt: -1 },    // Descending sort
        skip: 10,                   // Skip 10
        limit: 5,                   // Take 5
        fields: { name: 1, age: 1 } // Only name and age
    }
);
```

---

## 📁 Collection Management

### Create/Get a Collection

```javascript
const users = db.collection('users');
```

### List All Collections

```javascript
const collections = await db.listCollections();
console.log(collections); // ['users', 'products', 'orders']
```

### Drop a Collection

```javascript
// Via collection object
await users.drop();

// Via DB
await db.dropCollection('users');
```

### Database Status

```javascript
const status = await db.status();
console.log(status);
/*
{
    storagePath: './storage',
    collections: [
        {
        name: 'users',
        documents: 3,
        dirty: true,
        lastSave: 1764461986128
        }
    ],
    totalDocuments: 3,
    dirtyCollections: 1,
    pendingSaves: 1
}
*/
```

### Collection Name Validation

Collection names must:
- ✅ Contain only `a-z`, `A-Z`, `0-9`, `_`, `-`
- ✅ Start with a letter
- ✅ Be between 1 and 64 characters
- ❌ Not contain spaces or special characters

```javascript
// ✅ Valid
db.collection('users');
db.collection('user_profiles');
db.collection('products-2024');

// ❌ Invalid
db.collection('123users');      // Starts with a number
db.collection('user profiles'); // Contains a space
db.collection('users/admin');   // Contains a slash
```

### Optimizations

#### 1. Use findById When Possible

```javascript
// ❌ Slower
const user = await users.findOne({ id: 'abc123' });

// ✅ Faster (uses index)
const user = await users.findById('abc123');
```

#### 2. Limit Results

```javascript
// ❌ Returns everything
const recent = await users.find({ status: 'active' });

// ✅ Smart limit
const recent = await users.find(
    { status: 'active' },
    { sort: { createdAt: -1 }, limit: 100 }
);
```

#### 3. Use Projection

```javascript
// ❌ Returns all fields
const names = (await users.find()).map(u => u.name);

// ✅ Select only what's needed
const names = await users.find({}, { fields: { name: 1 } });
```

#### 4. Batch Inserts

```javascript
// ❌ Multiple inserts
for (const user of users) {
    await collection.insert(user);
}

// ✅ Batch insert
await collection.insert(users);
```

---

## 💡 Complete Examples

### Example 1: Blog

```javascript
const LiekoDB = require('liekodb');
const db = new LiekoDB({ storagePath: './blog_data', debug: true });
const posts = db.collection('posts');
const comments = db.collection('comments');


(async () => {
    // Create a post
    const post = await posts.insert({
        title: 'Introduction to LiekoDB',
        content: 'LiekoDB is a database...',
        author: 'Alice',
        tags: ['database', 'nodejs'],
        views: 0,
        published: true
    });

    // Increment views
    await posts.updateById(post.insertedIds[0], {
        $inc: { views: 1 }
    });

    // Add a comment
    await comments.insert({
        postId: post.insertedIds[0],
        author: 'Bob',
        text: 'Very interesting article!',
        likes: 0
    });

    // Find all published posts with 'nodejs' tag
    const nodejsPosts = await posts.find({
        published: true,
        tags: 'nodejs'
    }, {
        sort: { views: -1 },
        limit: 10
    });

    await db.close(); // Optional

})();

/*
>node blog.js
[LiekoDB] INSERT posts | Duration: 4.23ms | Response Size: 61 B | Inserted: 1, Updated: 0
[LiekoDB] UPDATEBYID posts | Duration: 259µs | Response Size: 13 B | ID: bd85f5e4863d9d99 | Updated: 1
[LiekoDB] INSERT comments | Duration: 159µs | Response Size: 61 B | Inserted: 1, Updated: 0
[LiekoDB] FIND posts | Duration: 190µs | Response Size: 249 B | Filters: {published:true, tags:nodejs} | sort: {views:-1}, limit: 10 | Found: 1
[LiekoDB] Written to comments.json
[LiekoDB] Written to posts.json 
*/
```

### Example 2: E-commerce

```javascript
const LiekoDB = require('liekodb');
const db = new LiekoDB({ storagePath: './shop_data', debug: true });
const products = db.collection('products');
const orders = db.collection('orders');

((async () => {
    // Add products
    await products.insert([
        { name: 'Laptop', price: 999, stock: 10, category: 'electronics' },
        { name: 'Mouse', price: 25, stock: 100, category: 'accessories' },
        { name: 'Keyboard', price: 75, stock: 50, category: 'accessories' }
    ]);

    // Create an order
    const order = await orders.insert({
        customerId: 'user_123',
        items: [
            { productId: 'prod_1', quantity: 1, price: 999 },
            { productId: 'prod_2', quantity: 2, price: 25 }
        ],
        total: 1049,
        status: 'pending'
    });

    // Update stock
    await products.update(
        { name: 'Laptop' },
        { $inc: { stock: -1 } }
    );

    // Mark order as shipped
    await orders.updateById(order.insertedIds[0], {
        $set: { status: 'shipped', shippedAt: new Date().toISOString() }
    });

    // Find out of stock products
    const outOfStock = await products.find({
        stock: { $lte: 5 }
    });

    // Statistics
    const totalOrders = await orders.count();
    const pendingOrders = await orders.count({ status: 'pending' });

    await db.close(); // Optional
})());

/*
>node e-commerce.js
[LiekoDB] INSERT products | Duration: 4.20ms | Response Size: 99 B | Inserted: 3, Updated: 0
[LiekoDB] INSERT orders | Duration: 165µs | Response Size: 61 B | Inserted: 1, Updated: 0
[LiekoDB] UPDATE products | Duration: 451µs | Response Size: 13 B | Filters: {name:Laptop} | Updated: 1
[LiekoDB] UPDATEBYID orders | Duration: 40µs | Response Size: 13 B | ID: 5b535b7c3551ac2a | Updated: 1
[LiekoDB] FIND products | Duration: 215µs | Response Size: 2 B | Filters: {stock:{$lte:5}} | Found: 0
[LiekoDB] COUNT orders | Duration: 17µs | Response Size: 1 B | Filters: {} | Count: 1
[LiekoDB] COUNT orders | Duration: 10µs | Response Size: 1 B | Filters: {status:pending} | Count: 0
[LiekoDB] Written to products.json
[LiekoDB] Written to orders.json
*/
```

### Example 3: User System

```javascript
const LiekoDB = require('liekodb');
const db = new LiekoDB({ storagePath: './users_data', debug: true });
const users = db.collection('users');

(async () => {
// Registration
await users.insert({
    email: 'alice@example.com',
    username: 'alice',
    password: 'hashed_password',
    profile: {
        firstName: 'Alice',
        lastName: 'Smith',
        age: 25
    },
    preferences: {
        theme: 'dark',
        notifications: true
    },
    roles: ['user'],
    loginHistory: []
});

// Login (record in history)
await users.update(
    { email: 'alice@example.com' },
    { 
        $push: { loginHistory: new Date().toISOString() },
        $set: { lastLogin: new Date().toISOString() }
    }
);

// Promote to admin
await users.update(
    { email: 'alice@example.com' },
    { $addToSet: { roles: 'admin' } }
);

// Find all active admins
const admins = await users.find({
    roles: 'admin',
    'profile.age': { $gte: 18 }
});

// Delete inactive accounts (no login for 1 year)
const oneYearAgo = new Date();
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

await users.delete({
    lastLogin: { $lt: oneYearAgo.toISOString() }
});

await db.close(); // Optional
})();

/*
>node user-system.js
[LiekoDB] INSERT users | Duration: 4.12ms | Response Size: 61 B | Inserted: 1, Updated: 0
[LiekoDB] UPDATE users | Duration: 413µs | Response Size: 13 B | Filters: {email:alice@example.com} | Updated: 1
[LiekoDB] UPDATE users | Duration: 32µs | Response Size: 13 B | Filters: {email:alice@example.com} | Updated: 1
[LiekoDB] FIND users | Duration: 58µs | Response Size: 2 B | Filters: {roles:admin, profile.age:{$gte:18}} | Found: 0
[LiekoDB] DELETE users | Duration: 192µs | Response Size: 13 B | Filters: {lastLogin:{$lt:2024-11-30T00:32:30.669Z}} | Deleted: 0
[LiekoDB] Written to users.json
*/
```

### Example 4: ToDo

```javascript
const LiekoDB = require('liekodb');
const db = new LiekoDB({ storagePath: './todos', debug: true });
const todos = db.collection('todos');

(async () => {
    await todos.insert([
        { text: 'Finish LiekoDB', done: true, priority: 'high', tags: ['dev', 'open-source'], due: '2025-12-01' },
        { text: 'Go grocery shopping', done: false, priority: 'medium', tags: ['personal'], due: '2025-11-30' },
        { text: 'Exercise', done: false, priority: 'low', tags: ['health'], due: '2025-12-05' }
    ]);

    const urgent = await todos.find({
        done: false,
        due: { $lte: new Date().toISOString().split('T')[0] }
    }, { sort: { priority: -1 } });

    const devTasks = await todos.find({ tags: 'dev' });

    await todos.update(
        { text: 'Go grocery shopping' },
        { $set: { done: true, completedAt: new Date().toISOString() } }
    );

    console.log('Urgent tasks:', urgent);
    console.log('Dev tasks:', devTasks);

    await db.close();
})();
```

---

## 📚 API Reference

### LiekoDB

#### Constructor

```javascript
new LiekoDB(options)
```

**Options:**
- `storagePath` (string): Storage directory
- `debug` (boolean): Enable logs
- `saveDelay` (number): Save delay in ms

#### Methods

- `collection(name)` → Collection
- `listCollections()` → Promise<string[]>
- `dropCollection(name)` → Promise<{dropped: boolean}>
- `status()` → Promise<Object>
- `close()` → Promise<boolean>

---

### Collection

#### Read Methods

- `find(filters?, options?)` → Promise<Array>
- `findOne(filters?, options?)` → Promise<Object|null>
- `findById(id)` → Promise<Object|null>
- `count(filters?)` → Promise<number>

#### Write Methods

- `insert(data)` → Promise<{inserted, updated, insertedIds}>
- `update(filter, update)` → Promise<{updated}>
- `updateById(id, update)` → Promise<{updated}>
- `delete(filter)` → Promise<{deleted}>
- `deleteById(id)` → Promise<{deleted}>
- `drop()` → Promise<{dropped}>

---

## 🔒 Best Practices

### 1. Always Close the DB (Recommended)

```javascript
try {
    // Your operations
    await users.insert(data);
} finally {
    await db.close(); // Guarantees data is saved
}
```

**When is `close()` required?**
- ✅ Short-lived scripts that exit quickly
- ✅ Before `process.exit()`
- ✅ In signal handlers (SIGINT, SIGTERM)
- ⚠️ Optional for long-running servers (but recommended in shutdown handlers)

**Auto-save behavior:**
- Data is automatically saved 50ms after modifications
- If your script runs longer than `saveDelay`, data will persist even without `close()`
- `close()` forces immediate save and is always safer

### 2. Handle System Signals

```javascript
process.on('SIGINT', async () => {
    await db.close();
    process.exit(0);
});
```

### 3. Data Validation

```javascript
function validateUser(user) {
    if (!user.email || !user.name) {
        throw new Error('Email and name are required');
    }
    return true;
}

validateUser(userData);
await users.insert(userData);
```

### 4. Use Meaningful IDs

```javascript
// Use meaningful IDs
await users.insert({
    id: `user_${Date.now()}_${Math.random()}`,
    email: 'alice@example.com'
});
```

### 5. Error Handling

```javascript
try {
    await users.insert(data);
} catch (error) {
    console.error('Insert failed:', error);
    // Handle error
}
```

---

## ⚠️ Limitations

- **No ACID transactions**: Operations are not atomic
- **Single-threaded**: No native multi-process concurrency
- **Recommended size**: < 1M documents per collection
- **No relationships**: No SQL-like joins
- **Async save**: Risk of data loss if crash before flush

---

## 🆘 Troubleshooting

### Data Not Saved

**Understanding the save mechanism:**

LiekoDB uses a debounced save system with a 50ms delay (configurable via `saveDelay` option). This means:

```javascript
// ✅ WILL SAVE - Script runs long enough
(async () => {
    await users.insert(data);
    console.log('Data inserted');
    // Script continues for >50ms, data gets saved
})();

// ❌ WON'T SAVE - Process exits too quickly
(async () => {
    await users.insert(data);
})();
process.exit(); // Exits before 50ms save delay!

// ✅ WILL SAVE - Using close()
(async () => {
    await users.insert(data);
    await db.close(); // Forces immediate save
    process.exit();
})();

// ✅ WILL SAVE - Using setTimeout
(async () => {
    await users.insert(data);
    setTimeout(() => process.exit(), 100); // Waits for auto-save
})();
```

**Solutions:**
1. **Best practice**: Always use `await db.close()` before exiting
2. **Alternative**: Increase `saveDelay` if needed: `new LiekoDB({ saveDelay: 100 })`
3. **For servers**: Auto-save works fine, just ensure graceful shutdown with `close()`

### Degraded Performance

```javascript
// Check status
const status = await db.status();
console.log(status.pendingSaves);  // Should be 0

// Force save
await db.close();
```

### Residual .tmp Files

If you find `.tmp` files in your storage folder:
```bash
# Clean manually
rm storage/*.tmp
```

---

## 📄 License

MIT License - Free to use for any project

---

## 🤝 Support

For any questions or bugs, open an issue on the GitHub repository.

---

**LiekoDB** - Simple, fast, efficient. 🚀
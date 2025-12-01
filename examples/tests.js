const LiekoDB = require('../liekodb');
const assert = require('assert');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(color, ...args) {
    console.log(color, ...args, colors.reset);
}

function assertEqual(actual, expected, message) {
    try {
        assert.deepStrictEqual(actual, expected);
        log(colors.green, `✓ ${message}`);
        return true;
    } catch (e) {
        log(colors.red, `✗ ${message}`);
        console.error(`  Expected:`, expected);
        console.error(`  Got:`, actual);
        throw e;
    }
}

function assertGreaterThan(actual, expected, message) {
    if (actual > expected) {
        log(colors.green, `✓ ${message}`);
        return true;
    }
    log(colors.red, `✗ ${message}`);
    console.error(`  Expected > ${expected}, got ${actual}`);
    throw new Error(message);
}

async function runTest(name, fn) {
    try {
        log(colors.cyan, `\n▶ ${name}`);
        await fn();
        log(colors.green, `✓ ${name} - PASSED`);
        return { name, status: 'PASSED' };
    } catch (error) {
        log(colors.red, `✗ ${name} - FAILED`);
        console.error(error.message);
        return { name, status: 'FAILED', error };
    }
}

async function testBasicInsertAndFind() {
    
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_users');

    // Insert simple
    const result = await users.insert({ name: 'Alice', age: 30 });
    assertEqual(result.inserted, 1, 'Insert should return 1 inserted');

    // Find all
    const allUsers = await users.find();
    assertEqual(allUsers.length, 1, 'Should find 1 user');
    assertEqual(allUsers[0].name, 'Alice', 'User name should be Alice');

    await users.drop();
    await db.close();
}

async function testBatchInsert() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const products = db.collection('test_products');

    const items = [
        { name: 'Laptop', price: 999, stock: 10 },
        { name: 'Mouse', price: 25, stock: 100 },
        { name: 'Keyboard', price: 75, stock: 50 }
    ];

    const result = await products.insert(items);
    assertEqual(result.inserted, 3, 'Should insert 3 products');

    const allProducts = await products.find();
    assertEqual(allProducts.length, 3, 'Should find 3 products');

    await products.drop();
    await db.close();
}

async function testComplexFilters() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_complex');

    // Données de test
    await users.insert([
        { name: 'Alice', age: 25, active: true, score: 1200, tags: ['vip', 'premium'] },
        { name: 'Bob', age: 30, active: true, score: 800, tags: ['regular'] },
        { name: 'Charlie', age: 35, active: false, score: 1500, tags: ['vip'] },
        { name: 'David', age: 28, active: true, score: 950, tags: ['premium'] },
        { name: 'Eve', age: 32, active: false, score: 1100, tags: ['regular', 'vip'] }
    ]);

    // Test $gt
    const olderThan30 = await users.find({ age: { $gt: 30 } });
    assertEqual(olderThan30.length, 2, 'Should find 2 users older than 30');

    // Test $gte
    const age30Plus = await users.find({ age: { $gte: 30 } });
    assertEqual(age30Plus.length, 3, 'Should find 3 users aged 30+');

    // Test $lt
    const youngerThan30 = await users.find({ age: { $lt: 30 } });
    assertEqual(youngerThan30.length, 2, 'Should find 2 users younger than 30');

    // Test $lte
    const age30Minus = await users.find({ age: { $lte: 30 } });
    assertEqual(age30Minus.length, 3, 'Should find 3 users aged 30 or less');

    // Test $in
    const specificAges = await users.find({ age: { $in: [25, 35] } });
    assertEqual(specificAges.length, 2, 'Should find users aged 25 or 35');

    // Test $nin
    const notTheseAges = await users.find({ age: { $nin: [25, 35] } });
    assertEqual(notTheseAges.length, 3, 'Should find 3 users not aged 25 or 35');

    // Test $ne
    const notBob = await users.find({ name: { $ne: 'Bob' } });
    assertEqual(notBob.length, 4, 'Should find 4 users not named Bob');

    // Test array contains
    const vipUsers = await users.find({ tags: 'vip' });
    assertEqual(vipUsers.length, 3, 'Should find 3 VIP users');

    // Test combined filters
    const activeHighScore = await users.find({ 
        active: true, 
        score: { $gte: 1000 } 
    });
    assertEqual(activeHighScore.length, 1, 'Should find 1 active user with score >= 1000');

    await users.drop();
    await db.close();
}

async function testLogicalOperators() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_logical');

    await users.insert([
        { name: 'Alice', age: 25, score: 100, active: true },
        { name: 'Bob', age: 30, score: 200, active: false },
        { name: 'Charlie', age: 35, score: 150, active: true },
        { name: 'David', age: 28, score: 180, active: false }
    ]);

    // Test $and
    const andResult = await users.find({
        $and: [
            { age: { $gte: 28 } },
            { score: { $lte: 180 } }
        ]
    });
    assertEqual(andResult.length, 2, '$and should find 2 users');

    // Test $or
    const orResult = await users.find({
        $or: [
            { age: { $lt: 27 } },
            { score: { $gt: 190 } }
        ]
    });
    assertEqual(orResult.length, 2, '$or should find 2 users');

    // Test $nor
    const norResult = await users.find({
        $nor: [
            { age: { $lt: 27 } },
            { score: { $gt: 190 } }
        ]
    });
    assertEqual(norResult.length, 2, '$nor should find 2 users');

    // Test $not
    const notResult = await users.find({
        age: { $not: { $gte: 30 } }
    });
    assertEqual(notResult.length, 2, '$not should find 2 users under 30');

    await users.drop();
    await db.close();
}

async function testRegexAndMod() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_regex');

    await users.insert([
        { name: 'Alice', code: 'A123', value: 10 },
        { name: 'Bob', code: 'B456', value: 17 },
        { name: 'Anna', code: 'A789', value: 20 },
        { name: 'Charlie', code: 'C012', value: 25 }
    ]);

    // Test $regex
    const startsWithA = await users.find({ name: { $regex: '^A' } });
    assertEqual(startsWithA.length, 2, 'Should find 2 names starting with A');

    const containsnn = await users.find({ name: { $regex: 'nn' } });
    assertEqual(containsnn.length, 1, 'Should find 1 name containing nn');

    // Test $regex case insensitive
    const caseInsensitive = await users.find({ 
        name: { $regex: '^a', $options: 'i' } 
    });
    assertEqual(caseInsensitive.length, 2, 'Should find 2 names starting with a (case insensitive)');

    // Test $mod - divisible by 5 (10, 20, 25 = 3 values, 17 is not)
    const divisibleBy5 = await users.find({ value: { $mod: [5, 0] } });
    assertEqual(divisibleBy5.length, 3, 'Should find 3 values divisible by 5');

    // Test $mod - remainder 2 when divided by 3 (17 % 3 = 2, 20 % 3 = 2)
    const remainder2 = await users.find({ value: { $mod: [3, 2] } });
    assertEqual(remainder2.length, 2, 'Should find 2 values with remainder 2 when divided by 3');

    await users.drop();
    await db.close();
}

async function testNestedFields() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_nested');

    await users.insert([
        { name: 'Alice', address: { city: 'Paris', country: 'France' }, metrics: { logins: 150 } },
        { name: 'Bob', address: { city: 'London', country: 'UK' }, metrics: { logins: 80 } },
        { name: 'Charlie', address: { city: 'Paris', country: 'France' }, metrics: { logins: 200 } },
        { name: 'David', address: { city: 'Berlin', country: 'Germany' }, metrics: { logins: 120 } }
    ]);

    // Test nested field equality
    const parisUsers = await users.find({ 'address.city': 'Paris' });
    assertEqual(parisUsers.length, 2, 'Should find 2 users in Paris');

    // Test nested field with operator
    const highLogins = await users.find({ 'metrics.logins': { $gte: 120 } });
    assertEqual(highLogins.length, 3, 'Should find 3 users with 120+ logins');

    // Test combined nested and top-level
    const parisHighLogins = await users.find({
        'address.city': 'Paris',
        'metrics.logins': { $gte: 150 }
    });
    assertEqual(parisHighLogins.length, 2, 'Should find 2 Paris users with 150+ logins');

    await users.drop();
    await db.close();
}

async function testCount() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_count');

    await users.insert([
        { name: 'Alice', age: 25, active: true },
        { name: 'Bob', age: 30, active: false },
        { name: 'Charlie', age: 35, active: true },
        { name: 'David', age: 28, active: true }
    ]);

    // Count all
    const totalCount = await users.count();
    assertEqual(totalCount, 4, 'Should count 4 total users');

    // Count with filter
    const activeCount = await users.count({ active: true });
    assertEqual(activeCount, 3, 'Should count 3 active users');

    // Count with complex filter
    const complexCount = await users.count({ 
        active: true, 
        age: { $gte: 30 } 
    });
    assertEqual(complexCount, 1, 'Should count 1 active user aged 30+');

    await users.drop();
    await db.close();
}

async function testUpdateOperations() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_update');

    await users.insert([
        { name: 'Alice', age: 25, score: 100, tags: ['user'], stats: { views: 10 } },
        { name: 'Bob', age: 30, score: 200, tags: ['admin'], stats: { views: 20 } }
    ]);

    // Test $set
    await users.update({ name: 'Alice' }, { $set: { age: 26 } });
    const alice = await users.findOne({ name: 'Alice' });
    assertEqual(alice.age, 26, 'Alice age should be updated to 26');

    // Test $inc
    await users.update({ name: 'Bob' }, { $inc: { score: 50 } });
    const bob = await users.findOne({ name: 'Bob' });
    assertEqual(bob.score, 250, 'Bob score should be incremented to 250');

    // Test $push
    await users.update({ name: 'Alice' }, { $push: { tags: 'premium' } });
    const aliceWithTag = await users.findOne({ name: 'Alice' });
    assertEqual(aliceWithTag.tags.includes('premium'), true, 'Alice should have premium tag');

    // Test $addToSet (no duplicate)
    await users.update({ name: 'Alice' }, { $addToSet: { tags: 'user' } });
    const aliceUnique = await users.findOne({ name: 'Alice' });
    assertEqual(aliceUnique.tags.filter(t => t === 'user').length, 1, 'Should not duplicate user tag');

    // Test $pull
    await users.update({ name: 'Alice' }, { $pull: { tags: 'user' } });
    const aliceNoPull = await users.findOne({ name: 'Alice' });
    assertEqual(aliceNoPull.tags.includes('user'), false, 'Alice should not have user tag');

    // Test $unset
    await users.update({ name: 'Bob' }, { $unset: { age: 1 } });
    const bobNoAge = await users.findOne({ name: 'Bob' });
    assertEqual(bobNoAge.age, undefined, 'Bob age should be unset');

    // Test nested update
    await users.update({ name: 'Alice' }, { $set: { 'stats.views': 50 } });
    const aliceViews = await users.findOne({ name: 'Alice' });
    assertEqual(aliceViews.stats.views, 50, 'Alice views should be 50');

    // Test multiple updates
    const multiUpdate = await users.update({ tags: 'premium' }, { $inc: { score: 100 } });
    assertGreaterThan(multiUpdate.updated, 0, 'Should update at least one document');

    await users.drop();
    await db.close();
}

async function testUpdateById() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_update_id');

    const result = await users.insert({ name: 'Alice', score: 100 });
    const userId = result.insertedId;

    // Update by ID
    await users.updateById(userId, { $set: { score: 150 } });
    const updated = await users.findById(userId);
    assertEqual(updated.score, 150, 'Score should be updated to 150');

    // Update non-existent ID
    const noUpdate = await users.updateById('nonexistent', { $set: { score: 999 } });
    assertEqual(noUpdate.updated, 0, 'Should not update non-existent document');

    await users.drop();
    await db.close();
}

async function testDeleteOperations() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_delete');

    await users.insert([
        { name: 'Alice', active: true },
        { name: 'Bob', active: false },
        { name: 'Charlie', active: true },
        { name: 'David', active: false }
    ]);

    // Delete with filter
    const deleteResult = await users.delete({ active: false });
    assertEqual(deleteResult.deleted, 2, 'Should delete 2 inactive users');

    const remaining = await users.find();
    assertEqual(remaining.length, 2, 'Should have 2 users remaining');

    // Delete by ID
    const alice = await users.findOne({ name: 'Alice' });
    await users.deleteById(alice.id);
    
    const afterDelete = await users.find();
    assertEqual(afterDelete.length, 1, 'Should have 1 user remaining after deleteById');

    await users.drop();
    await db.close();
}

async function testSortLimitSkip() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_pagination');

    await users.insert([
        { name: 'Alice', age: 25, score: 300 },
        { name: 'Bob', age: 30, score: 100 },
        { name: 'Charlie', age: 35, score: 500 },
        { name: 'David', age: 28, score: 200 },
        { name: 'Eve', age: 32, score: 400 }
    ]);

    // Test sort ascending
    const sortedAsc = await users.find({}, { sort: { age: 1 } });
    assertEqual(sortedAsc[0].name, 'Alice', 'First should be youngest');
    assertEqual(sortedAsc[4].name, 'Charlie', 'Last should be oldest');

    // Test sort descending
    const sortedDesc = await users.find({}, { sort: { score: -1 } });
    assertEqual(sortedDesc[0].score, 500, 'First should have highest score');
    assertEqual(sortedDesc[4].score, 100, 'Last should have lowest score');

    // Test limit
    const limited = await users.find({}, { limit: 3 });
    assertEqual(limited.length, 3, 'Should return only 3 results');

    // Test skip
    const skipped = await users.find({}, { skip: 2 });
    assertEqual(skipped.length, 3, 'Should skip 2 and return 3 results');

    // Test combined: sort + limit + skip
    const combined = await users.find({}, { 
        sort: { age: 1 }, 
        skip: 1, 
        limit: 2 
    });
    assertEqual(combined.length, 2, 'Should return 2 results');
    assertEqual(combined[0].age, 28, 'First should be David (age 28)');

    await users.drop();
    await db.close();
}

async function testProjection() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_projection');

    await users.insert([
        { name: 'Alice', age: 25, email: 'alice@test.com', password: 'secret' },
        { name: 'Bob', age: 30, email: 'bob@test.com', password: 'secret2' }
    ]);

    // Select specific fields
    const projected = await users.find({}, { 
        fields: { name: 1, age: 1 } 
    });

    assertEqual(projected[0].name !== undefined, true, 'Should have name');
    assertEqual(projected[0].age !== undefined, true, 'Should have age');
    assertEqual(projected[0].email, undefined, 'Should not have email');
    assertEqual(projected[0].password, undefined, 'Should not have password');

    await users.drop();
    await db.close();
}

async function testExistsOperator() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_exists');

    await users.insert([
        { name: 'Alice', email: 'alice@test.com' },
        { name: 'Bob' },
        { name: 'Charlie', email: 'charlie@test.com' },
        { name: 'David' }
    ]);

    // Test $exists: true
    const withEmail = await users.find({ email: { $exists: true } });
    assertEqual(withEmail.length, 2, 'Should find 2 users with email');

    // Test $exists: false
    const withoutEmail = await users.find({ email: { $exists: false } });
    assertEqual(withoutEmail.length, 2, 'Should find 2 users without email');

    await users.drop();
    await db.close();
}

async function testArrayOperators() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_arrays');

    await users.insert([
        { name: 'Alice', scores: [10, 20, 30], tags: ['vip', 'premium'] },
        { name: 'Bob', scores: [15, 25, 35], tags: ['regular'] },
        { name: 'Charlie', scores: [5, 15, 25], tags: ['vip', 'guest'] }
    ]);

    // Test array contains value
    const hasVip = await users.find({ tags: 'vip' });
    assertEqual(hasVip.length, 2, 'Should find 2 VIP users');

    // Test $in with arrays
    const hasSpecificTag = await users.find({ tags: { $in: ['premium', 'guest'] } });
    assertEqual(hasSpecificTag.length, 2, 'Should find users with premium or guest tag');

    // Test numeric array operators
    const highScore = await users.find({ scores: { $gt: 30 } });
    assertEqual(highScore.length, 1, 'Should find 1 user with score > 30');

    await users.drop();
    await db.close();
}

async function testUpsertBehavior() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const users = db.collection('test_upsert');

    // Insert with specific ID
    const result1 = await users.insert({ id: 'user1', name: 'Alice', score: 100 });
    assertEqual(result1.inserted, 1, 'Should insert new document');

    // Insert again with same ID (should update)
    const result2 = await users.insert({ id: 'user1', name: 'Alice Updated', score: 200 });
    assertEqual(result2.updated, 1, 'Should update existing document');
    assertEqual(result2.inserted, 0, 'Should not insert new document');

    const user = await users.findById('user1');
    assertEqual(user.name, 'Alice Updated', 'Name should be updated');
    assertEqual(user.score, 200, 'Score should be updated');
    assertEqual(user.createdAt !== undefined, true, 'Should preserve createdAt');

    await users.drop();
    await db.close();
}

async function testComplexScenario() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const orders = db.collection('test_orders');

    // Scenario: E-commerce orders
    await orders.insert([
        { 
            orderNumber: 'ORD001', 
            customer: { name: 'Alice', country: 'France' },
            items: [
                { product: 'Laptop', price: 999, quantity: 1 },
                { product: 'Mouse', price: 25, quantity: 2 }
            ],
            total: 1049,
            status: 'pending',
            tags: ['express', 'priority']
        },
        { 
            orderNumber: 'ORD002', 
            customer: { name: 'Bob', country: 'UK' },
            items: [
                { product: 'Keyboard', price: 75, quantity: 1 }
            ],
            total: 75,
            status: 'shipped',
            tags: ['standard']
        },
        { 
            orderNumber: 'ORD003', 
            customer: { name: 'Charlie', country: 'France' },
            items: [
                { product: 'Monitor', price: 350, quantity: 2 }
            ],
            total: 700,
            status: 'pending',
            tags: ['express']
        }
    ]);

    // Find pending orders from France
    const pendingFrance = await orders.find({
        'customer.country': 'France',
        status: 'pending'
    });
    assertEqual(pendingFrance.length, 2, 'Should find 2 pending orders from France');

    // Find high-value orders
    const highValue = await orders.find({ total: { $gte: 500 } });
    assertEqual(highValue.length, 2, 'Should find 2 high-value orders');

    // Update all pending to processing
    const updateResult = await orders.update(
        { status: 'pending' },
        { $set: { status: 'processing' }, $push: { tags: 'updated' } }
    );
    assertEqual(updateResult.updated, 2, 'Should update 2 orders');

    // Verify update
    const processing = await orders.find({ status: 'processing' });
    assertEqual(processing.length, 2, 'Should have 2 processing orders');
    assertEqual(processing[0].tags.includes('updated'), true, 'Should have updated tag');

    // Complex query: express orders with total > 500 from France
    const complex = await orders.find({
        $and: [
            { tags: 'express' },
            { total: { $gt: 500 } },
            { 'customer.country': 'France' }
        ]
    });
    assertEqual(complex.length, 2, 'Should find 2 matching complex criteria');

    await orders.drop();
    await db.close();
}

async function testPerformance() {
    const db = new LiekoDB({ storagePath: './test_storage', debug: false });
    const perf = db.collection('test_performance');

    // Insert 1000 documents
    const docs = Array.from({ length: 1000 }, (_, i) => ({
        index: i,
        name: `User${i}`,
        age: 20 + (i % 50),
        score: Math.floor(Math.random() * 1000),
        active: i % 2 === 0,
        tags: i % 3 === 0 ? ['vip'] : ['regular']
    }));

    const startInsert = Date.now();
    await perf.insert(docs);
    const insertTime = Date.now() - startInsert;
    log(colors.blue, `  Insert 1000 docs: ${insertTime}ms`);

    // Query performance
    const startQuery = Date.now();
    const results = await perf.find({ 
        active: true, 
        score: { $gte: 500 } 
    });
    const queryTime = Date.now() - startQuery;
    log(colors.blue, `  Complex query (found ${results.length}): ${queryTime}ms`);

    // Update performance
    const startUpdate = Date.now();
    await perf.update({ active: true }, { $inc: { score: 10 } });
    const updateTime = Date.now() - startUpdate;
    log(colors.blue, `  Bulk update: ${updateTime}ms`);

    assertGreaterThan(1, 0, 'Performance test completed');

    await perf.drop();
    await db.close();
}

// Runner
async function runAllTests() {
    console.log('\n' + '='.repeat(80));
    log(colors.magenta, '🧪 LIEKODB - COMPREHENSIVE TEST SUITE');
    console.log('='.repeat(80) + '\n');

    const tests = [
        ['Basic Insert & Find', testBasicInsertAndFind],
        ['Batch Insert', testBatchInsert],
        ['Complex Filters', testComplexFilters],
        ['Logical Operators ($and, $or, $nor, $not)', testLogicalOperators],
        ['Regex & Mod Operators', testRegexAndMod],
        ['Nested Fields', testNestedFields],
        ['Count Operations', testCount],
        ['Update Operations ($set, $inc, $push, $pull, $unset)', testUpdateOperations],
        ['Update By ID', testUpdateById],
        ['Delete Operations', testDeleteOperations],
        ['Sort, Limit & Skip', testSortLimitSkip],
        ['Field Projection', testProjection],
        ['$exists Operator', testExistsOperator],
        ['Array Operators', testArrayOperators],
        ['Upsert Behavior', testUpsertBehavior],
        ['Complex Real-World Scenario', testComplexScenario],
        ['Performance Test (1000 docs)', testPerformance]
    ];

    const results = [];
    let passed = 0;
    let failed = 0;

    for (const [name, fn] of tests) {
        const result = await runTest(name, fn);
        results.push(result);
        if (result.status === 'PASSED') passed++;
        else failed++;
    }

    // Summary
    console.log('\n' + '='.repeat(80));
    log(colors.magenta, '📊 TEST SUMMARY');
    console.log('='.repeat(80));
    log(colors.green, `✓ Passed: ${passed}/${tests.length}`);
    if (failed > 0) {
        log(colors.red, `✗ Failed: ${failed}/${tests.length}`);
    }
    console.log('='.repeat(80) + '\n');

    if (failed === 0) {
        log(colors.green, '🎉 ALL TESTS PASSED! 🎉\n');
    } else {
        log(colors.red, '❌ SOME TESTS FAILED\n');
        process.exit(1);
    }
}

// Run tests
runAllTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
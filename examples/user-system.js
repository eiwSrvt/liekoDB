const LiekoDB = require('../liekodb');

const db = new LiekoDB({
    storagePath: './users_data',
    debug: true
});

const users = db.collection('users');

(async () => {

    // Registration
    const insertedUsers = await users.insert([{
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
    },
    {
        email: 'bob@example.com',
        username: 'bobby',
        password: 'hashed_password',
        profile: {
            firstName: 'Bob',
            lastName: 'Walters',
            age: 17
        },
        preferences: {
            theme: 'light',
            notifications: false
        },
        roles: ['user', 'moderator'],
        loginHistory: []
    }]);
    console.log('Inserted users:', insertedUsers.insertedIds);

    // Login (record in history)
    await users.update(
        { email: 'bob@example.com' },
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
        roles: { $in: ['admin'] },
        'profile.age': { $gte: 18 }
    });
    console.log('Admin users:', admins);

    // Delete inactive accounts (no login for 1 year)
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    await users.delete({
        lastLogin: { $lt: oneYearAgo.toISOString() }
    });

    await db.close(); // Optional
})();